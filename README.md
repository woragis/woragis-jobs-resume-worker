# Resume Worker

TypeScript worker for processing resume generation jobs from RabbitMQ. Integrates with the resume-service and AI service to generate professional resumes.

## Features

- Consumes resume generation requests from RabbitMQ
- Connects to PostgreSQL database for persistence
- Integrates with resume-service for PDF generation
- Integrates with AI service for content generation
- Stores generated resumes and metadata
- Supports graceful shutdown
- Comprehensive error handling and logging

## Prerequisites

- Node.js 18+
- PostgreSQL 15+
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
```

## Production

```bash
# Build
npm run build

# Start
npm start
```

## Docker

Build and run with Docker:

```bash
docker build -t woragis/resume-worker:latest .
docker run -e RABBITMQ_HOST=rabbitmq --network jobs-service-network woragis/resume-worker:latest
```

## Environment Variables

- `RABBITMQ_HOST`: RabbitMQ host (default: localhost)
- `RABBITMQ_PORT`: RabbitMQ port (default: 5672)
- `RABBITMQ_USER`: RabbitMQ username
- `RABBITMQ_PASSWORD`: RabbitMQ password
- `RABBITMQ_VHOST`: RabbitMQ virtual host
- `DATABASE_URL`: PostgreSQL connection URL
- `RESUME_SERVICE_URL`: Resume service URL (default: http://localhost:8080)
- `AI_SERVICE_URL`: AI service URL (default: http://localhost:8000)
- `NODE_ENV`: Environment (development|production)
- `LOG_LEVEL`: Log level (debug|info|warn|error)

## Architecture

### Components

- **RabbitMQ Consumer**: Consumes resume generation jobs
- **Database Client**: Manages PostgreSQL connections
- **Resume Service Client**: Communicates with resume-service API
- **AI Service Client**: Communicates with AI service API
- **Job Processor**: Orchestrates resume generation workflow

### Workflow

1. Worker receives resume generation request from RabbitMQ
2. Fetches user/job data from PostgreSQL
3. Calls AI service to generate resume content
4. Calls resume-service to generate PDF
5. Stores generated resume and metadata in database
6. Updates job status in database
7. Acknowledges message to RabbitMQ

## License

MIT
