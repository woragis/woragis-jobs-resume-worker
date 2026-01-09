# Resume Worker Integration Guide

## Overview

The resume-worker is a TypeScript-based microservice that processes resume generation jobs from RabbitMQ. It integrates with:

- **Resume Service**: Generates PDFs from structured resume data
- **AI Service**: Generates tailored resume content based on job descriptions
- **PostgreSQL**: Stores job metadata and resume information
- **RabbitMQ**: Consumes resume generation requests

## Architecture

```
┌─────────────────┐
│   Job Service   │
└────────┬────────┘
         │
    [RabbitMQ Queue: resumes.queue]
         │
┌────────▼──────────────────┐
│   Resume Worker           │
│  (TypeScript/Node.js)     │
└────────┬─────────────┬────┘
         │             │
    ┌────▼────┐   ┌────▼──────────┐
    │Database │   │Resume Service │ ◄──► AI Service
    │(Jobs)   │   │(PDF Gen)      │
    └─────────┘   └───────────────┘
```

## Prerequisites

1. **Node.js 18+**: Runtime environment
2. **PostgreSQL 15**: For job and resume metadata storage
3. **RabbitMQ 3.13**: Message queue for job distribution
4. **Resume Service v2.0.0**: For PDF generation
5. **AI Service**: For content generation
6. **Docker**: For containerization

## Installation & Setup

### 1. Environment Variables

Copy `.env.sample` to `.env`:

```bash
cp .env.sample .env
```

Update the following variables as needed:

```env
# RabbitMQ
RABBITMQ_HOST=woragis-jobs-rabbitmq
RABBITMQ_PORT=5672
RABBITMQ_USER=woragis
RABBITMQ_PASSWORD=woragis
RABBITMQ_VHOST=/
RABBITMQ_QUEUE_NAME=resumes.queue
RABBITMQ_EXCHANGE=woragis.tasks
RABBITMQ_ROUTING_KEY=resumes.generate

# Database
DATABASE_URL=postgres://woragis:password@woragis-jobs-database:5432/jobs_service?sslmode=disable

# Services
RESUME_SERVICE_URL=http://woragis-jobs-resume-service:8080
AI_SERVICE_URL=http://woragis-jobs-ai-service:8000

# Application
NODE_ENV=production
LOG_LEVEL=info
WORKER_CONCURRENCY=5
```

### 2. Database Setup

Run the migration to create necessary tables:

```bash
psql -d jobs_service -f migrations.sql
```

Or during Docker deployment, the tables will be created automatically when the worker initializes.

### 3. Building Locally

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Run tests
npm test
```

### 4. Docker Deployment

The docker-compose.yml includes the resume-worker service:

```yaml
woragis-jobs-resume-worker:
  build:
    context: ./workers/resume-worker
    dockerfile: Dockerfile
  container_name: woragis-jobs-resume-worker
  depends_on:
    woragis-jobs-database:
      condition: service_healthy
    woragis-jobs-rabbitmq:
      condition: service_healthy
    woragis-jobs-resume-service:
      condition: service_healthy
    woragis-jobs-ai-service:
      condition: service_healthy
  environment:
    RABBITMQ_HOST: woragis-jobs-rabbitmq
    DATABASE_URL: postgres://woragis:password@woragis-jobs-database:5432/jobs_service
    RESUME_SERVICE_URL: http://woragis-jobs-resume-service:8080
    AI_SERVICE_URL: http://woragis-jobs-ai-service:8000
  restart: on-failure
  networks:
    - jobs-service-network
```

## Workflow

### Job Processing Flow

1. **Job Submission**: A client publishes a resume generation request to RabbitMQ
2. **Job Received**: Resume worker receives the message from the queue
3. **Status Update**: Worker updates job status to `processing` in PostgreSQL
4. **Content Generation**: Worker calls AI Service to generate tailored content
5. **PDF Generation**: Worker calls Resume Service to generate PDF
6. **Storage**: Generated resume is stored and referenced in database
7. **Completion**: Job status updated to `completed` with resume metadata
8. **Acknowledgment**: Message acknowledged to RabbitMQ

### Message Format

Resume generation requests should follow this format:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user-123",
  "jobDescription": "Senior Backend Engineer with 5+ years experience in Go, microservices...",
  "metadata": {
    "priority": "high",
    "template": "modern"
  }
}
```

### Resume Job States

- **pending**: Job received, waiting to be processed
- **processing**: Job actively being processed
- **completed**: Job successfully completed, resume generated
- **failed**: Job processing failed
- **cancelled**: Job was cancelled

## Testing

### Unit Tests

```bash
npm test
```

### Integration Testing

1. **Start the stack**:

   ```bash
   docker-compose up -d
   ```

2. **Verify services are healthy**:

   ```bash
   docker-compose ps
   ```

3. **Send a test job** (using the provided test script):

   ```bash
   bash test-job.sh
   ```

