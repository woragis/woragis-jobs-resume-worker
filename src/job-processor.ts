import { v4 as uuidv4 } from 'uuid'
import { DatabaseClient } from './database'
import PostsDatabaseClient from './database-posts'
import ManagementDatabaseClient from './database-management'
import { AuthDatabaseClient } from './database-auth'
import ResumeServiceClient from './resume-service-client'
import AIServiceClient from './ai-service-client'
import AIValidator, { LanguageCode } from './ai-validator'
import AIEnricher, {
  AIEnhancerConfig,
  SectionEnhancerConfig,
  FocusArea,
} from './ai-enricher'
import logger from './logger'
import fs from 'fs'
import path from 'path'
import { assemblePayload } from './payload-assembler'
import { validatePayload } from './payload-validator'
import { ResumeGenerationJob } from './rabbitmq'
import { metricsService } from './metrics'
import { withRetry } from './retry'

export class ResumeJobProcessor {
  private aiValidator: AIValidator
  private aiEnricher: AIEnricher

  constructor(
    private dbJobs: DatabaseClient,
    private dbPosts: PostsDatabaseClient,
    private dbManagement: ManagementDatabaseClient,
    private dbAuth: AuthDatabaseClient,
    private resumeService: ResumeServiceClient,
    private aiService: AIServiceClient,
  ) {
    this.aiValidator = new AIValidator()
    this.aiEnricher = new AIEnricher(this.aiService, this.aiValidator)
  }

