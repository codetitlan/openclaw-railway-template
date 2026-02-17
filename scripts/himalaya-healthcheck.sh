#!/bin/bash
# himalaya-healthcheck.sh - Check Himalaya config health and auto-restore if needed

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONFIG_DIR="/root/.config/himalaya"
CONFIG_FILE="$CONFIG_DIR/config.toml"
PASSWORD_FILE="$CONFIG_DIR/.password"
BACKUP_DIR="/data/workspace/.himalaya-backup"

echo -e "${BLUE}🐻 Himalaya Health Check${NC}"
echo ""

# Check if config exists
if [[ ! -f "$CONFIG_FILE" ]] || [[ ! -f "$PASSWORD_FILE" ]]; then
  echo -e "${YELLOW}⚠️  Config missing, attempting restoration...${NC}"
  if [[ -f "$BACKUP_DIR/config.toml" ]] && [[ -f "$BACKUP_DIR/.password" ]]; then
    bash /data/workspace/scripts/himalaya-restore.sh
    echo ""
    echo -e "${GREEN}✅ Health check: RESTORED${NC}"
    exit 0
  else
    echo -e "${RED}❌ Health check: FAILED (No backups available)${NC}"
    exit 1
  fi
fi

# Test connection
echo -e "${YELLOW}Testing Himalaya connection...${NC}"
if timeout 10 himalaya envelope list --limit 1 &>/dev/null; then
  echo -e "${GREEN}✓ Connection test passed${NC}"
  echo ""
  echo -e "${GREEN}✅ Health check: HEALTHY${NC}"
  exit 0
else
  echo -e "${RED}❌ Connection test failed${NC}"
  echo "Attempting restoration..."
  bash /data/workspace/scripts/himalaya-restore.sh
  echo ""
  echo -e "${YELLOW}⚠️  Health check: RESTORED (was unhealthy)${NC}"
  exit 0
fi
