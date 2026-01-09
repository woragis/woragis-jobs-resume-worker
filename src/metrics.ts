import { Registry, Counter, Histogram, Gauge } from 'prom-client'
import { config } from './config'
import logger from './logger'
import * as http from 'http'

export class MetricsService {
  private registry: Registry
  private server?: http.Server

  // Counters
  public jobsProcessedTotal: Counter<string>
  public jobsFailedTotal: Counter<string>
  public dbQueriesTotal: Counter<string>
  public dbQueryErrorsTotal: Counter<string>

  // Histograms
  public jobProcessingDuration: Histogram<string>
  public dbQueryDuration: Histogram<string>
  public aiServiceDuration: Histogram<string>

  // Gauges
  public activeJobs: Gauge<string>
  public dbConnectionsActive: Gauge<string>

  constructor() {
    this.registry = new Registry()

    // Initialize metrics
    this.jobsProcessedTotal = new Counter({
      name: 'resume_jobs_processed_total',
      help: 'Total number of resume jobs processed',
      labelNames: ['status'],
      registers: [this.registry],
    })

    this.jobsFailedTotal = new Counter({
      name: 'resume_jobs_failed_total',
      help: 'Total number of resume jobs that failed',
      labelNames: ['error_type'],
      registers: [this.registry],
    })

    this.dbQueriesTotal = new Counter({
      name: 'db_queries_total',
      help: 'Total number of database queries',
      labelNames: ['database', 'operation'],
      registers: [this.registry],
    })

    this.dbQueryErrorsTotal = new Counter({
      name: 'db_query_errors_total',
      help: 'Total number of database query errors',
      labelNames: ['database'],
      registers: [this.registry],
    })

    this.jobProcessingDuration = new Histogram({
      name: 'resume_job_processing_duration_seconds',
      help: 'Duration of resume job processing in seconds',
      buckets: [1, 5, 10, 30, 60, 120, 300],
      registers: [this.registry],
    })

    this.dbQueryDuration = new Histogram({
      name: 'db_query_duration_seconds',
      help: 'Duration of database queries in seconds',
      labelNames: ['database', 'operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
      registers: [this.registry],
    })

    this.aiServiceDuration = new Histogram({
      name: 'ai_service_duration_seconds',
      help: 'Duration of AI service calls in seconds',
      labelNames: ['endpoint'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
      registers: [this.registry],
    })

    this.activeJobs = new Gauge({
      name: 'resume_active_jobs',
      help: 'Number of currently active resume jobs',
      registers: [this.registry],
    })

    this.dbConnectionsActive = new Gauge({
      name: 'db_connections_active',
      help: 'Number of active database connections',
      labelNames: ['database'],
      registers: [this.registry],
    })
  }

  async startServer(): Promise<void> {
    if (!config.observability.metrics.enabled) {
      logger.info('Metrics server disabled')
      return
    }

    const port = config.observability.metrics.port

    this.server = http.createServer(async (req, res) => {
      if (req.url === '/metrics') {
        res.setHeader('Content-Type', this.registry.contentType)
        res.end(await this.registry.metrics())
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'healthy' }))
      } else {
        res.writeHead(404)
        res.end('Not Found')
      }
    })

    this.server.listen(port, () => {
      logger.info({ port }, 'Metrics server started')
    })
  }

  async stopServer(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          logger.info('Metrics server stopped')
          resolve()
        })
      })
    }
  }
}

// Singleton instance
export const metricsService = new MetricsService()
