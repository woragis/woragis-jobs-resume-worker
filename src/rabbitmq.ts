import amqp from 'amqplib'
import { config, getRabbitMQUrl } from './config'
import logger from './logger'

export interface ResumeGenerationJob {
  jobId: string
  userId: string
  jobDescription: string
  userEmail?: string
  userName?: string
  metadata?: Record<string, any>
}

export type JobHandler = (job: ResumeGenerationJob) => Promise<void>

export class RabbitMQConsumer {
  private connection: any = null
  private channel: any = null
  private jobHandler: JobHandler | null = null
  private isRunning = false

  async connect(maxRetries = 5): Promise<void> {
    let attempts = 0

    while (attempts < maxRetries) {
      try {
        logger.info(
          { attempt: attempts + 1, maxRetries },
          'Connecting to RabbitMQ'
        )

        this.connection = await amqp.connect(getRabbitMQUrl())
        this.channel = await this.connection.createChannel()

        this.connection.on('error', (err: Error) => {
          logger.error({ err }, 'RabbitMQ connection error')
          this.handleConnectionError()
        })

        this.connection.on('close', () => {
          logger.warn('RabbitMQ connection closed')
          this.handleConnectionError()
        })

        logger.info('Connected to RabbitMQ')
        return
      } catch (err) {
        attempts++
        logger.warn(
          { err, attempt: attempts, maxRetries },
          'RabbitMQ connection failed, retrying...'
        )

        if (attempts < maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempts) * 1000)
          )
        }
      }
    }

    throw new Error('Failed to connect to RabbitMQ after maximum retries')
  }

  async setupQueue(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized')
    }

    const { queueName, exchange, routingKey, prefetchCount } = config.rabbitmq

    try {
      // Declare exchange
      await this.channel.assertExchange(exchange, 'direct', { durable: true })

      // Declare dead-letter exchange
      await this.channel.assertExchange('woragis.dlx', 'direct', {
        durable: true,
      })

      // Declare queue with DLX configuration
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-max-priority': 10,
          'x-dead-letter-exchange': 'woragis.dlx',
          'x-dead-letter-routing-key': 'resumes.dead-letter',
        },
      })

      // Bind queue to exchange
      await this.channel.bindQueue(queueName, exchange, routingKey)

      // Set prefetch count
      await this.channel.prefetch(prefetchCount)

      logger.info({ queueName, exchange, routingKey }, 'Queue setup completed')
    } catch (err) {
      logger.error({ err }, 'Failed to setup queue')
      throw err
    }
  }

  registerHandler(handler: JobHandler): void {
    this.jobHandler = handler
  }

  async start(): Promise<void> {
    if (!this.channel) {
      throw new Error('Channel not initialized')
    }

    if (!this.jobHandler) {
      throw new Error('Job handler not registered')
    }

    const { queueName } = config.rabbitmq
    this.isRunning = true

    try {
      await this.channel.consume(
        queueName,
        async (msg: any) => {
          if (!msg) return

          const startTime = Date.now()
          const correlationId =
            msg.properties.correlationId?.toString() || 'unknown'

          try {
            const content = msg.content.toString()
            const job = JSON.parse(content) as ResumeGenerationJob

            logger.info(
              { correlationId, jobId: job.jobId, userId: job.userId },
              'Processing resume generation job'
            )

            await this.jobHandler!(job)

            const duration = Date.now() - startTime
            logger.info(
              { correlationId, jobId: job.jobId, duration },
              'Job completed successfully'
            )

            // Acknowledge the message
            this.channel!.ack(msg)
          } catch (err) {
            const duration = Date.now() - startTime
            logger.error(
              { err, correlationId, duration },
              'Job processing failed'
            )

            // Nack and requeue (unless it's been requeued too many times)
            const retryCount =
              (msg.properties.headers?.['x-retry-count'] as number) || 0

            if (retryCount < 3) {
              this.channel!.nack(msg, false, true)
            } else {
              logger.error(
                { correlationId, retryCount },
                'Job exceeded max retries, moving to dead letter queue'
              )
              this.channel!.nack(msg, false, false)
            }
          }
        },
        { noAck: false }
      )

      logger.info({ queueName }, 'Started consuming from queue')
    } catch (err) {
      logger.error({ err }, 'Failed to start consuming')
      throw err
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false

    if (this.channel) {
      try {
        await this.channel.close()
      } catch (err) {
        logger.warn({ err }, 'Error closing channel')
      }
    }

    if (this.connection) {
      try {
        await this.connection.close()
      } catch (err) {
        logger.warn({ err }, 'Error closing connection')
      }
    }

    logger.info('RabbitMQ consumer stopped')
  }

  private handleConnectionError(): void {
    if (this.isRunning) {
      logger.warn('Attempting to reconnect to RabbitMQ...')
      setTimeout(() => this.reconnect(), 5000)
    }
  }

  private async reconnect(): Promise<void> {
    try {
      await this.connect()
      await this.setupQueue()
      await this.start()
    } catch (err) {
      logger.error({ err }, 'Reconnection failed')
    }
  }

  isConnected(): boolean {
    return !!(this.connection && this.channel && this.isRunning)
  }
}

export default RabbitMQConsumer
