#!/bin/bash
# himalaya-init.sh - Initialize Himalaya config with reboot safety
# Usage: HIMALAYA_EMAIL=... HIMALAYA_PASSWORD=... ./himalaya-init.sh

set -e

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🐻 Himalaya Reboot-Safe Config Initialization${NC}"
echo ""

# Check environment variables
if [[ -z "$HIMALAYA_EMAIL" ]]; then
  echo -e "${RED}❌ Error: HIMALAYA_EMAIL not set${NC}"
  exit 1
fi

if [[ -z "$HIMALAYA_PASSWORD" ]]; then
  echo -e "${RED}❌ Error: HIMALAYA_PASSWORD not set${NC}"
  exit 1
fi

CONFIG_DIR="/root/.config/himalaya"
BACKUP_DIR="/data/workspace/.himalaya-backup"
CONFIG_FILE="$CONFIG_DIR/config.toml"
PASSWORD_FILE="$CONFIG_DIR/.password"
BACKUP_CONFIG="$BACKUP_DIR/config.toml"
BACKUP_PASSWORD="$BACKUP_DIR/.password"

echo -e "${YELLOW}Step 1: Creating config directories${NC}"
mkdir -p "$CONFIG_DIR"
mkdir -p "$BACKUP_DIR"
chmod 700 "$CONFIG_DIR"
chmod 700 "$BACKUP_DIR"

echo -e "${YELLOW}Step 2: Generating config from template${NC}"
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

# Substitute email from environment variable
sed -i "s|PLACEHOLDER_EMAIL|$HIMALAYA_EMAIL|g" "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
echo -e "${GREEN}✓ Config file created${NC}"

echo -e "${YELLOW}Step 3: Creating password file${NC}"
echo -n "$HIMALAYA_PASSWORD" > "$PASSWORD_FILE"
chmod 600 "$PASSWORD_FILE"
echo -e "${GREEN}✓ Password file created${NC}"

echo -e "${YELLOW}Step 4: Creating backup copies${NC}"
cp "$CONFIG_FILE" "$BACKUP_CONFIG"
cp "$PASSWORD_FILE" "$BACKUP_PASSWORD"
chmod 600 "$BACKUP_CONFIG" "$BACKUP_PASSWORD"
echo -e "${GREEN}✓ Backups created in $BACKUP_DIR${NC}"

echo -e "${YELLOW}Step 5: Testing Himalaya connection${NC}"
if timeout 10 himalaya envelope list --limit 1 &>/dev/null; then
  echo -e "${GREEN}✓ Himalaya connection verified${NC}"
else
  echo -e "${RED}❌ Failed to connect to Himalaya. Check credentials.${NC}"
  exit 1
fi

echo ""
echo -e "${GREEN}✅ Himalaya config initialized and verified!${NC}"
echo ""
echo "Config location: $CONFIG_FILE"
echo "Password file: $PASSWORD_FILE"
echo "Backup location: $BACKUP_DIR"
echo ""
echo "ℹ️  To restore after reboot: bash /data/workspace/scripts/himalaya-restore.sh"
