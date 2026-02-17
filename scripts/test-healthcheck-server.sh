#!/bin/bash
# Test the dedicated health check server

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

TEST_RESULTS=0

echo -e "${BLUE}🚀 Health Check Server Test Suite${NC}"
echo ""

# Test 1: Server file exists
echo -e "${YELLOW}[Test 1] Health check server file exists${NC}"
if [[ -f "src/healthcheck-server.js" ]]; then
  echo -e "${GREEN}✓ src/healthcheck-server.js exists${NC}"
else
  echo -e "${RED}✗ src/healthcheck-server.js missing${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 2: Start script exists and is executable
echo -e "${YELLOW}[Test 2] Start script exists and is executable${NC}"
if [[ -x "scripts/start.sh" ]]; then
  echo -e "${GREEN}✓ scripts/start.sh is executable${NC}"
else
  echo -e "${RED}✗ scripts/start.sh missing or not executable${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 3: Syntax check
echo -e "${YELLOW}[Test 3] Node.js syntax check${NC}"
if node -c src/healthcheck-server.js 2>/dev/null; then
  echo -e "${GREEN}✓ src/healthcheck-server.js syntax OK${NC}"
else
  echo -e "${RED}✗ src/healthcheck-server.js has syntax errors${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 4: Configuration via environment variables
echo -e "${YELLOW}[Test 4] Environment variable configuration${NC}"
MISSING_ENV=false

if grep -q "HEALTH_CHECK_PORT" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ HEALTH_CHECK_PORT configurable${NC}"
else
  echo -e "${RED}✗ HEALTH_CHECK_PORT not found${NC}"
  MISSING_ENV=true
fi

if grep -q "HEALTH_CHECK_PATH" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ HEALTH_CHECK_PATH configurable${NC}"
else
  echo -e "${RED}✗ HEALTH_CHECK_PATH not found${NC}"
  MISSING_ENV=true
fi

if [[ "$MISSING_ENV" == true ]]; then
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 5: Build metadata
echo -e "${YELLOW}[Test 5] Build metadata collection${NC}"
MISSING_META=false

if grep -q "BUILD_DATE" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ BUILD_DATE included${NC}"
else
  echo -e "${RED}✗ BUILD_DATE missing${NC}"
  MISSING_META=true
fi

if grep -q "GIT_SHA" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ GIT_SHA included${NC}"
else
  echo -e "${RED}✗ GIT_SHA missing${NC}"
  MISSING_META=true
fi

if grep -q "DEPLOYMENT_TIME" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ DEPLOYMENT_TIME included${NC}"
else
  echo -e "${RED}✗ DEPLOYMENT_TIME missing${NC}"
  MISSING_META=true
fi

if [[ "$MISSING_META" == true ]]; then
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 6: Gateway health check
echo -e "${YELLOW}[Test 6] Gateway health check implementation${NC}"
if grep -q "testGatewayHealth" src/healthcheck-server.js; then
  echo -e "${GREEN}✓ Gateway health check implemented${NC}"
else
  echo -e "${RED}✗ Gateway health check missing${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 7: Dockerfile configuration
echo -e "${YELLOW}[Test 7] Dockerfile configuration${NC}"
DOCKER_OK=true

if grep -q "HEALTH_CHECK_PORT" Dockerfile; then
  echo -e "${GREEN}✓ HEALTH_CHECK_PORT env var in Dockerfile${NC}"
else
  echo -e "${RED}✗ HEALTH_CHECK_PORT missing from Dockerfile${NC}"
  DOCKER_OK=false
fi

if grep -q "8888" Dockerfile; then
  echo -e "${GREEN}✓ Port 8888 exposed in Dockerfile${NC}"
else
  echo -e "${RED}✗ Port 8888 not exposed in Dockerfile${NC}"
  DOCKER_OK=false
fi

if grep -q "scripts/start.sh" Dockerfile; then
  echo -e "${GREEN}✓ Start script configured in Dockerfile${NC}"
else
  echo -e "${RED}✗ Start script not in Dockerfile CMD${NC}"
  DOCKER_OK=false
fi

if [[ "$DOCKER_OK" == false ]]; then
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 8: Documentation
echo -e "${YELLOW}[Test 8] Documentation exists${NC}"
if [[ -f "docs/healthcheck-endpoint.md" ]]; then
  echo -e "${GREEN}✓ Documentation exists${NC}"
else
  echo -e "${RED}✗ Documentation missing${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

echo ""
if [[ $TEST_RESULTS -eq 0 ]]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ $TEST_RESULTS test(s) failed${NC}"
  exit 1
fi
