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
    // Dead Letter Queue for failed messages
    dlqName: process.env.RABBITMQ_DLQ_NAME || 'resumes.dlq',
    dlqExchange: process.env.RABBITMQ_DLQ_EXCHANGE || 'woragis.dlq',
  },

  // Databases (all required in production)
  database: {
    // Jobs database (for storing resumes)
    jobs: {
      url: process.env.DATABASE_URL,
      poolSize: parseInt(process.env.DATABASE_POOL_SIZE || '20'),
      connectionTimeout: parseInt(process.env.DATABASE_TIMEOUT || '10000'),
      ssl: process.env.DATABASE_SSL === 'true',
    },
    // Posts database (for retrieving technical writings, posts, system designs)
    posts: {
      url: process.env.DATABASE_URL_POSTS,
      poolSize: parseInt(process.env.DATABASE_POSTS_POOL_SIZE || '10'),
      connectionTimeout: parseInt(process.env.DATABASE_TIMEOUT || '10000'),
      ssl: process.env.DATABASE_POSTS_SSL === 'true',
    },
    // Management database (for retrieving projects, experiences)
    management: {
      url: process.env.DATABASE_URL_MANAGEMENT,
      poolSize: parseInt(process.env.DATABASE_MANAGEMENT_POOL_SIZE || '10'),
      connectionTimeout: parseInt(process.env.DATABASE_TIMEOUT || '10000'),
      ssl: process.env.DATABASE_MANAGEMENT_SSL === 'true',
    },
  },

  // Services
  services: {
    resumeService: {
      url: process.env.RESUME_SERVICE_URL || 'http://localhost:8080',
      timeout: parseInt(process.env.RESUME_SERVICE_TIMEOUT || '300000'), // 5 min
      apiKey: process.env.RESUME_SERVICE_API_KEY,
    },
    aiService: {
      url: process.env.AI_SERVICE_URL || 'http://localhost:8000',
      timeout: parseInt(process.env.AI_SERVICE_TIMEOUT || '60000'), // 1 min
      apiKey: process.env.AI_SERVICE_API_KEY,
      parseEndpoint: process.env.AI_PARSE_ENDPOINT || '/api/v1/parse_resume',
    },
  },

  // Application
  app: {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || '5'),
    storagePath: process.env.STORAGE_PATH || './storage/resumes',
  },

  // Retry configuration
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS || '3'),
    initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY || '1000'), // 1 sec
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY || '30000'), // 30 sec
    backoffMultiplier: parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2'),
  },

  // Circuit breaker configuration
  circuitBreaker: {
    enabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
    failureThreshold: parseInt(
      process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'
    ),
    resetTimeout: parseInt(
      process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '60000'
    ), // 1 min
  },

  // Observability
  observability: {
    metrics: {
      enabled: process.env.METRICS_ENABLED !== 'false',
      port: parseInt(process.env.METRICS_PORT || '9090'),
    },
    tracing: {
      enabled: process.env.JAEGER_ENABLED !== 'false',
      serviceName: process.env.JAEGER_SERVICE_NAME || 'resume-worker',
      agentHost: process.env.JAEGER_AGENT_HOST || 'localhost',
      agentPort: parseInt(process.env.JAEGER_AGENT_PORT || '6831'),
    },
  },
}

export const getRabbitMQUrl = (): string => {
  const { rabbitmq } = config
  return `amqp://${encodeURIComponent(rabbitmq.user)}:${encodeURIComponent(
    rabbitmq.password
  )}@${rabbitmq.host}:${rabbitmq.port}/${encodeURIComponent(rabbitmq.vhost)}`
}

/**
 * Validates required environment variables on startup.
 * Exits with error code 1 if any required variables are missing.
 */
export function validateConfig(): void {
  const required = [
    { key: 'DATABASE_URL', value: config.database.jobs.url },
    { key: 'DATABASE_URL_POSTS', value: config.database.posts.url },
    { key: 'DATABASE_URL_MANAGEMENT', value: config.database.management.url },
    { key: 'RABBITMQ_HOST', value: config.rabbitmq.host },
  ]

  const missing: string[] = []

  for (const { key, value } of required) {
    if (!value) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    console.error(
      `❌ FATAL: Missing required environment variables:\n  ${missing.join(
        '\n  '
      )}`
    )
    console.error(
      '\nPlease set these variables in your .env file or environment.'
    )
    process.exit(1)
  }

  // Validate database URLs format
  const dbUrls = [
    { name: 'DATABASE_URL', url: config.database.jobs.url },
    { name: 'DATABASE_URL_POSTS', url: config.database.posts.url },
    { name: 'DATABASE_URL_MANAGEMENT', url: config.database.management.url },
  ]

  for (const { name, url } of dbUrls) {
    if (
      url &&
      !url.startsWith('postgres://') &&
      !url.startsWith('postgresql://')
    ) {
      console.error(
        `❌ FATAL: ${name} must be a valid PostgreSQL connection string`
      )
      process.exit(1)
    }
  }

  // eslint-disable-next-line no-console
  console.log('✓ Configuration validated successfully')
}
