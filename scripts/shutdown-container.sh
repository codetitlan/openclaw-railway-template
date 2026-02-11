#!/bin/bash
# Optional container shutdown script
# Gracefully shuts down railclaw container and optionally Railway service

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}========== CONTAINER SHUTDOWN ==========${NC}"
echo ""

# Check if running on Railway
if [ -z "$RAILWAY_SERVICE_ID" ]; then
  echo -e "${YELLOW}Not running on Railway (RAILWAY_SERVICE_ID not set)${NC}"
  ON_RAILWAY=0
else
  ON_RAILWAY=1
  echo -e "${GREEN}Running on Railway (Service: $RAILWAY_SERVICE_ID)${NC}"
fi
echo ""

# Graceful shutdown
echo -e "${YELLOW}Sending SIGTERM to container...${NC}"
kill -TERM 1 2>/dev/null || true
echo -e "${GREEN}Signal sent (wrapper has 20s to shutdown)${NC}"
echo ""

# Wait for graceful shutdown
echo -e "${YELLOW}Waiting 25s for graceful shutdown...${NC}"
sleep 25

# Check if process still exists
if kill -0 1 2>/dev/null; then
  echo -e "${RED}Process still running, forcing exit...${NC}"
  kill -9 1 2>/dev/null || true
else
  echo -e "${GREEN}Container shut down gracefully${NC}"
fi
echo ""

# Optional: Trigger Railway service restart
if [ "$ON_RAILWAY" -eq 1 ] && [ ! -z "$RAILWAY_API_TOKEN" ]; then
  echo -e "${YELLOW}Restarting Railway service...${NC}"
  
  REDEPLOY_RESULT=$(curl -s -X POST "https://api.railway.app/graphql" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${RAILWAY_API_TOKEN}" \
    -d "{
      \"query\": \"mutation { serviceInstanceRedeploy(input: { environmentId: \\\"${RAILWAY_ENVIRONMENT_ID}\\\", serviceId: \\\"${RAILWAY_SERVICE_ID}\\\" }) { id } }\"
    }")
  
  if echo "$REDEPLOY_RESULT" | jq -e '.data.serviceInstanceRedeploy.id' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Redeploy triggered${NC}"
  else
    echo -e "${RED}✗ Redeploy failed${NC}"
    echo "  Response: $(echo "$REDEPLOY_RESULT" | jq -r '.errors[0].message // "unknown error"')"
  fi
fi

echo ""
echo -e "${GREEN}Shutdown complete${NC}"
