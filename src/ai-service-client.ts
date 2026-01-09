import axios, { AxiosInstance } from 'axios'
import { config } from './config'
import logger from './logger'

export interface ContentGenerationRequest {
  type: 'profile' | 'experience' | 'skills' | 'summary'
  jobDescription: string
  userContext?: {
    experience?: string
    skills?: string[]
    projects?: string
  }
}

export interface ContentGenerationResponse {
  content: string
  tokens_used: number
  model: string
}

export class AIServiceClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: config.services.aiService.url,
      timeout: config.services.aiService.timeout,
      headers: config.services.aiService.apiKey
        ? { 'X-API-Key': config.services.aiService.apiKey }
        : {},
    })
  }

  async generateContent(
    request: ContentGenerationRequest
  ): Promise<ContentGenerationResponse> {
    try {
      logger.info(
        {
          type: request.type,
          jobDescriptionLength: request.jobDescription.length,
        },
        'Requesting content generation from AI service'
      )

      const response = await this.client.post<ContentGenerationResponse>(
        '/api/v1/content/generate',
        request
      )

      logger.info(
        { type: request.type, tokensUsed: response.data.tokens_used },
        'Content generation successful'
      )

      return response.data
    } catch (err) {
      logger.error({ err, type: request.type }, 'Content generation failed')
      throw err
    }
  }

  async generateProfileSummary(
    jobDescription: string,
    userContext?: ContentGenerationRequest['userContext']
  ): Promise<string> {
    const response = await this.generateContent({
      type: 'profile',
      jobDescription,
      userContext,
    })
    return response.content
  }

  async generateExperience(
    jobDescription: string,
    userContext?: ContentGenerationRequest['userContext']
  ): Promise<string> {
    const response = await this.generateContent({
      type: 'experience',
      jobDescription,
      userContext,
    })
    return response.content
  }

  async generateSkills(
    jobDescription: string,
    userContext?: ContentGenerationRequest['userContext']
  ): Promise<string> {
    const response = await this.generateContent({
      type: 'skills',
      jobDescription,
      userContext,
    })
    return response.content
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

export default AIServiceClient
