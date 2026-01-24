import logger from './logger'
import { config, validateConfig } from './config'
import DatabaseClient from './database'
import PostsDatabaseClient from './database-posts'
import ManagementDatabaseClient from './database-management'
import { AuthDatabaseClient } from './database-auth'
import RabbitMQConsumer from './rabbitmq'
import ResumeServiceClient from './resume-service-client'
import AIServiceClient from './ai-service-client'
import ResumeJobProcessor from './job-processor'
import http from 'http'
import { metricsService } from './metrics'

let dbJobs: DatabaseClient
let dbPosts: PostsDatabaseClient
let dbManagement: ManagementDatabaseClient
let dbAuth: AuthDatabaseClient
let consumer: RabbitMQConsumer
let processor: ResumeJobProcessor
let fallbackServer: any | null = null

async function initialize(): Promise<void> {
  logger.info({ config }, 'Initializing Resume Worker')

  // Validate configuration first (fail-fast)
  validateConfig()

  // Start metrics server
  await metricsService.startServer()

  // Initialize databases
  logger.info('Connecting to databases...')

  dbJobs = new DatabaseClient()
  await dbJobs.connect()

  dbPosts = new PostsDatabaseClient()
  await dbPosts.connect()

  dbManagement = new ManagementDatabaseClient()
  await dbManagement.connect()

  dbAuth = new AuthDatabaseClient()
  await dbAuth.connect()

  logger.info('All database connections established')

  // Initialize clients
  const resumeService = new ResumeServiceClient()
  const aiService = new AIServiceClient()

  // Initialize processor with all database clients
  processor = new ResumeJobProcessor(
    dbJobs,
    dbPosts,
    dbManagement,
    dbAuth,
    resumeService,
    aiService,
  )

  // Initialize RabbitMQ consumer
  consumer = new RabbitMQConsumer()
  await consumer.connect()
  await consumer.setupQueue()

  // Register job handler
  consumer.registerHandler(async (job) => {
    await processor.processJob(job)
  })

  // Start consuming
  await consumer.start()

  logger.info('Resume Worker initialized successfully')
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down Resume Worker...')

  if (consumer) {
    await consumer.stop()
  }

  if (dbJobs) {
    await dbJobs.close()
  }

  if (dbPosts) {
    await dbPosts.close()
  }

  if (dbManagement) {
    await dbManagement.close()
  }

  if (dbAuth) {
    await dbAuth.close()
  }

  await metricsService.stopServer()

  if (fallbackServer) {
    try {
      await new Promise((resolve, reject) => {
        fallbackServer.close((err: any) => (err ? reject(err) : resolve(null)))
      })
    } catch (err) {
      logger.warn({ err }, 'Error closing fallback server')
    }
  }

  logger.info('Resume Worker shut down gracefully')
  process.exit(0)
}

async function healthCheck(): Promise<boolean> {
  try {
    // Check consumer connection
    if (!consumer?.isConnected()) {
      logger.warn('Consumer not connected')
      return false
    }

    // Check all database connections by running simple queries
    try {
      await dbJobs.query('SELECT 1')
      await dbPosts.query('SELECT 1')
      await dbManagement.query('SELECT 1')
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Database health check failed')
      return false
    }

    return true
  } catch (err) {
    logger.error({ err }, 'Health check failed')
    return false
  }
}

async function main(): Promise<void> {
  try {
    await initialize()

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received')
      shutdown()
    })

    process.on('SIGINT', () => {
      logger.info('SIGINT received')
      shutdown()
    })

    process.on('uncaughtException', (err) => {
      logger.error({ err }, 'Uncaught exception')
      shutdown()
    })

    process.on('unhandledRejection', (reason) => {
      logger.error({ reason }, 'Unhandled rejection')
      shutdown()
    })

    logger.info('Resume Worker is running. Press Ctrl+C to stop.')

    // Optional HTTP fallback: accepts POSTs when AMQP publishing isn't available
    if (process.env.ENABLE_HTTP_FALLBACK === 'true') {
      const port = parseInt(process.env.FALLBACK_PORT || '3005')

      fallbackServer = http.createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/fallback/resumes') {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ detail: 'Not found' }))
          return
        }

        let body = ''
        req.on('data', (chunk) => {
          body += chunk
          if (body.length > 1e6) {
            // Too large
            res.writeHead(413)
            res.end()
            req.socket.destroy()
          }
        })

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body || '{}')
            if (!payload || !payload.jobId || !payload.userId) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ detail: 'Missing jobId or userId' }))
              return
            }

            await processor.processJob(payload)

            res.writeHead(202, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ detail: 'Accepted' }))
          } catch (err) {
            logger.error({ err }, 'Fallback processing failed')
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ detail: 'Internal error' }))
          }
        })
      })

      fallbackServer.listen(port, () => {
        logger.info(
          { port },
          'HTTP fallback endpoint enabled at /fallback/resumes',
        )
      })
    }

    // Periodic health check
    setInterval(async () => {
      const healthy = await healthCheck()
      if (!healthy) {
        logger.error('Health check failed, attempting recovery...')
        // Could implement auto-recovery here
      }
    }, 30000) // Every 30 seconds
  } catch (err) {
    logger.error({ err }, 'Failed to start Resume Worker')
    process.exit(1)
  }
}

// Start the worker
main()

export { healthCheck }
