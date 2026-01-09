import dotenv from 'dotenv'

dotenv.config()

export const config = {
  // RabbitMQ
  rabbitmq: {
    host: process.env.RABBITMQ_HOST || 'localhost',
    port: parseInt(process.env.RABBITMQ_PORT || '5672'),
    user: process.env.RABBITMQ_USER || 'guest',
    password: process.env.RABBITMQ_PASSWORD || 'guest',
    vhost: process.env.RABBITMQ_VHOST || '/',
    queueName: process.env.RABBITMQ_QUEUE_NAME || 'resumes.queue',
    exchange: process.env.RABBITMQ_EXCHANGE || 'woragis.tasks',
    routingKey: process.env.RABBITMQ_ROUTING_KEY || 'resumes.generate',
    prefetchCount: parseInt(process.env.RABBITMQ_PREFETCH_COUNT || '5'),
  },

  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgres://localhost/jobs_service',
    poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '20'),
  },

  // Services
  services: {
    resumeService: process.env.RESUME_SERVICE_URL || 'http://localhost:8080',
    aiService: process.env.AI_SERVICE_URL || 'http://localhost:8000',
  },

  // Application
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
    storagePath: process.env.STORAGE_PATH || './storage/resumes',
  },
}

export const getRabbitMQUrl = (): string => {
  const { rabbitmq } = config
  return `amqp://${encodeURIComponent(rabbitmq.user)}:${encodeURIComponent(
    rabbitmq.password
  )}@${rabbitmq.host}:${rabbitmq.port}/${encodeURIComponent(rabbitmq.vhost)}`
}
