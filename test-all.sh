#!/bin/bash

# Local test runner for all workers and services
# Usage: ./test-all.sh

set -e

echo "🧪 Running comprehensive tests for all workers and services..."
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Function to run tests and track results
run_service_tests() {
    local service_name=$1
    local test_command=$2
    local service_path=$3

    echo -e "${YELLOW}Testing $service_name...${NC}"
    echo "Path: $service_path"
    echo "Command: $test_command"
    echo ""

    if cd "$service_path" && eval "$test_command"; then
        echo -e "${GREEN}✓ $service_name tests passed${NC}"
        ((PASSED_TESTS++))
    else
        echo -e "${RED}✗ $service_name tests failed${NC}"
        ((FAILED_TESTS++))
    fi

    ((TOTAL_TESTS++))
    echo ""
    echo "---"
    echo ""
}

# Change to workspace root
cd "$(dirname "$0")"

# Test resume-worker (TypeScript)
echo -e "${YELLOW}=== TYPESCRIPT WORKER ===${NC}"
echo ""
run_service_tests \
    "resume-worker" \
    "npm install && npm run lint && npm test" \
    "./resume-worker"

# Test ai-service (Python)
echo -e "${YELLOW}=== PYTHON SERVICES ===${NC}"
echo ""
run_service_tests \
    "ai-service" \
    "pip install -r requirements-test.txt && python -m pytest tests/ -v --cov=app" \
    "../../../Services-Workers/ai-service"

# Test creative-service (Python)
run_service_tests \
    "creative-service" \
    "pip install -r requirements.txt && python -m pytest tests/ -v --cov=app" \
    "../../../Services-Workers/creative-service"

# Test resume-service (Python)
run_service_tests \
    "resume-service" \
    "pip install -r requirements.txt && python -m pytest tests/ -v --cov=src" \
    "../../../Services-Workers/resume-service"

# Print summary
echo ""
echo "================================"
echo -e "${YELLOW}TEST SUMMARY${NC}"
echo "================================"
echo "Total Services: $TOTAL_TESTS"
echo -e "${GREEN}Passed: $PASSED_TESTS${NC}"
echo -e "${RED}Failed: $FAILED_TESTS${NC}"
echo "================================"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed!${NC}"
    exit 1
fi
