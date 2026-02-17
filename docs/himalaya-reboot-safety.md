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
✅ **Safety-First** - Only restores when necessary, prefers backups, uses env vars as fallback  
✅ **Tested** - Includes verification script and smoke tests

## Safety-First Philosophy

This implementation follows a conservative, non-destructive approach:

1. **Never overwrite working config** — If connection is healthy, don't touch anything
2. **Prefer backups** — Always restore from backup files first (most reliable)
3. **Use env vars as fallback** — Only generate new config from environment variables if backup unavailable
4. **Test before committing** — All operations verify connection before reporting success
5. **Clear error messages** — If restoration fails, provides actionable next steps

This means:
- Safe to run scripts repeatedly (idempotent)
- Won't accidentally break a working setup
- Automatic recovery without manual intervention
- Transparent about what succeeded or failed  

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
  ├─ Generates config.toml from template with email from HIMALAYA_EMAIL
  ├─ Stores password in .password file (read-only, from HIMALAYA_PASSWORD)
  ├─ Tests connection to verify credentials work
  └─ Backs up config + password to /data/workspace/.himalaya-backup/ (persistent)
```

### After Reboot (Safety-First Flow)

```
Container restart
  ↓
/root/.config/himalaya/ is gone (ephemeral filesystem)
  ↓
himalaya-healthcheck.sh runs (via cron or manual)
  ↓
Check current config health
  ├─ If healthy (files exist + connection works) → STOP, no action needed ✓
  └─ If missing or broken → Proceed to restoration
  ↓
himalaya-restore.sh (auto mode)
  ├─ Stage 1: Try restore from backup
  │  ├─ If backup exists and connection works → SUCCESS ✓
  │  └─ If backup exists but connection fails → Try Stage 2
  ├─ Stage 2: Try restore from env vars
  │  ├─ If HIMALAYA_EMAIL & HIMALAYA_PASSWORD set → Generate config
  │  ├─ Test connection
  │  ├─ If works → Create backup for next time ✓
  │  └─ If fails → ERROR (need manual intervention)
  └─ If neither available → ERROR with recovery instructions
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

**Safety-First Approach:**
- ✅ Only restores if necessary (won't clobber working config)
- ✅ Prefers backup files (most reliable)
- ✅ Falls back to environment variables if backup missing
- ✅ Creates new backup from env vars if needed

**Requirements:**
Either:
- Backup files in `/data/workspace/.himalaya-backup/`, OR
- Environment variables: `HIMALAYA_EMAIL`, `HIMALAYA_PASSWORD`

**What it does:**
1. **Safety Check**: Tests if config is already healthy (skips if working)
2. **Stage 1 - Backup**: Tries to restore from `/data/workspace/.himalaya-backup/`
   - If successful and connection works: Done ✓
   - If connection fails: Tries env vars
3. **Stage 2 - Env Vars**: Falls back to environment variables if backup unavailable
   - Generates config from template
   - Creates new backup for future use
   - Tests connection
4. **Fallback**: If neither available, returns error with recovery instructions

**Modes:**

```bash
# Auto (default): Only restore if config is missing or broken
bash /data/workspace/scripts/himalaya-restore.sh

# Force: Always restore (useful for testing or credential rotation)
bash /data/workspace/scripts/himalaya-restore.sh force

# Check: Only test, don't restore
bash /data/workspace/scripts/himalaya-restore.sh check
```

**Usage:**
```bash
# Normal use (auto-detects if needed)
bash /data/workspace/scripts/himalaya-restore.sh

# Force restore (credential update)
bash /data/workspace/scripts/himalaya-restore.sh force

# Check without modifying
bash /data/workspace/scripts/himalaya-restore.sh check
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

When a connection test fails:

```bash
# 1. Verify credentials are set
echo "Email: $HIMALAYA_EMAIL"
echo "Password: ${HIMALAYA_PASSWORD:+***}"  # Shows *** if set

# 2. Test network connectivity to mailbox.org
timeout 5 nc -zv imap.mailbox.org 993  # Should succeed
timeout 5 nc -zv smtp.mailbox.org 587  # Should succeed

# 3. Check config file for syntax errors
cat /root/.config/himalaya/config.toml

# 4. Test with verbose output
himalaya envelope list -v
```

### "Backup files not found in restoration"

**This is a safety feature**, not an error. The script will:
1. Check if environment variables are set (`HIMALAYA_EMAIL`, `HIMALAYA_PASSWORD`)
2. If set: Generate config from template and create new backup
3. If not set: Fail with clear instructions

**To recover:**

Option A - Set environment variables and restore:
```bash
export HIMALAYA_EMAIL="your-email@mailbox.org"
export HIMALAYA_PASSWORD="your-password"
bash /data/workspace/scripts/himalaya-restore.sh
```

Option B - Re-initialize (creates fresh backup):
```bash
HIMALAYA_EMAIL="..." HIMALAYA_PASSWORD="..." \
  bash /data/workspace/scripts/himalaya-init.sh
```

### "Config exists but connection is broken"

The restore script will automatically detect this and attempt recovery:

```bash
# Automatic (preferred)
bash /data/workspace/scripts/himalaya-healthcheck.sh

# Or manual restore (safe, won't clobber working config)
bash /data/workspace/scripts/himalaya-restore.sh

# Force restore if normal restore fails
bash /data/workspace/scripts/himalaya-restore.sh force
```

### "After reboot, config is missing"

This is expected and handled automatically:

```bash
# Via cron (automatic, runs hourly)
# No action needed — script runs via cron job

# Manual restoration
bash /data/workspace/scripts/himalaya-restore.sh
```

### "I need to update my password"

Rotate credentials without reinitializing:

```bash
export HIMALAYA_PASSWORD="new-password"
bash /data/workspace/scripts/himalaya-restore.sh force
```

This will:
1. Generate config with existing email (from existing config or env var)
2. Use new password
3. Test connection
4. Update backup with new password

### "Restoration fails even with env vars set"

If both backup restore and env var restore fail:

```bash
# 1. Verify credentials are actually correct
himalaya envelope list -v

# 2. Check if mailbox.org IMAP/SMTP is accessible
nslookup imap.mailbox.org
nslookup smtp.mailbox.org

# 3. Verify password is not expired (mailbox.org web login)
# - Log in to https://mailbox.org
# - Check account status

# 4. If credentials were recently changed:
# - Wait a few minutes for propagation
# - Or use an app-specific password instead

# 5. Manual debug of config:
cat /root/.config/himalaya/config.toml
cat /root/.config/himalaya/.password
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
