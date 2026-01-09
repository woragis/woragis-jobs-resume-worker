import { Pool, PoolClient } from 'pg'
import { config } from './config'
import logger from './logger'

export class DatabaseClient {
  private pool: Pool

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.jobs.url,
      max: config.database.jobs.poolSize,
      connectionTimeoutMillis: config.database.jobs.connectionTimeout,
      ssl: config.database.jobs.ssl ? { rejectUnauthorized: false } : false,
    })

    this.pool.on('error', (err: Error) => {
      logger.error({ err, db: 'jobs' }, 'Unexpected error on idle client')
    })
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect()
      await client.query('SELECT 1')
      client.release()
      logger.info('Jobs database connection pool initialized')
    } catch (err) {
      logger.error({ err, db: 'jobs' }, 'Failed to connect to jobs database')
      throw err
    }
  }

  async query<T = any>(
    text: string,
    values?: any[]
  ): Promise<{ rows: T[]; rowCount: number }> {
    try {
      const result = await this.pool.query(text, values)
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount || 0,
      }
    } catch (err) {
      logger.error({ err, query: text }, 'Database query failed')
      throw err
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect()
  }

  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClient()
    try {
      await client.query('BEGIN')
      const result = await callback(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      logger.error({ err }, 'Transaction failed')
      throw err
    } finally {
      client.release()
    }
  }

  async getResumeJobById(jobId: string): Promise<ResumeJob | null> {
    const result = await this.query<ResumeJob>(
      `SELECT * FROM resume_jobs WHERE id = $1`,
      [jobId]
    )
    return result.rows[0] || null
  }

  async updateResumeJobStatus(
    jobId: string,
    status: JobStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    await this.query(
      `UPDATE resume_jobs 
       SET status = $1, metadata = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, JSON.stringify(metadata || {}), jobId]
    )
  }

  async createResumeRecord(
    jobId: string,
    userId: string,
    filePath: string,
    metadata: Record<string, any>
  ): Promise<void> {
    await this.query(
      `INSERT INTO resumes (id, job_id, user_id, file_path, metadata, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [jobId, userId, filePath, JSON.stringify(metadata)]
    )
  }

  async close(): Promise<void> {
    await this.pool.end()
    logger.info('Database connection pool closed')
  }
}

export interface ResumeJob {
  id: string
  user_id: string
  job_description: string
  status: JobStatus
  metadata: Record<string, any>
  created_at: Date
  updated_at: Date
}

export type JobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export default DatabaseClient