  async processJob(job: ResumeGenerationJob): Promise<void> {
    const startTime = Date.now()
    metricsService.activeJobs.inc()
    const endTimer = metricsService.jobProcessingDuration.startTimer()

    try {
      // Update job status to processing
      await this.dbJobs.updateResumeJobStatus(job.jobId, 'processing', {
        processingStartedAt: new Date().toISOString(),
      })

      // Non-invasive logging: capture the incoming userId and a small,
      // sanitized snapshot of the job payload for debugging upstream producers.
      const sanitize = (j: ResumeGenerationJob) => {
        return {
          jobId: j.jobId,
          userId: j.userId,
          userEmail: j.userEmail
            ? j.userEmail.replace(/(.{2}).+(@.+)/, '$1***$2')
            : undefined,
          userName: j.userName ? `${j.userName.split(' ')[0]}***` : undefined,
          jobDescriptionSnippet: j.jobDescription
            ? j.jobDescription.substring(0, 200)
            : undefined,
        }
      }

      logger.info(
        { incoming: sanitize(job) },
        'Processing resume generation job - incoming snapshot',
      )

      // Fetch job details from jobs database
      const jobData = await this.dbJobs.getResumeJobById(job.jobId)
      if (!jobData) {
        throw new Error(`Job not found: ${job.jobId}`)
      }

      // Defensive: many test/e2e jobs use non-UUID userId (eg. "e2e-test-user").
      // Database queries expect UUIDs; use a stable fallback UUID for DB
      // lookups when the provided userId isn't a valid UUID.
      const isUuid = (s: string) => {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          s,
        )
      }

      const dbUserId = isUuid(job.userId)
        ? job.userId
        : '00000000-0000-0000-0000-000000000001'

      // Fetch data from posts database
      logger.info(
        { jobId: job.jobId, userId: job.userId, dbUserId },
        'Fetching posts data',
      )
      const [technicalWritings, posts, systemDesigns] = await withRetry(
        () =>
          Promise.all([
            this.dbPosts.getTechnicalWritings(dbUserId, 20),
            this.dbPosts.getPosts(dbUserId, 10),
            this.dbPosts.getSystemDesigns(dbUserId, 10),
          ]),
        'fetch_posts_data',
      )

      // Fetch data from management database
      logger.info(
        { jobId: job.jobId, userId: job.userId, dbUserId },
        'Fetching management data',
      )
      const [projects, experiences] = await withRetry(
        () =>
          Promise.all([
            this.dbManagement.getProjects(dbUserId, 20),
            this.dbManagement.getExperiences(dbUserId, 20),
          ]),
        'fetch_management_data',
      )

      logger.info(
        {
          jobId: job.jobId,
          counts: {
            technicalWritings: technicalWritings.length,
            posts: posts.length,
            systemDesigns: systemDesigns.length,
            projects: projects.length,
            experiences: experiences.length,
          },
          userEmail: job.userEmail,
          userName: job.userName,
        },
        'Data fetched from all databases',
      )

      // Send data to AI service for parsing/enrichment (optional)
      // This can be used to transform the data into resume-friendly format
      let enrichedData: any = {
        technicalWritings,
        posts,
        systemDesigns,
        projects,
        experiences,
        jobDescription: job.jobDescription,
      }

      // AI Enhancement (if enabled and has job description)
      if (job.jobDescription && job.jobDescription.trim().length > 0) {
        try {
          enrichedData = await this.enhanceContentWithAI(enrichedData, job)
        } catch (err) {
          logger.warn(
            { err, jobId: job.jobId },
            'AI enhancement failed, continuing with raw content',
          )
          // Continue with raw content on AI failure
        }
      }

      // Generate resume via renderer endpoint (synchronous)
      // Try to get user identity: first from job, then from auth database
      let userProfile = undefined
      if (job.userName || job.userEmail) {
        userProfile = {
          name: job.userName || 'Your Name',
          email: job.userEmail || 'user@example.com',
        }
      } else {
        // If job doesn't have userName/userEmail, look them up from auth database
        try {
          const authUser = await this.dbAuth.getUserById(dbUserId)
          if (authUser) {
            const fullName = [authUser.first_name, authUser.last_name]
              .filter(Boolean)
              .join(' ')
            userProfile = {
              name: fullName || 'Your Name',
              email: authUser.email || 'user@example.com',
            }
            logger.info(
              {
                userId: dbUserId,
                name: userProfile.name,
                email: userProfile.email,
              },
              'User identity fetched from auth database',
            )
          }
        } catch (err) {
          logger.warn(
            { err, userId: dbUserId },
            'Failed to fetch user identity from auth database',
          )
        }
      }

      logger.info({ jobId: job.jobId, userProfile }, 'Calling renderer')

      const composed = assemblePayload(job, enrichedData, userProfile)

      const { valid, errors } = validatePayload(composed)
      if (!valid) {
        logger.error(
          { jobId: job.jobId, errors },
          'Composed payload failed schema validation',
        )
        throw new Error('Composed payload validation failed')
      }

      // Normalize / flatten payload to match resume-service `render` contract.
      // The worker assembles nested `profile` objects; the simple renderer
      // expects top-level `name`, `email`, and `profile` as an HTML string.
      try {
        const profileObj: any =
          userProfile || (composed && composed.profile) || {}
        const displayName =
          (profileObj && profileObj.name) || job.userName || 'Your Name'
        const displayEmail =
          (profileObj && profileObj.email) || job.userEmail || ''

        const profileHtmlParts = []
        if (displayName)
          profileHtmlParts.push(`<p class="name">${displayName}</p>`)
        if (displayEmail)
          profileHtmlParts.push(`<p class="email">${displayEmail}</p>`)
        const profileHtml = profileHtmlParts.join('\n')

        composed.name = displayName
        composed.email = displayEmail
        // Overwrite profile to be an HTML snippet for Jinja template
        composed.profile = profileHtml

        // Convert `experiences` array into the `experience` HTML string
        // expected by the simple renderer template. This ensures the
        // renderer receives properly formatted HTML for long lists and
        // preserves richer structure from the DB.
        try {
          if (
            Array.isArray(composed.experiences) &&
            composed.experiences.length > 0
          ) {
            const expParts = composed.experiences.map((e: any) => {
              const title = e.title || e.role || e.position || ''
              const company = e.company || e.organization || ''
              const start = e.startDate || e.start || ''
              const end = e.endDate || e.end || ''
              const dates = [start, end].filter(Boolean).join(' — ')
              const desc = e.description || e.summary || ''

              const headerParts: string[] = []
              if (title)
                headerParts.push(`<div class="item-title">${title}</div>`)
              if (company || dates)
                headerParts.push(
                  `<div class="item-subtitle">${company}${dates ? ' • ' + dates : ''}</div>`,
                )

              return `
                <div class="item">
                  <div class="item-header">${headerParts.join('')}</div>
                  ${desc ? `<div class="item-description">${desc}</div>` : ''}
                </div>
              `
            })

            composed.experience = expParts.join('\n')
          }

          // Map `posts` to `publications` expected by template
          if (Array.isArray(composed.posts) && composed.posts.length > 0) {
            composed.publications = composed.posts.map((p: any) => ({
              title: p.title || p.name || 'Untitled',
              excerpt:
                p.excerpt ||
                (typeof p.content === 'string'
                  ? p.content.substring(0, 500)
                  : ''),
            }))
          }
        } catch (e) {
          // Non-fatal: continue with original composed payload on error
        }
      } catch (e) {
        // Defensive: if something goes wrong, proceed with original composed payload
      }

      try {
        logger.info(
          {
            composedSample:
              composed && typeof composed === 'object'
                ? JSON.stringify(composed).substring(0, 1200)
                : String(composed),
          },
          'Composed payload snapshot',
        )
      } catch (e) {
        // best-effort logging
      }

      // DEBUG: Log what we're about to send to the renderer
      logger.info(
        {
          jobId: job.jobId,
          composedName: composed?.name,
          composedEmail: composed?.email,
          composedProfile: (composed?.profile || '').substring(0, 200),
          jobUserName: job.userName,
          jobUserEmail: job.userEmail,
          userProfileUsed: userProfile,
        },
        'DEBUG: Final payload fields before renderer POST',
      )

      const renderResponse = await this.resumeService.renderResume({
        userId: job.userId,
        jobDescription: job.jobDescription,
        userProfile,
        payload: composed,
        metadata: {
          ...job.metadata,
        },
      })

      logger.info(
        { jobId: job.jobId, renderResponse },
        'Renderer response received',
      )

      if (renderResponse.error) {
        throw new Error(`Renderer error: ${renderResponse.error}`)
      }

      if (!renderResponse.pdfUrl && !renderResponse.html) {
        throw new Error('Renderer did not return any output')
      }

      // Download and store the resume (prefer PDF)
      if (renderResponse.pdfUrl) {
        const pdfBuffer = await this.resumeService.downloadFromUrl(
          renderResponse.pdfUrl,
        )

        await this.storeResume(job, pdfBuffer)

        await this.dbJobs.updateResumeJobStatus(job.jobId, 'completed', {
          resumeJobId: job.jobId,
          pdfUrl: renderResponse.pdfUrl,
          completedAt: new Date().toISOString(),
          processingDurationMs: Date.now() - startTime,
        })
      } else if (renderResponse.html) {
        const buffer = Buffer.from(renderResponse.html, 'utf8')
        await this.storeResume(job, buffer, 'html')

        await this.dbJobs.updateResumeJobStatus(job.jobId, 'completed', {
          resumeJobId: job.jobId,
          htmlUrl: '',
          completedAt: new Date().toISOString(),
          processingDurationMs: Date.now() - startTime,
        })
      }

      metricsService.jobsProcessedTotal.inc({ status: 'completed' })
      endTimer()
      metricsService.activeJobs.dec()

      logger.info(
        { jobId: job.jobId, duration: Date.now() - startTime },
        'Resume job completed successfully',
      )
    } catch (err) {
      endTimer()
      metricsService.activeJobs.dec()
      metricsService.jobsFailedTotal.inc({
        error_type:
          err instanceof Error ? err.constructor.name : 'UnknownError',
      })

      logger.error(
        { err, jobId: job.jobId, duration: Date.now() - startTime },
        'Resume job processing failed',
      )

      // Update job status to failed
      await this.dbJobs.updateResumeJobStatus(job.jobId, 'failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
        failedAt: new Date().toISOString(),
      })

