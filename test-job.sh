#!/bin/bash

# Resume Worker Test Script
# This script demonstrates how to trigger a resume generation job

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Resume Worker Integration Test${NC}"
echo "=================================="
echo ""

# Configuration
RABBITMQ_HOST="${RABBITMQ_HOST:-localhost}"
RABBITMQ_PORT="${RABBITMQ_PORT:-5672}"
RABBITMQ_USER="${RABBITMQ_USER:-woragis}"
RABBITMQ_PASSWORD="${RABBITMQ_PASSWORD:-woragis}"
RABBITMQ_VHOST="${RABBITMQ_VHOST:-/}"
RABBITMQ_QUEUE="${RABBITMQ_QUEUE:-resumes.queue}"

# Check if amqp-utils is installed
if ! command -v amqp-publish &> /dev/null; then
    echo -e "${YELLOW}Installing amqp-utils for RabbitMQ testing...${NC}"
    # Note: This is platform-specific. Adjust for your system.
    # On Ubuntu: sudo apt-get install amqp-utils
    # On macOS: brew install rabbitmq-c
fi

# Create a sample resume generation job
JOB_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
USER_ID="test-user-$(date +%s)"

PAYLOAD=$(cat <<EOF
{
  "jobId": "$JOB_ID",
  "userId": "$USER_ID",
  "jobDescription": "We are looking for a Senior Backend Engineer with 5+ years of experience in Go, microservices, and distributed systems. Required skills: Go, PostgreSQL, RabbitMQ, Docker, Kubernetes. Nice to have: gRPC, Protocol Buffers, OpenTelemetry.",
  "metadata": {
    "testRun": true,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }
}
EOF
)

echo -e "${GREEN}Test Payload:${NC}"
echo "$PAYLOAD" | jq '.' 2>/dev/null || echo "$PAYLOAD"
echo ""

echo -e "${YELLOW}Attempting to send job to RabbitMQ...${NC}"
echo "Queue: $RABBITMQ_QUEUE"
echo "Host: $RABBITMQ_HOST:$RABBITMQ_PORT"
echo ""

# Try to publish using Python if available
if command -v python3 &> /dev/null; then
    echo -e "${YELLOW}Using Python to publish message...${NC}"
    python3 << PYTHON_SCRIPT
import pika
import json

rabbitmq_url = f"amqp://{os.environ.get('RABBITMQ_USER', 'woragis')}:{os.environ.get('RABBITMQ_PASSWORD', 'woragis')}@{os.environ.get('RABBITMQ_HOST', 'localhost')}:5672/"

try:
    connection = pika.BlockingConnection(pika.URLParameters(rabbitmq_url))
    channel = connection.channel()
    
    # Declare queue
    channel.queue_declare(queue='resumes.queue', durable=True)
    
    # Publish message
    channel.basic_publish(
        exchange='',
        routing_key='resumes.queue',
        body='''$PAYLOAD''',
        properties=pika.BasicProperties(
            content_type='application/json',
            delivery_mode=2  # persistent
        )
    )
    
    print("✓ Message published successfully!")
    print(f"  Job ID: $JOB_ID")
    print(f"  User ID: $USER_ID")
    
    connection.close()
except Exception as e:
    print(f"✗ Failed to publish message: {e}")
    exit(1)
PYTHON_SCRIPT
else
    echo -e "${YELLOW}Python not available, skipping actual RabbitMQ test${NC}"
    echo -e "${GREEN}✓ Payload would be sent to RabbitMQ queue 'resumes.queue'${NC}"
    echo ""
    echo -e "${YELLOW}To manually test, you can:${NC}"
    echo "1. Use the RabbitMQ Management UI at http://localhost:15672"
    echo "2. Publish this message to the 'resumes.queue' queue:"
    echo ""
    echo "$PAYLOAD" | jq '.' 2>/dev/null || echo "$PAYLOAD"
fi

echo ""
echo -e "${GREEN}Test instructions:${NC}"
echo "1. Ensure resume-service is running and healthy"
echo "2. Ensure AI service is running and healthy"
echo "3. The resume-worker will process the job from the queue"
echo "4. Check resume-worker logs for processing status"
echo ""
echo -e "${YELLOW}To view logs:${NC}"
echo "  docker logs -f woragis-jobs-resume-worker"