4. **Monitor logs**:
   ```bash
   docker logs -f woragis-jobs-resume-worker
   ```

### Manual Testing with cURL

Check service health:

```bash
# Resume Service
curl http://localhost:8031/healthz

# AI Service
curl http://localhost:8011/healthz
```

## Monitoring & Logs

### Viewing Logs

```bash
# Real-time logs
docker logs -f woragis-jobs-resume-worker

# Last 100 lines
docker logs --tail 100 woragis-jobs-resume-worker

# With timestamps
docker logs -f --timestamps woragis-jobs-resume-worker
```

### Key Metrics to Monitor

- **Job Processing Time**: Time from job submission to completion
- **Success Rate**: Percentage of successfully completed jobs
- **Error Rates**: Failed job processing attempts
- **Queue Depth**: Number of pending jobs in RabbitMQ
- **Service Dependencies**: Health of resume-service and AI service

### Health Checks

The worker includes automatic health checks:

```bash
# Check in Docker logs
docker logs woragis-jobs-resume-worker | grep "health"
```

## Troubleshooting

### Worker Not Processing Jobs

1. **Check RabbitMQ Connection**:

   ```bash
   docker logs woragis-jobs-rabbitmq | grep -i error
   ```

2. **Verify Queue Exists**:

   ```bash
   docker exec woragis-jobs-rabbitmq rabbitmqctl list_queues
   ```

3. **Check Database Connection**:
   ```bash
   docker logs woragis-jobs-resume-worker | grep -i database
   ```

### Resume Service Not Available

```bash
docker logs woragis-jobs-resume-service
docker exec woragis-jobs-resume-service curl http://localhost:8080/healthz
```

### AI Service Connection Issues

```bash
docker logs woragis-jobs-ai-service
docker exec woragis-jobs-ai-service curl http://localhost:8000/healthz
```

### Database Issues

```bash
# Check database connectivity
docker exec woragis-jobs-database psql -U woragis -d jobs_service -c "SELECT 1"

# Check resume_jobs table
docker exec woragis-jobs-database psql -U woragis -d jobs_service -c "SELECT COUNT(*) FROM resume_jobs;"
```

## Performance Tuning

### Configuration Options

- **WORKER_CONCURRENCY**: Number of simultaneous jobs (default: 5)
- **RABBITMQ_PREFETCH_COUNT**: Jobs to fetch from queue (default: 5)
- **DATABASE_POOL_SIZE**: Connection pool size (default: 20)

### Optimization Tips

1. **Increase Worker Concurrency**: For high-throughput scenarios

   ```env
   WORKER_CONCURRENCY=10
   ```

2. **Adjust Database Pool**: Based on concurrent job count

   ```env
   DATABASE_POOL_SIZE=30
   ```

3. **Monitor Queue Depth**: Adjust prefetch count if bottleneck exists
   ```env
   RABBITMQ_PREFETCH_COUNT=10
   ```

## Database Schema

### resume_jobs Table

```sql
CREATE TABLE resume_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  job_description TEXT NOT NULL,
  status VARCHAR(50) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

### resumes Table

```sql
CREATE TABLE resumes (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL,
  user_id UUID NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

## API Integration

### Publishing Jobs to RabbitMQ

**Node.js Example**:

```typescript
import amqp from 'amqplib'

const connection = await amqp.connect(rabbitmqUrl)
const channel = await connection.createChannel()

const message = {
  jobId: 'unique-job-id',
  userId: 'user-123',
  jobDescription: 'Job requirements...',
  metadata: { priority: 'high' },
}

await channel.assertQueue('resumes.queue', { durable: true })
channel.sendToQueue('resumes.queue', Buffer.from(JSON.stringify(message)), {
  persistent: true,
})
```

**Python Example**:

```python
import pika
import json

connection = pika.BlockingConnection(pika.ConnectionParameters('rabbitmq-host'))
channel = connection.channel()

message = {
    'jobId': 'unique-job-id',
    'userId': 'user-123',
    'jobDescription': 'Job requirements...',
    'metadata': {'priority': 'high'}
}

channel.queue_declare(queue='resumes.queue', durable=True)
channel.basic_publish(
    exchange='',
    routing_key='resumes.queue',
    body=json.dumps(message),
    properties=pika.BasicProperties(delivery_mode=2)
)
```

## Development

### Project Structure

```
resume-worker/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── config.ts                # Configuration management
│   ├── logger.ts                # Logging setup
│   ├── database.ts              # Database client
│   ├── rabbitmq.ts              # RabbitMQ consumer
│   ├── ai-service-client.ts     # AI Service API client
│   ├── resume-service-client.ts # Resume Service API client
│   └── job-processor.ts         # Job processing logic
├── dist/                        # Compiled JavaScript
├── Dockerfile                   # Container definition
├── docker-compose.yml           # (in jobs folder)
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript config
└── README.md                    # This file
```

## License

MIT