      throw err
    }
  }

  private async storeResume(
    job: ResumeGenerationJob,
    data: Buffer,
    format: 'pdf' | 'html' = 'pdf',
  ): Promise<void> {
    try {
      const ext = format === 'pdf' ? 'pdf' : 'html'
      const fileSize = data.length
      const resumeId = uuidv4()
      const filePath = `resumes/${job.userId}/${resumeId}.${ext}`

      // Determine host-visible storage root. Prefer environment override,
      // otherwise default to the local storage folder.
      const storageRoot = process.env.WORKER_STORAGE_PATH || './storage/resumes'
      const fullPath = path.join(storageRoot, filePath)

      // Ensure directory exists and write the file to disk so it is visible
      // on the host when `./resume-data` is bind-mounted into the container.
      const dir = path.dirname(fullPath)
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(fullPath, data)

      // Persist metadata in DB (createResumeRecord will map to the actual
      // schema). Include filename and filesize in metadata for clarity.
      await this.dbJobs.createResumeRecord(job.jobId, job.userId, filePath, {
        fileName: `resume_${new Date().toISOString().split('T')[0]}.${ext}`,
        fileSize,
        generatedAt: new Date().toISOString(),
        jobDescription: (job.jobDescription || '').substring(0, 500),
      })

      logger.info(
        { jobId: job.jobId, filePath, size: fileSize },
        'Resume stored successfully',
      )
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to store resume')
      throw err
    }
  }

  /**
   * Enhance content with AI service
   */
  private async enhanceContentWithAI(
    rawData: any,
    job: ResumeGenerationJob,
  ): Promise<any> {
    const aiEnhancementStartTime = Date.now()

    // Extract job context for AI
    const targetRole = this.extractTargetRole(job.jobDescription)
    const skillKeywords = this.extractSkills(job.jobDescription)
    const language: LanguageCode =
      (job.metadata?.language as LanguageCode) || 'en'

    logger.info(
      {
        jobId: job.jobId,
        targetRole,
        skillCount: skillKeywords.length,
        language,
      },
      'Starting AI content enhancement',
    )

    // Build enhancement config
    const enhancerConfig: AIEnhancerConfig = {
      jobDescription: job.jobDescription,
      targetRole,
      skillKeywords,
      language,
      fallbackOnAIFailure: 'raw',
      fallbackOnValidationFailure: 'raw',
    }

    // Define enhancement strategies per section
    const sectionConfigs: Record<string, SectionEnhancerConfig> = {
      experiences: {
        enable: true,
        format: 'bullet',
        minLength: 100,
        maxLength: 2000, // Increased from 280 to allow fuller descriptions
        focusOn: ['impact', 'technical'],
        bulletPoints: 3,
        includeMetrics: true,
      },
      projects: {
        enable: true,
        format: 'bullet',
        minLength: 100,
        maxLength: 2000, // Increased from 220
        focusOn: ['technical', 'impact'],
        bulletPoints: 2,
        includeMetrics: true,
      },
      posts: {
        enable: true,
        format: 'prose',
        minLength: 60,
        maxLength: 800, // Increased from 150 to allow fuller summaries
        focusOn: ['innovation'],
      },
      technicalWritings: {
        enable: true,
        format: 'prose',
        minLength: 80,
        maxLength: 800, // Increased from 200
        focusOn: ['technical', 'innovation'],
      },
      systemDesigns: {
        enable: true,
        format: 'prose',
        minLength: 80,
        maxLength: 800, // Increased from 200
        focusOn: ['technical', 'impact'],
      },
    }

    const enhancedData = { ...rawData }
    const aiSectionsEnabled: string[] = []
    let totalTokensUsed = 0

    // Enhance experiences
    if (rawData.experiences && rawData.experiences.length > 0) {
      logger.info(
        { jobId: job.jobId, count: rawData.experiences.length },
        'Enhancing experiences section',
      )
      enhancedData.experiences = await this.aiEnricher.enhanceItems(
        rawData.experiences,
        (item) => item.description || '',
        'experience',
        sectionConfigs.experiences,
        enhancerConfig,
      )
      aiSectionsEnabled.push('experiences')
      totalTokensUsed += enhancedData.experiences.reduce(
        (sum: number, e: any) => sum + (e._ai?.tokensUsed || 0),
        0,
      )
    }

    // Enhance projects
    if (rawData.projects && rawData.projects.length > 0) {
      logger.info(
        { jobId: job.jobId, count: rawData.projects.length },
        'Enhancing projects section',
      )
      enhancedData.projects = await this.aiEnricher.enhanceItems(
        rawData.projects,
        (item) => item.description || '',
        'project',
        sectionConfigs.projects,
        enhancerConfig,
      )
      aiSectionsEnabled.push('projects')
      totalTokensUsed += enhancedData.projects.reduce(
        (sum: number, p: any) => sum + (p._ai?.tokensUsed || 0),
        0,
      )
    }

    // Enhance posts (use excerpt or content)
    if (rawData.posts && rawData.posts.length > 0) {
      logger.info(
        { jobId: job.jobId, count: rawData.posts.length },
        'Enhancing posts section',
      )
      enhancedData.posts = await this.aiEnricher.enhanceItems(
        rawData.posts,
        (item) => item.excerpt || item.content || '',
        'post',
        sectionConfigs.posts,
        enhancerConfig,
      )
      aiSectionsEnabled.push('posts')
      totalTokensUsed += enhancedData.posts.reduce(
        (sum: number, p: any) => sum + (p._ai?.tokensUsed || 0),
        0,
      )
    }

    // Enhance technical writings
    if (rawData.technicalWritings && rawData.technicalWritings.length > 0) {
      logger.info(
        { jobId: job.jobId, count: rawData.technicalWritings.length },
        'Enhancing technical writings section',
      )
      enhancedData.technicalWritings = await this.aiEnricher.enhanceItems(
        rawData.technicalWritings,
        (item) => item.description || item.excerpt || '',
        'publication',
        sectionConfigs.technicalWritings,
        enhancerConfig,
      )
      aiSectionsEnabled.push('technicalWritings')
      totalTokensUsed += enhancedData.technicalWritings.reduce(
        (sum: number, w: any) => sum + (w._ai?.tokensUsed || 0),
        0,
      )
    }

    // Enhance system designs
    if (rawData.systemDesigns && rawData.systemDesigns.length > 0) {
      logger.info(
        { jobId: job.jobId, count: rawData.systemDesigns.length },
        'Enhancing system designs section',
      )
      enhancedData.systemDesigns = await this.aiEnricher.enhanceItems(
        rawData.systemDesigns,
        (item) => item.description || '',
        'publication',
        sectionConfigs.systemDesigns,
        enhancerConfig,
      )
      aiSectionsEnabled.push('systemDesigns')
      totalTokensUsed += enhancedData.systemDesigns.reduce(
        (sum: number, d: any) => sum + (d._ai?.tokensUsed || 0),
        0,
      )
    }

    const enhancementDuration = Date.now() - aiEnhancementStartTime

    // Add enhancement metadata
    enhancedData.enhancementStats = {
      aiSectionsEnabled,
      totalTokensUsed,
      enhancementDuration,
      language,
      targetRole,
    }

    logger.info(
      {
        jobId: job.jobId,
        duration: enhancementDuration,
        tokens: totalTokensUsed,
        sections: aiSectionsEnabled.length,
      },
      'AI enhancement completed',
    )

    return enhancedData
  }

  /**
   * Extract target role from job description
   */
  private extractTargetRole(jobDescription: string): string | undefined {
    // Simple regex to find role titles
    const roleMatches = jobDescription.match(
      /(?:seeking|looking for|hire|need|position of|role of|as a|is a)\s+(?:an?\s+)?([A-Z][a-zA-Z\s]+?)(?:\s+(?:with|in|at|for|to|role|position))/i,
    )
    if (roleMatches && roleMatches[1]) {
      return roleMatches[1].trim()
    }

    // Try to find capitalized phrases that look like roles
    const capMatches = jobDescription.match(
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:role|position)/i,
    )
    return capMatches ? capMatches[1].trim() : undefined
  }

  /**
   * Extract skill keywords from job description
   */
  private extractSkills(jobDescription: string): string[] {
    const skillPatterns = [
      /(?:skills?|expertise|technologies?|stack|require[ds]?).*?:?\s*([A-Z][a-zA-Z0-9#\+\-\.]+(?:,|\s+and)?)+/gi,
      /(?:knowledge of|familiar with|experience with)\s+([A-Z][a-zA-Z0-9#\+\-\.]+(?:,|\s+and)?)+/gi,
    ]

    const skills = new Set<string>()

    for (const pattern of skillPatterns) {
      let match
      while ((match = pattern.exec(jobDescription)) !== null) {
        const skillText = match[1] || match[0]
        const skillList = skillText
          .split(/[,;]|and/)
          .map((s) => s.trim())
          .filter((s) => s.length > 1 && s.length < 50)

        skillList.forEach((s) => skills.add(s))
      }
    }

    // Common tech skills fallback if extraction fails
    const commonSkills = [
      'Python',
      'JavaScript',
      'TypeScript',
      'Kubernetes',
      'AWS',
      'FastAPI',
      'PostgreSQL',
      'React',
      'Node.js',
      'Docker',
    ]
    const foundCommon = commonSkills.filter((skill) =>
      jobDescription.toLowerCase().includes(skill.toLowerCase()),
    )

    return Array.from(skills).length > 0
      ? Array.from(skills).slice(0, 10)
      : foundCommon
  }
}

export default ResumeJobProcessor
