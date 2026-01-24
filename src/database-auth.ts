import { Pool, PoolClient } from 'pg'
import { config } from './config'
import logger from './logger'

export interface AuthUser {
  id: string
  first_name: string
  last_name: string
  email: string
}

export class AuthDatabaseClient {
  private pool: Pool

  constructor() {
    this.pool = new Pool({
      connectionString:
        config.database.auth?.url || process.env.DATABASE_AUTH_URL,
      max: 10,
      connectionTimeoutMillis: 5000,
      ssl: false,
    })

    this.pool.on('error', (err: Error) => {
      logger.error({ err, db: 'auth' }, 'Unexpected error on idle client')
    })
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect()
      await client.query('SELECT 1')
      client.release()
      logger.info('Auth database connection pool initialized')
    } catch (err) {
      logger.error({ err, db: 'auth' }, 'Failed to connect to auth database')
      throw err
    }
  }

  async query<T = any>(
    text: string,
    values?: any[],
  ): Promise<{ rows: T[]; rowCount: number }> {
    try {
      const result = await this.pool.query(text, values)
      return {
        rows: result.rows as T[],
        rowCount: result.rowCount || 0,
      }
    } catch (err) {
      logger.error({ err, query: text }, 'Auth database query failed')
      throw err
    }
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect()
  }

  async getUserById(userId: string): Promise<AuthUser | null> {
    try {
      const result = await this.query<AuthUser>(
        `SELECT id, first_name, last_name, email FROM users WHERE id = $1`,
        [userId],
      )
      return result.rows[0] || null
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to fetch user from auth database')
      return null
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
