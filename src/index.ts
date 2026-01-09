import logger from './logger'
import { config } from './config'
import DatabaseClient from './database'
import RabbitMQConsumer from './rabbitmq'
import ResumeServiceClient from './resume-service-client'
import AIServiceClient from './ai-service-client'
import ResumeJobProcessor from './job-processor'

let db: DatabaseClient
let consumer: RabbitMQConsumer
let processor: ResumeJobProcessor

async function initialize(): Promise<void> {
  logger.info({ config }, 'Initializing Resume Worker')

  // Initialize database
  db = new DatabaseClient()
  await db.connect()

  // Initialize clients
  const resumeService = new ResumeServiceClient()
  const aiService = new AIServiceClient()

  // Initialize processor
  processor = new ResumeJobProcessor(db, resumeService, aiService)

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

  if (db) {
    await db.close()
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

    // Check database by running a simple query
    const result = await db.query('SELECT 1')
    if (result.rowCount === 0) {
      logger.warn('Database health check failed')
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
