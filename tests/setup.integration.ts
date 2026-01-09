/**
 * Integration Test Setup
 * Handles database and service initialization for integration tests
 */
import { Pool } from 'pg'

let testPool: Pool

/**
 * Setup integration test environment
 */
export async function setupIntegrationTestEnv() {
  // Set test environment variables
  process.env.NODE_ENV = 'test'
  process.env.LOG_LEVEL = 'error'
  process.env.RABBITMQ_HOST = 'localhost'
  process.env.RABBITMQ_PORT = '5672'
  process.env.RABBITMQ_QUEUE = 'test-resume-jobs'

  // Initialize database connections
  testPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'resume_worker_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  })

  // Test connection
  try {
    await testPool.query('SELECT 1')
    // eslint-disable-next-line no-console
    console.log('✓ Database connected for integration tests')
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('⚠ Database not available for integration tests:', error)
  }
}

/**
 * Teardown integration test environment
 */
export async function teardownIntegrationTestEnv() {
  if (testPool) {
    await testPool.end()
  }
}
export async function resetTestDatabase() {
  if (!testPool) return

  try {
    // Truncate tables
    const tables = ['job_applications', 'resumes', 'sessions']
    for (const table of tables) {
      await testPool.query(`TRUNCATE TABLE ${table} CASCADE`)
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('Could not reset database:', error)
  }
}

/**
 * Get test database pool
 */
export function getTestPool(): Pool {
  if (!testPool) {
    throw new Error(
      'Test pool not initialized. Call setupIntegrationTestEnv first.'
    )
  }
  return testPool
}
