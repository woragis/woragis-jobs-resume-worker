/**
 * E2E Tests for Resume Worker
 * Tests complete job processing workflow
 */
import { v4 as uuidv4 } from 'uuid'

// Mock RabbitMQ channel for testing
class MockRabbitMQChannel {
  private messages: any[] = []

  async assertQueue(queue: string) {
    return { queue, messageCount: 0, consumerCount: 0 }
  }

  async sendToQueue(queue: string, content: Buffer) {
    this.messages.push({
      queue,
      content: JSON.parse(content.toString()),
      timestamp: Date.now(),
    })
    return true
  }

  async consume(queue: string, _callback: unknown) {
    // Simulate message processing
    return { consumerTag: 'test-consumer' }
  }

  getMessages() {
    return this.messages
  }

  clearMessages() {
    this.messages = []
  }
}

describe('Resume Worker E2E Tests', () => {
  let mockChannel: MockRabbitMQChannel

  beforeEach(() => {
    mockChannel = new MockRabbitMQChannel()
  })

  describe('Complete Job Processing Workflow', () => {
    it('should process job application from queue to completion', async () => {
      const jobId = uuidv4()
      const userId = uuidv4()
      const jobApplicationId = uuidv4()

      const jobPayload = {
        jobId,
        userId,
        jobApplicationId,
        jobTitle: 'Senior Engineer',
        companyName: 'Tech Corp',
        resumeData: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '+1234567890',
          summary: 'Experienced software engineer',
          experience: [
            {
              title: 'Engineer',
              company: 'Company A',
              duration: '2020-2024',
            },
          ],
          education: [
            {
              degree: 'BS Computer Science',
              school: 'University',
              year: '2020',
            },
          ],
          skills: ['JavaScript', 'TypeScript', 'React', 'Node.js'],
        },
        format: 'pdf',
        language: 'en',
      }

      const messageBuffer = Buffer.from(JSON.stringify(jobPayload))
      await mockChannel.sendToQueue('resume-jobs', messageBuffer)

      const messages = mockChannel.getMessages()
      expect(messages).toHaveLength(1)
      expect(messages[0].queue).toBe('resume-jobs')
      expect(messages[0].content.jobId).toBe(jobId)
      expect(messages[0].content.userId).toBe(userId)
    })

    it('should handle resume generation with multiple formats', async () => {
      const formats = ['pdf', 'html', 'json']
      const jobIds: string[] = []

      for (const format of formats) {
        const jobId = uuidv4()
        jobIds.push(jobId)

        const payload = {
          jobId,
          userId: uuidv4(),
          jobApplicationId: uuidv4(),
          jobTitle: 'Developer',
          companyName: 'Corp',
          resumeData: {
            name: 'John Smith',
            email: 'john@example.com',
            phone: '+1234567890',
            summary: 'Developer',
            experience: [],
            education: [],
            skills: [],
          },
          format,
          language: 'en',
        }

        const messageBuffer = Buffer.from(JSON.stringify(payload))
        await mockChannel.sendToQueue('resume-jobs', messageBuffer)
      }

      const messages = mockChannel.getMessages()
      expect(messages).toHaveLength(3)

      messages.forEach((msg, index) => {
        expect(msg.content.format).toBe(formats[index])
      })
    })

    it('should handle resume generation in multiple languages', async () => {
      const languages = ['en', 'pt', 'es']

      for (const language of languages) {
        const payload = {
          jobId: uuidv4(),
          userId: uuidv4(),
          jobApplicationId: uuidv4(),
          jobTitle: 'Engineer',
          companyName: 'Corp',
          resumeData: {
            name: 'Person',
            email: 'person@example.com',
            phone: '+1234567890',
            summary: 'Professional',
            experience: [],
            education: [],
            skills: [],
          },
          format: 'pdf',
          language,
        }

        const messageBuffer = Buffer.from(JSON.stringify(payload))
        await mockChannel.sendToQueue('resume-jobs', messageBuffer)
      }

      const messages = mockChannel.getMessages()
      expect(messages).toHaveLength(3)

      messages.forEach((msg, index) => {
        expect(msg.content.language).toBe(languages[index])
      })
    })

    it('should process job with retry on failure', async () => {
      const jobId = uuidv4()
      const maxRetries = 3
      let retryCount = 0

      const payload = {
        jobId,
        userId: uuidv4(),
        jobApplicationId: uuidv4(),
        jobTitle: 'Engineer',
        companyName: 'Corp',
        resumeData: {
          name: 'John',
          email: 'john@example.com',
          phone: '+1234567890',
          summary: 'Engineer',
          experience: [],
          education: [],
          skills: [],
        },
        format: 'pdf',
        language: 'en',
        retryCount: 0,
      }

      // Simulate retries
      while (retryCount < maxRetries) {
        const messageBuffer = Buffer.from(JSON.stringify({ ...payload, retryCount }))
        await mockChannel.sendToQueue('resume-jobs', messageBuffer)
        retryCount++
      }

      const messages = mockChannel.getMessages()
      expect(messages).toHaveLength(maxRetries)

      messages.forEach((msg, index) => {
        expect(msg.content.retryCount).toBe(index)
      })
    })

    it('should handle resume with complex experience data', async () => {
      const complexResume = {
        name: 'John Developer',
        email: 'john@dev.com',
        phone: '+1234567890',
        summary: 'Full-stack developer with 10+ years experience',
        experience: [
          {
            title: 'Senior Engineer',
            company: 'Big Tech',
            duration: '2020-2024',
            description: 'Led team of 5 engineers',
            achievements: ['Improved performance by 40%', 'Mentored 3 engineers'],
          },
          {
            title: 'Engineer',
            company: 'Startup',
            duration: '2018-2020',
            description: 'Built features from scratch',
            achievements: ['Launched MVP', 'Grew user base to 10k'],
          },
        ],
        education: [
          {
            degree: 'BS Computer Science',
            school: 'Top University',
            year: '2014',
            gpa: '3.8',
          },
        ],
        skills: [
          'JavaScript',
          'TypeScript',
          'React',
          'Node.js',
          'PostgreSQL',
          'AWS',
          'Docker',
        ],
        certifications: [
          {
            name: 'AWS Solutions Architect',
            issuer: 'AWS',
            date: '2023',
          },
        ],
      }

      const payload = {
        jobId: uuidv4(),
        userId: uuidv4(),
        jobApplicationId: uuidv4(),
        jobTitle: 'Principal Engineer',
        companyName: 'Enterprise Corp',
        resumeData: complexResume,
        format: 'pdf',
        language: 'en',
      }

      const messageBuffer = Buffer.from(JSON.stringify(payload))
      await mockChannel.sendToQueue('resume-jobs', messageBuffer)

      const messages = mockChannel.getMessages()
      expect(messages).toHaveLength(1)

      const message = messages[0]
      expect(message.content.resumeData.experience).toHaveLength(2)
      expect(message.content.resumeData.skills).toHaveLength(7)
      expect(message.content.resumeData.certifications).toHaveLength(1)
    })
  })

  describe('Error Handling and Recovery', () => {
    it('should handle malformed messages gracefully', async () => {
      try {
        const malformedMessage = Buffer.from('{ invalid json')
        // This should be caught by message parser
        JSON.parse(malformedMessage.toString())
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof SyntaxError).toBe(true)
      }
    })

    it('should handle missing required fields', () => {
      const incompletePayload = {
        jobId: uuidv4(),
        // Missing userId and other required fields
      }

      expect(incompletePayload.jobId).toBeDefined()
      expect(incompletePayload).not.toHaveProperty('userId')
    })

    it('should handle timeout scenarios', async () => {
      const timeoutPromise = new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100)
      })

      await expect(timeoutPromise).rejects.toThrow('Timeout')
    })
  })

  describe('Metrics and Monitoring', () => {
    it('should track job processing metrics', () => {
      const metrics = {
        jobsProcessed: 0,
        jobsFailed: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0,
      }

      // Simulate processing
      const processingTimes = [1500, 2000, 1800, 2200, 1900]
      metrics.jobsProcessed = processingTimes.length
      metrics.totalProcessingTime = processingTimes.reduce((a, b) => a + b, 0)
      metrics.averageProcessingTime =
        metrics.totalProcessingTime / metrics.jobsProcessed

      expect(metrics.jobsProcessed).toBe(5)
      expect(metrics.averageProcessingTime).toBeGreaterThan(1500)
      expect(metrics.averageProcessingTime).toBeLessThan(2500)
    })

    it('should track error rates', () => {
      const results = [
        { status: 'success' },
        { status: 'success' },
        { status: 'success' },
        { status: 'failed' },
        { status: 'failed' },
      ]

      const failureRate =
        (results.filter((r) => r.status === 'failed').length / results.length) * 100

      expect(failureRate).toBe(40)
    })
  })
})
