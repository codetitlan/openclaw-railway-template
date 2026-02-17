# Himalaya Reboot-Safe Configuration

This document explains how to set up Himalaya email CLI with automatic recovery after system reboots.

## Overview

The solution consists of:

1. **himalaya-init.sh** - Initial setup with environment variable-based credentials
2. **himalaya-restore.sh** - Automatic restoration from backup
3. **himalaya-healthcheck.sh** - Health monitoring and auto-restore
4. **test-himalaya-config.sh** - Verification tests

## Key Features

✅ **Reboot Safe** - Config automatically restores after container restart  
✅ **No Hardcoded Secrets** - Uses environment variables for credentials  
✅ **Backup Strategy** - Stores backups in persistent `/data/workspace` volume  
✅ **Health Monitoring** - Auto-detects and fixes broken configs  
✅ **Tested** - Includes verification script and smoke tests  

## Quick Start

### Step 1: Set Environment Variables

```bash
export HIMALAYA_EMAIL="your-email@mailbox.org"
export HIMALAYA_PASSWORD="your-password"
```

### Step 2: Initialize Config

```bash
bash /data/workspace/scripts/himalaya-init.sh
```

Expected output:
```
🐻 Himalaya Reboot-Safe Config Initialization

✓ Config file created
✓ Password file created
✓ Backups created in /data/workspace/.himalaya-backup
✓ Himalaya connection verified
✅ Himalaya config initialized and verified!
```

### Step 3: Test Email Access

```bash
himalaya envelope list --limit 5
```

## How It Works

### Initialization Flow

```
himalaya-init.sh
  ├─ Creates /root/.config/himalaya/ (ephemeral, lost on reboot)
  ├─ Generates config.toml from template with email from env var
  ├─ Stores password in .password file (read-only)
  ├─ Tests connection to verify it works
  └─ Backs up config + password to /data/workspace/.himalaya-backup/ (persistent)
```

### After Reboot

```
Container restart
  ↓
/root/.config/himalaya/ is gone (ephemeral container filesystem)
  ↓
himalaya-healthcheck.sh runs (via cron or manual)
  ↓
Detects missing config
  ↓
himalaya-restore.sh restores from backup
  ↓
Connection verified
  ↓
✅ Ready to use
```

## File Locations

| File | Location | Persistence | Purpose |
|------|----------|-------------|---------|
| config.toml | `/root/.config/himalaya/` | Ephemeral | Runtime config (lost on reboot) |
| .password | `/root/.config/himalaya/` | Ephemeral | Password file (lost on reboot) |
| config.toml backup | `/data/workspace/.himalaya-backup/` | Persistent | Config restoration source |
| .password backup | `/data/workspace/.himalaya-backup/` | Persistent | Password restoration source |

## Scripts

### himalaya-init.sh

Initialize Himalaya config for the first time.

**Requirements:**
- `HIMALAYA_EMAIL` environment variable set
- `HIMALAYA_PASSWORD` environment variable set

**What it does:**
1. Creates config directories with restricted permissions (700)
2. Generates config.toml from template, substituting email from env var
3. Creates .password file with secure permissions (600)
4. Tests connection to mailbox.org
5. Backs up config and password to persistent storage
6. Reports success or failure

**Usage:**
```bash
HIMALAYA_EMAIL="user@mailbox.org" HIMALAYA_PASSWORD="pass" \
  bash /data/workspace/scripts/himalaya-init.sh
```

### himalaya-restore.sh

Restore config from backup (typically called after reboot).

**Requirements:**
- Backup files must exist in `/data/workspace/.himalaya-backup/`
- Requires no environment variables (uses existing backups)

**What it does:**
1. Verifies backups exist
2. Creates /root/.config/himalaya/ directory
3. Copies config and password from backup
4. Sets correct permissions (600)
5. Verifies connection works
6. Reports status

**Usage:**
```bash
bash /data/workspace/scripts/himalaya-restore.sh
```

### himalaya-healthcheck.sh

Check if config is healthy, restore if broken.

**Typical usage:**
- Run periodically via cron
- Run after system startup
- Called manually when troubleshooting

**What it does:**
1. Checks if config files exist
2. Tests connection to mailbox.org
3. If missing or broken: restores from backup
4. Reports health status

**Usage:**
```bash
bash /data/workspace/scripts/himalaya-healthcheck.sh
```

### test-himalaya-config.sh

Verify the reboot-safety setup is correct.

**What it checks:**
- All required scripts exist
- Scripts are executable
- Documentation exists
- Scripts use environment variables (no hardcoded secrets)
- Backup strategy is implemented
- Shell syntax is valid

**Usage:**
```bash
bash /data/workspace/scripts/test-himalaya-config.sh
```

## Environment Variables

### Required for Initialization

| Variable | Example | Purpose |
|----------|---------|---------|
| `HIMALAYA_EMAIL` | `user@mailbox.org` | Email address for IMAP/SMTP login |
| `HIMALAYA_PASSWORD` | `MySecurePass123` | Email password (or app-specific password) |

### Optional

None currently.

## Security Considerations

### Credential Storage

- ✅ **No hardcoded secrets in scripts** - All sensitive data from environment variables
- ✅ **File permissions enforced** - Config and password files are 600 (owner only)
- ✅ **Backup protection** - Backup files in /data/workspace also have 600 permissions
- ⚠️ **Environment variables** - Password passed via env var (visible in `env` and process list briefly)

### Best Practices

1. **Don't commit credentials** - Never add actual passwords to git
2. **Use environment variables** - Set via Railway, Docker secrets, or deployment config
3. **Rotate passwords periodically** - Re-run `himalaya-init.sh` with new password
4. **Monitor access** - Audit logs who runs init/restore scripts
5. **Back up backups** - Periodically download `/data/workspace/.himalaya-backup/` if needed

## Troubleshooting

### "Failed to connect to Himalaya"

```bash
# Verify credentials
echo $HIMALAYA_EMAIL
echo $HIMALAYA_PASSWORD

# Test mailbox.org connectivity
timeout 5 nc -zv imap.mailbox.org 993
timeout 5 nc -zv smtp.mailbox.org 587

# Check config syntax
cat /root/.config/himalaya/config.toml
```

### "Backup files not found"

Run initialization first:
```bash
HIMALAYA_EMAIL="..." HIMALAYA_PASSWORD="..." \
  bash /data/workspace/scripts/himalaya-init.sh
```

### "Config exists but not working"

Restore from backup:
```bash
bash /data/workspace/scripts/himalaya-restore.sh
```

### After reboot, config is missing

Run health check to restore:
```bash
bash /data/workspace/scripts/himalaya-healthcheck.sh
```

Or restore manually:
```bash
bash /data/workspace/scripts/himalaya-restore.sh
```

## Testing

Run the test suite to verify setup:

```bash
bash /data/workspace/scripts/test-himalaya-config.sh
```

All tests should pass:
```
✅ All tests passed!
```

## Integration with Cron

To automatically restore config after reboot, add a cron job:

```bash
curl -X POST http://localhost:3000/api/cron/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Himalaya Auto-Restore",
    "schedule": {"kind": "every", "everyMs": 3600000},
    "payload": {
      "kind": "systemEvent",
      "text": "Running Himalaya health check..."
    },
    "sessionTarget": "main",
    "enabled": true
  }'
```

This runs the health check every hour automatically.

## Related Documentation

- [Himalaya Skill](/openclaw/skills/himalaya/SKILL.md) - CLI usage guide
- [OpenClaw Railway Template](https://github.com/bb-claw/openclaw-railway-template) - Deployment info
