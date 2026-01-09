import axios, { AxiosInstance } from 'axios'
import { config } from './config'
import logger from './logger'

export interface ResumeGenerationRequest {
  userId: string
  jobDescription: string
  userProfile?: {
    name: string
    email: string
    phone?: string
    location?: string
  }
  metadata?: Record<string, any>
}

export interface ResumeGenerationResponse {
  jobId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  pdfUrl?: string
  htmlUrl?: string
  error?: string
}

export class ResumeServiceClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: config.services.resumeService,
      timeout: 60000,
    })
  }

  async generateResume(
    request: ResumeGenerationRequest
  ): Promise<ResumeGenerationResponse> {
    try {
      logger.info(
        {
          userId: request.userId,
          jobDescription: request.jobDescription.substring(0, 100),
        },
        'Requesting resume generation from resume-service'
      )

      const response = await this.client.post<ResumeGenerationResponse>(
        '/api/v1/resumes/generate',
        request
      )

      return response.data
    } catch (err) {
      logger.error(
        { err, userId: request.userId },
        'Resume generation request failed'
      )
      throw err
    }
  }

  async getResumeStatus(jobId: string): Promise<ResumeGenerationResponse> {
    try {
      const response = await this.client.get<ResumeGenerationResponse>(
        `/api/v1/resumes/${jobId}/status`
      )

      return response.data
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to get resume status')
      throw err
    }
  }

  async downloadResume(
    jobId: string,
    format: 'pdf' | 'html' = 'pdf'
  ): Promise<Buffer> {
    try {
      const response = await this.client.get(
        `/api/v1/resumes/${jobId}/${format}`,
        {
          responseType: 'arraybuffer',
        }
      )

      return Buffer.from(response.data)
    } catch (err) {
      logger.error({ err, jobId, format }, 'Failed to download resume')
      throw err
    }
  }

  async health(): Promise<boolean> {
    try {
      await this.client.get('/healthz')
      return true
    } catch {
      return false
    }
  }
}

export default ResumeServiceClient
