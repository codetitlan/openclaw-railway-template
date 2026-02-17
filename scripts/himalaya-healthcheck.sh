#!/bin/bash
# himalaya-healthcheck.sh - Check Himalaya config health and auto-restore if needed
# Safety-first: Only restores if necessary, prefers backups, uses env vars as fallback

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONFIG_DIR="/root/.config/himalaya"
CONFIG_FILE="$CONFIG_DIR/config.toml"
PASSWORD_FILE="$CONFIG_DIR/.password"

echo -e "${BLUE}🐻 Himalaya Health Check${NC}"
echo ""

# Test connection
echo -e "${YELLOW}Testing Himalaya connection...${NC}"
if [[ -f "$CONFIG_FILE" ]] && [[ -f "$PASSWORD_FILE" ]]; then
  if timeout 10 himalaya envelope list --limit 1 &>/dev/null; then
    echo -e "${GREEN}✓ Connection verified${NC}"
    echo ""
    echo -e "${GREEN}✅ Health check: HEALTHY${NC}"
    exit 0
  else
    echo -e "${YELLOW}⚠️  Connection test failed, config may be stale${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  Config files missing${NC}"
fi

# Config is missing or broken, attempt restoration
echo -e "${YELLOW}Attempting restoration...${NC}"
echo ""
bash /data/workspace/scripts/himalaya-restore.sh

# Check result
if [[ -f "$CONFIG_FILE" ]] && [[ -f "$PASSWORD_FILE" ]] && \
   timeout 10 himalaya envelope list --limit 1 &>/dev/null; then
  echo ""
  echo -e "${GREEN}✅ Health check: RESTORED & VERIFIED${NC}"
  exit 0
else
  echo ""
  echo -e "${RED}❌ Health check: RESTORATION FAILED${NC}"
  echo "Check logs above for details. Manual intervention may be needed."
  exit 1
fi
