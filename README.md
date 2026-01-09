# Resume Worker

TypeScript worker for processing resume generation jobs from RabbitMQ. Integrates with multiple databases, resume-service, and AI service to generate professional resumes enriched with user data from posts and management services.

## Features

- ✅ **Multi-Database Support**: Connects to 3 PostgreSQL databases (jobs, posts, management)
- ✅ **Data Aggregation**: Fetches technical writings, posts, system designs, projects, and experiences
- ✅ **Observability**: Prometheus metrics, structured logging, health checks
- ✅ **Reliability**: Exponential backoff retries, circuit breakers, dead-letter queue support
- ✅ **Security**: TLS support, API key authentication for services
- ✅ **RabbitMQ Integration**: Consumes resume generation requests with prefetch control
- ✅ **Graceful Shutdown**: Proper cleanup of all database connections and consumers

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (3 databases: jobs, posts, management)
- RabbitMQ 3.13+
- Resume Service running
- AI Service running

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file based on `.env.sample`:

```bash
cp .env.sample .env
```

### Required Environment Variables

The worker will fail to start if these are not set:

- `DATABASE_URL`: Jobs database (stores generated resumes)
- `DATABASE_URL_POSTS`: Posts database (technical writings, posts, system designs)
- `DATABASE_URL_MANAGEMENT`: Management database (projects, experiences)
- `RABBITMQ_HOST`: RabbitMQ hostname

See `.env.sample` for all available configuration options.

## Development

```bash
# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Watch for changes
npm run watch

# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## Production

```bash
# Build
npm run build

# Start
npm start
```

## Docker

Build and run with Docker Compose (recommended):

```bash
cd ../../../  # Go to jobs service root
docker-compose up woragis-jobs-resume-worker
```

Or build standalone:

```bash
docker build -t woragis/resume-worker:latest .
docker run \
  -e DATABASE_URL=postgres://... \
  -e DATABASE_URL_POSTS=postgres://... \
  -e DATABASE_URL_MANAGEMENT=postgres://... \
  -e RABBITMQ_HOST=rabbitmq \
  --network jobs-service-network \
  woragis/resume-worker:latest
```

## Observability

### Metrics

Prometheus metrics are exposed on port `9090` (configurable via `METRICS_PORT`):

```bash
curl http://localhost:9090/metrics
```

**Available metrics:**

- `resume_jobs_processed_total`: Total jobs processed (by status)
- `resume_jobs_failed_total`: Total failed jobs (by error type)
- `resume_job_processing_duration_seconds`: Job processing time histogram
- `resume_active_jobs`: Currently active jobs gauge
- `db_queries_total`: Total DB queries (by database and operation)
- `db_query_duration_seconds`: DB query latency histogram

### Health Checks

```bash
curl http://localhost:9090/health
```

### Logging

Structured JSON logs with levels: `debug`, `info`, `warn`, `error`. Set `LOG_LEVEL` environment variable to control verbosity.

## Architecture

### Databases

1. **Jobs Database** (`DATABASE_URL`): Stores resume generation jobs and generated resume records
2. **Posts Database** (`DATABASE_URL_POSTS`): Retrieves technical writings, blog posts, system designs
3. **Management Database** (`DATABASE_URL_MANAGEMENT`): Retrieves user projects and work experiences

### Workflow

1. Worker receives resume generation request from RabbitMQ
2. **Fetches data from Jobs DB**: Resume job details
3. **Fetches data from Posts DB** (with retry):
   - Technical writings (articles, tutorials, case studies)
   - Blog posts
   - System design documents
4. **Fetches data from Management DB** (with retry):
   - User projects
   - Work experiences
5. Sends aggregated data to resume-service for PDF generation
6. Stores generated resume metadata and file path in Jobs DB
7. Acknowledges message in RabbitMQ

### Components

- **Config**: Centralized configuration with fail-fast validation
- **Database Clients**: Separate pooled connections for jobs, posts, management
- **RabbitMQ Consumer**: Message consumer with prefetch and DLQ support
- **Job Processor**: Orchestrates workflow with metrics and retry logic
- **Resume Service Client**: HTTP client with API key auth
- **AI Service Client**: HTTP client for content generation
- **Metrics Service**: Prometheus exporter
- **Retry Utility**: Exponential backoff with configurable limits

## Reliability Features

### Retries

Exponential backoff retry on:

- Database queries (3 attempts by default)
- External service calls (configurable via `RETRY_MAX_ATTEMPTS`)

### Circuit Breaker

Prevents cascading failures (configurable via `CIRCUIT_BREAKER_*` env vars).

### Dead-Letter Queue

Failed messages are routed to `resumes.dlq` after max retries.

## Security

- **TLS Support**: Enable via `DATABASE_SSL`, `DATABASE_POSTS_SSL`, `DATABASE_MANAGEMENT_SSL`
- **API Keys**: Set `RESUME_SERVICE_API_KEY` and `AI_SERVICE_API_KEY` for service authentication
- **Connection Pooling**: Limits concurrent database connections
- **Secrets Management**: All sensitive values via environment variables

## Testing

Run unit tests:

```bash
npm test
```

Run with coverage:

```bash
npm run test:coverage
```

## Monitoring & Debugging

### View Logs

```bash
docker logs -f woragis-jobs-resume-worker
```

### Check Metrics

```bash
curl http://localhost:9091/metrics | grep resume
```

### Inspect RabbitMQ Queue

Access management UI at `http://localhost:15682` (credentials: `woragis/woragis`)

## Troubleshooting

**Worker fails to start:**

- Check all 3 `DATABASE_URL_*` variables are set
- Verify databases are accessible
- Check RabbitMQ connection

**Jobs timing out:**

- Increase `RESUME_SERVICE_TIMEOUT`
- Check resume-service and AI-service are running
- Review logs for specific errors

**High memory usage:**

- Reduce `DATABASE_POOL_SIZE` and `*_POOL_SIZE` values
- Lower `WORKER_CONCURRENCY`

## License

MIT - Licensed under the MIT License.
