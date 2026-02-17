#!/bin/bash
# himalaya-restore.sh - Restore Himalaya config from backup (reboot-safe)

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐻 Himalaya Config Restoration${NC}"
echo ""

CONFIG_DIR="/root/.config/himalaya"
BACKUP_DIR="/data/workspace/.himalaya-backup"
CONFIG_FILE="$CONFIG_DIR/config.toml"
PASSWORD_FILE="$CONFIG_DIR/.password"
BACKUP_CONFIG="$BACKUP_DIR/config.toml"
BACKUP_PASSWORD="$BACKUP_DIR/.password"

# Check if backups exist
if [[ ! -f "$BACKUP_CONFIG" ]] || [[ ! -f "$BACKUP_PASSWORD" ]]; then
  echo -e "${RED}❌ Error: Backup files not found in $BACKUP_DIR${NC}"
  echo "Run himalaya-init.sh first to create backups."
  exit 1
fi

echo -e "${YELLOW}Step 1: Restoring config directory${NC}"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

echo -e "${YELLOW}Step 2: Restoring config file${NC}"
cp "$BACKUP_CONFIG" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo -e "${GREEN}✓ Config file restored${NC}"

echo -e "${YELLOW}Step 3: Restoring password file${NC}"
cp "$BACKUP_PASSWORD" "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"
echo -e "${GREEN}✓ Password file restored${NC}"

echo -e "${YELLOW}Step 4: Verifying Himalaya connection${NC}"
if timeout 10 himalaya envelope list --limit 1 &>/dev/null; then
  echo -e "${GREEN}✓ Himalaya connection verified${NC}"
else
  echo -e "${RED}❌ Failed to connect. Restoration may have issues.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ Himalaya config restored and verified!${NC}"
