import { Pool, PoolClient } from 'pg'
import { config } from './config'
import logger from './logger'

export interface TechnicalWriting {
  id: string
  user_id: string
  title: string
  description: string
  content?: string
  url: string
  excerpt?: string
  published_at?: Date
  topics?: string[]
  technologies?: string[]
  type?: string
  platform?: string
}

export interface Post {
  id: string
  user_id: string
  title: string
  excerpt?: string
  content?: string
  url?: string
  tags?: string[]
  created_at: Date
}

export interface SystemDesign {
  id: string
  user_id: string
  title: string
  description: string
  components?: any
  data_flow?: string
  diagram?: string
  created_at: Date
}

export class PostsDatabaseClient {
  private pool: Pool

  constructor() {
    this.pool = new Pool({
      connectionString: config.database.posts.url,
      max: config.database.posts.poolSize,
      connectionTimeoutMillis: config.database.posts.connectionTimeout,
      ssl: config.database.posts.ssl ? { rejectUnauthorized: false } : false,
    })

    this.pool.on('error', (err: Error) => {
      logger.error({ err, db: 'posts' }, 'Unexpected error on idle client')
    })
  }

  async connect(): Promise<void> {
    try {
      const client = await this.pool.connect()
      await client.query('SELECT 1')
      client.release()
      logger.info('Posts database connection pool initialized')
    } catch (err) {
      logger.error({ err, db: 'posts' }, 'Failed to connect to posts database')
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
      logger.error({ err, query: text, db: 'posts' }, 'Database query failed')
      throw err
    }
  }

  async getTechnicalWritings(
    userId: string,
    limit: number = 50
  ): Promise<TechnicalWriting[]> {
    try {
      const result = await this.pool.query<TechnicalWriting>(
        `SELECT id, user_id, title, description, content, url, excerpt, 
                published_at, topics, technologies, type, platform
         FROM technical_writings
         WHERE user_id = $1
         ORDER BY published_at DESC NULLS LAST, created_at DESC
         LIMIT $2`,
        [userId, limit]
      )
      logger.debug(
        { userId, count: result.rowCount },
        'Fetched technical writings'
      )
      return result.rows
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch technical writings')
      throw err
    }
  }

  async getPosts(userId: string, limit: number = 50): Promise<Post[]> {
    try {
      const result = await this.pool.query<Post>(
        `SELECT id, user_id, title, excerpt, content, url, tags, created_at
         FROM posts
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      )
      logger.debug({ userId, count: result.rowCount }, 'Fetched posts')
      return result.rows
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch posts')
      throw err
    }
  }

  async getSystemDesigns(
    userId: string,
    limit: number = 50
  ): Promise<SystemDesign[]> {
    try {
      const result = await this.pool.query<SystemDesign>(
        `SELECT id, user_id, title, description, components, data_flow, diagram, created_at
         FROM system_designs
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [userId, limit]
      )
      logger.debug({ userId, count: result.rowCount }, 'Fetched system designs')
      return result.rows
    } catch (err) {
      logger.error({ err, userId }, 'Failed to fetch system designs')
      throw err
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
    logger.info('Posts database connection pool closed')
  }
}

export default PostsDatabaseClient
