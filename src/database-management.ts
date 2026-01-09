import { Pool, PoolClient } from 'pg'
import { config } from './config'
import logger from './logger'

export interface Project {
  id: string
  user_id: string
  name: string
  description?: string
  status?: string
  slug?: string
  created_at: Date
  updated_at: Date
}

export interface Experience {
  id: string
  user_id: string
  company: string
  position: string
  period_start?: Date
  period_end?: Date
  period_text?: string
  description?: string
  is_current?: boolean
  location?: string
  type?: string
  display_order?: number
}

export class ManagementDatabaseClient {
  private pool: Pool

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.management.url,
      max: config.database.management.poolSize,
      connectionTimeoutMillis: config.database.management.connectionTimeout,
      ssl: config.database.management.ssl
        ? { rejectUnauthorized: false }
        : false,
    })

    this.pool.on('error', (err: Error) => {
      logger.error({ err, db: 'management' }, 'Unexpected error on idle client')
    })
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect()
      await client.query('SELECT 1')
      client.release()
      logger.info('Management database connection pool initialized')
    } catch (err) {
      logger.error(
        { err, db: 'management' },
        'Failed to connect to management database'
      )
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
      logger.error(
        { err, query: text, db: 'management' },
        'Database query failed'
      )
      throw err
    }
  }

  async getProjects(userId: string, limit: number = 50): Promise<Project[]> {
    try {
      const result = await this.pool.query<Project>(
        `SELECT id, user_id, name, description, status, slug, created_at, updated_at
         FROM projects
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      )
      logger.debug({ userId, count: result.rowCount }, 'Fetched projects')
      return result.rows
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch projects')
      throw err
    }
  }

  async getExperiences(
    userId: string,
    limit: number = 50
  ): Promise<Experience[]> {
    try {
      const result = await this.pool.query<Experience>(
        `SELECT id, user_id, company, position, period_start, period_end, 
                period_text, description, is_current, location, type, display_order
         FROM experiences
         WHERE user_id = $1
         ORDER BY display_order ASC, period_start DESC NULLS LAST
         LIMIT $2`,
        [userId, limit]
      )
      logger.debug({ userId, count: result.rowCount }, 'Fetched experiences')
      return result.rows
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch experiences')
      throw err
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
    logger.info('Management database connection pool closed')
  }
}

export default ManagementDatabaseClient
