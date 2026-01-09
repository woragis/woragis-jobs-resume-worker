import { v4 as uuidv4 } from 'uuid'
import { DatabaseClient, JobStatus } from './database'
import ResumeServiceClient from './resume-service-client'
import AIServiceClient from './ai-service-client'
import logger from './logger'
import { ResumeGenerationJob } from './rabbitmq'

export class ResumeJobProcessor {
  constructor(
    private db: DatabaseClient,
    private resumeService: ResumeServiceClient,
    private aiService: AIServiceClient
  ) {}

  async processJob(job: ResumeGenerationJob): Promise<void> {
    const startTime = Date.now()

    try {
      // Update job status to processing
      await this.db.updateResumeJobStatus(job.jobId, 'processing', {
        processingStartedAt: new Date().toISOString(),
      })

      logger.info(
        { jobId: job.jobId, userId: job.userId },
        'Processing resume generation job'
      )

      // Fetch job details from database
      const jobData = await this.db.getResumeJobById(job.jobId)
      if (!jobData) {
        throw new Error(`Job not found: ${job.jobId}`)
      }

      // Generate resume using resume-service
      const resumeResponse = await this.resumeService.generateResume({
        userId: job.userId,
        jobDescription: job.jobDescription,
        metadata: job.metadata,
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
          await this.db.updateResumeJobStatus(job.jobId, 'completed', {
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

      logger.info(
        { jobId: job.jobId, duration: Date.now() - startTime },
        'Resume job completed successfully'
      )
    } catch (err) {
      logger.error(
        { err, jobId: job.jobId, duration: Date.now() - startTime },
        'Resume job processing failed'
      )

      // Update job status to failed
      await this.db.updateResumeJobStatus(job.jobId, 'failed', {
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

      await this.db.createResumeRecord(job.jobId, job.userId, filePath, {
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
