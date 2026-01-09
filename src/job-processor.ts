import { v4 as uuidv4 } from 'uuid'
import { DatabaseClient } from './database'
import PostsDatabaseClient from './database-posts'
import ManagementDatabaseClient from './database-management'
import ResumeServiceClient from './resume-service-client'
import AIServiceClient from './ai-service-client'
import logger from './logger'
import { ResumeGenerationJob } from './rabbitmq'
import { metricsService } from './metrics'
import { withRetry } from './retry'

export class ResumeJobProcessor {
  constructor(
    private dbJobs: DatabaseClient,
    private dbPosts: PostsDatabaseClient,
    private dbManagement: ManagementDatabaseClient,
    private resumeService: ResumeServiceClient,
    private aiService: AIServiceClient
  ) {}

  async processJob(job: ResumeGenerationJob): Promise<void> {
    const startTime = Date.now()
    metricsService.activeJobs.inc()
    const endTimer = metricsService.jobProcessingDuration.startTimer()

    try {
      // Update job status to processing
      await this.dbJobs.updateResumeJobStatus(job.jobId, 'processing', {
        processingStartedAt: new Date().toISOString(),
      })

      logger.info(
        { jobId: job.jobId, userId: job.userId },
        'Processing resume generation job'
      )

      // Fetch job details from jobs database
      const jobData = await this.dbJobs.getResumeJobById(job.jobId)
      if (!jobData) {
        throw new Error(`Job not found: ${job.jobId}`)
      }

      // Fetch data from posts database
      logger.info(
        { jobId: job.jobId, userId: job.userId },
        'Fetching posts data'
      )
      const [technicalWritings, posts, systemDesigns] = await withRetry(
        () =>
          Promise.all([
            this.dbPosts.getTechnicalWritings(job.userId, 20),
            this.dbPosts.getPosts(job.userId, 10),
            this.dbPosts.getSystemDesigns(job.userId, 10),
          ]),
        'fetch_posts_data'
      )

      // Fetch data from management database
      logger.info(
        { jobId: job.jobId, userId: job.userId },
        'Fetching management data'
      )
      const [projects, experiences] = await withRetry(
        () =>
          Promise.all([
            this.dbManagement.getProjects(job.userId, 20),
            this.dbManagement.getExperiences(job.userId, 20),
          ]),
        'fetch_management_data'
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
        },
        'Data fetched from all databases'
      )

      // Send data to AI service for parsing/enrichment (optional)
      // This can be used to transform the data into resume-friendly format
      const enrichedData = {
        technicalWritings,
        posts,
        systemDesigns,
        projects,
        experiences,
        jobDescription: job.jobDescription,
      }

      // Generate resume using resume-service
      const resumeResponse = await this.resumeService.generateResume({
        userId: job.userId,
        jobDescription: job.jobDescription,
        metadata: {
          ...job.metadata,
          enrichedData,
        },
      })

      logger.info(
        { jobId: job.jobId, resumeJobId: resumeResponse.jobId },
        'Resume generation request sent to resume-service'
      )

      // Wait for resume generation to complete
      const maxWaitTime = 5 * 60 * 1000 // 5 minutes
      const pollInterval = 5000 // 5 seconds
      let elapsed = 0
      let completed = false

      while (elapsed < maxWaitTime && !completed) {
        const status = await this.resumeService.getResumeStatus(
          resumeResponse.jobId
        )

        if (status.status === 'completed') {
          completed = true
          logger.info(
            { jobId: job.jobId, pdfUrl: status.pdfUrl },
            'Resume generation completed'
          )

          // Download and store the resume
          if (status.pdfUrl) {
            await this.storeResume(job, status.pdfUrl)
          }

          // Update job status to completed
          await this.dbJobs.updateResumeJobStatus(job.jobId, 'completed', {
            resumeJobId: resumeResponse.jobId,
            pdfUrl: status.pdfUrl,
            completedAt: new Date().toISOString(),
            processingDurationMs: Date.now() - startTime,
          })
        } else if (status.status === 'failed') {
          throw new Error(
            `Resume generation failed: ${status.error || 'Unknown error'}`
          )
        }

        if (!completed) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
          elapsed += pollInterval
        }
      }

      if (!completed) {
        throw new Error('Resume generation timeout')
      }

      metricsService.jobsProcessedTotal.inc({ status: 'completed' })
      endTimer()
      metricsService.activeJobs.dec()

      logger.info(
        { jobId: job.jobId, duration: Date.now() - startTime },
        'Resume job completed successfully'
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
        'Resume job processing failed'
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
    pdfUrl: string
  ): Promise<void> {
    try {
      logger.info({ jobId: job.jobId, pdfUrl }, 'Storing resume')

      // Download the resume PDF
      const pdfBuffer = await this.resumeService.downloadResume(
        job.jobId,
        'pdf'
      )

      // In a real scenario, you might store this to S3 or another storage service
      // For now, we'll just store the metadata
      const resumeId = uuidv4()
      const filePath = `resumes/${job.userId}/${resumeId}.pdf`

      await this.dbJobs.createResumeRecord(job.jobId, job.userId, filePath, {
        fileName: `resume_${new Date().toISOString().split('T')[0]}.pdf`,
        fileSize: pdfBuffer.length,
        generatedAt: new Date().toISOString(),
        jobDescription: job.jobDescription.substring(0, 500),
      })

      logger.info(
        { jobId: job.jobId, filePath, size: pdfBuffer.length },
        'Resume stored successfully'
      )
    } catch (err) {
      logger.error({ err, jobId: job.jobId }, 'Failed to store resume')
      throw err
    }
  }
}

export default ResumeJobProcessor
