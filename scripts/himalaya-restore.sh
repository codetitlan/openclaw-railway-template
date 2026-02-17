#!/bin/bash
# himalaya-restore.sh - Restore Himalaya config from backup (reboot-safe)
# Safety-first: Only restore if necessary, prefer backups, use env vars as fallback

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

CONFIG_DIR="/root/.config/himalaya"
BACKUP_DIR="/data/workspace/.himalaya-backup"
CONFIG_FILE="$CONFIG_DIR/config.toml"
PASSWORD_FILE="$CONFIG_DIR/.password"
BACKUP_CONFIG="$BACKUP_DIR/config.toml"
BACKUP_PASSWORD="$BACKUP_DIR/.password"

# Mode: can be "force", "check", or default (restore only if needed)
MODE="${1:-auto}"

# Helper: Test current connection
test_connection() {
  timeout 10 himalaya envelope list --limit 1 &>/dev/null
  return $?
}

# Helper: Check if config is healthy
is_config_healthy() {
  if [[ ! -f "$CONFIG_FILE" ]] || [[ ! -f "$PASSWORD_FILE" ]]; then
    return 1  # Files missing = not healthy
  fi
  
  if ! test_connection; then
    return 1  # Can't connect = not healthy
  fi
  
  return 0  # All good
}

echo -e "${BLUE}🐻 Himalaya Config Restoration (Safety-First)${NC}"
echo ""

# Check if config is already healthy
if [[ "$MODE" != "force" ]]; then
  echo -e "${YELLOW}Checking current config health...${NC}"
  if is_config_healthy; then
    echo -e "${GREEN}✓ Config is healthy, no restoration needed${NC}"
    exit 0
  fi
  echo -e "${YELLOW}⚠️  Config missing or broken, proceeding with restoration${NC}"
  echo ""
fi

# STAGE 1: Try to restore from backup files
echo -e "${YELLOW}Stage 1: Restoring from backup files${NC}"

if [[ -f "$BACKUP_CONFIG" ]] && [[ -f "$BACKUP_PASSWORD" ]]; then
  echo -e "${YELLOW}  Creating config directory${NC}"
  mkdir -p "$CONFIG_DIR"
  chmod 700 "$CONFIG_DIR"
  
  echo -e "${YELLOW}  Restoring config file from backup${NC}"
  cp "$BACKUP_CONFIG" "$CONFIG_FILE"
  chmod 600 "$CONFIG_FILE"
  echo -e "${GREEN}  ✓ Config restored from backup${NC}"
  
  echo -e "${YELLOW}  Restoring password file from backup${NC}"
  cp "$BACKUP_PASSWORD" "$PASSWORD_FILE"
  chmod 600 "$PASSWORD_FILE"
  echo -e "${GREEN}  ✓ Password restored from backup${NC}"
  
  # Test connection
  echo -e "${YELLOW}  Testing connection...${NC}"
  if test_connection; then
    echo -e "${GREEN}  ✓ Connection verified${NC}"
    echo ""
    echo -e "${GREEN}✅ Restoration successful (from backup)${NC}"
    exit 0
  else
    echo -e "${RED}  ✗ Connection failed with backup credentials${NC}"
    echo -e "${YELLOW}  Backup may be stale, trying environment variables...${NC}"
  fi
else
  echo -e "${YELLOW}  Backup files not found, trying environment variables...${NC}"
fi

# STAGE 2: Try to restore from environment variables
echo ""
echo -e "${YELLOW}Stage 2: Restoring from environment variables${NC}"

if [[ -z "$HIMALAYA_EMAIL" ]] || [[ -z "$HIMALAYA_PASSWORD" ]]; then
  echo -e "${RED}❌ Error: Neither backup files nor environment variables available${NC}"
  echo ""
  echo "To restore:"
  echo "  Option A (backup): Check if $BACKUP_DIR/ exists"
  echo "  Option B (env):    Set HIMALAYA_EMAIL and HIMALAYA_PASSWORD"
  exit 1
fi

echo -e "${YELLOW}  Environment variables found${NC}"
echo -e "${YELLOW}  Creating config directory${NC}"
mkdir -p "$CONFIG_DIR"
chmod 700 "$CONFIG_DIR"

# Generate config from template using env vars
echo -e "${YELLOW}  Generating config from template${NC}"
cat > "$CONFIG_FILE" << 'CONFIGEOF'
[accounts.default]
email = "PLACEHOLDER_EMAIL"
display-name = "OpenClaw"
default = true

[accounts.default.backend]
type = "imap"
host = "imap.mailbox.org"
port = 993
login = "PLACEHOLDER_EMAIL"

[accounts.default.backend.encryption]
type = "tls"

[accounts.default.backend.auth]
type = "password"
command = "cat /root/.config/himalaya/.password"

[accounts.default.message.send.backend]
type = "smtp"
host = "smtp.mailbox.org"
port = 587
login = "PLACEHOLDER_EMAIL"

[accounts.default.message.send.backend.encryption]
type = "start-tls"

[accounts.default.message.send.backend.auth]
type = "password"
command = "cat /root/.config/himalaya/.password"
CONFIGEOF

sed -i "s|PLACEHOLDER_EMAIL|$HIMALAYA_EMAIL|g" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo -e "${GREEN}  ✓ Config generated from env vars${NC}"

echo -e "${YELLOW}  Creating password file${NC}"
echo -n "$HIMALAYA_PASSWORD" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"
echo -e "${GREEN}  ✓ Password created from env vars${NC}"

# Backup the restored config for future use
echo -e "${YELLOW}  Backing up for future restores${NC}"
mkdir -p "$BACKUP_DIR"
cp "$CONFIG_FILE" "$BACKUP_CONFIG"
cp "$PASSWORD_FILE" "$BACKUP_PASSWORD"
chmod 600 "$BACKUP_CONFIG" "$BACKUP_PASSWORD"
echo -e "${GREEN}  ✓ Backup created${NC}"

# Test connection
echo -e "${YELLOW}  Testing connection...${NC}"
if test_connection; then
  echo -e "${GREEN}  ✓ Connection verified${NC}"
  echo ""
  echo -e "${GREEN}✅ Restoration successful (from env vars, backup created)${NC}"
  exit 0
else
  echo -e "${RED}❌ Failed to connect with restored config${NC}"
  echo "Check HIMALAYA_EMAIL and HIMALAYA_PASSWORD are correct."
  exit 1
fi
