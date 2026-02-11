#!/bin/bash
# Gracefully shutdown the OpenClaw container
# Optionally performs cleanup tasks before exit

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse arguments
FORCE=false
CLEANUP=true
REASON="manual shutdown"

while [[ $# -gt 0 ]]; do
  case $1 in
    --force)
      FORCE=true
      shift
      ;;
    --no-cleanup)
      CLEANUP=false
      shift
      ;;
    --reason)
      REASON="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: $0 [--force] [--no-cleanup] [--reason 'message']"
      exit 1
      ;;
  esac
done

TIMEOUT=20
START_TIME=$(date +%s)

echo ""
echo -e "${BLUE}========== OPENCLAW SHUTDOWN ==========${NC}"
echo -e "Reason: ${REASON}"
echo -e "Force after ${TIMEOUT}s: ${FORCE}"
echo -e "Cleanup: ${CLEANUP}"
echo ""

# Cleanup tasks
if [ "$CLEANUP" = true ]; then
  echo -e "${YELLOW}Running cleanup tasks...${NC}"
  
  # Flush state to disk
  echo -e "  • Syncing filesystem..."
  sync
  
  # Kill any stray processes
  echo -e "  • Cleaning up processes..."
  pkill -f openclaw-gateway || true
  pkill -f tailscaled || true
  
  echo -e "${GREEN}Cleanup complete${NC}"
  echo ""
fi

# Send SIGTERM to wrapper
echo -e "${YELLOW}Sending SIGTERM to wrapper process...${NC}"
PID=1  # Wrapper is PID 1 in container
if kill -0 $PID 2>/dev/null; then
  kill -TERM $PID 2>/dev/null || true
  
  # Wait for graceful shutdown
  SHUTDOWN_TIME=0
  while kill -0 $PID 2>/dev/null && [ $SHUTDOWN_TIME -lt $TIMEOUT ]; do
    echo -e "  • Waiting for graceful shutdown (${SHUTDOWN_TIME}s/${TIMEOUT}s)..."
    sleep 1
    SHUTDOWN_TIME=$((SHUTDOWN_TIME + 1))
  done
  
  # Force kill if still running
  if kill -0 $PID 2>/dev/null; then
    echo -e "${YELLOW}Graceful shutdown timeout, forcing exit...${NC}"
    if [ "$FORCE" = true ]; then
      kill -9 $PID 2>/dev/null || true
      sleep 1
    fi
  fi
fi

# Check final status
ELAPSED=$(($(date +%s) - START_TIME))
if kill -0 $PID 2>/dev/null; then
  echo -e "${RED}✗ Shutdown failed (process still running)${NC}"
  exit 1
else
  echo -e "${GREEN}✓ OpenClaw shutdown complete (${ELAPSED}s)${NC}"
  echo ""
  exit 0
fi
