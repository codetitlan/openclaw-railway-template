# Migration Guide: Upgrading to Enhanced OpenClaw

This guide helps you upgrade from the base clawdbot-railway-template or older openclaw versions to the enhanced version with debug console, config editor, and other features.

## What's New

- ✅ **Debug Console** - Run commands without SSH
- ✅ **Config Editor** - Edit openclaw.json with backups
- ✅ **Pairing Helper** - Approve devices via UI
- ✅ **Import/Export Backup** - Easy migration
- ✅ **Custom Provider Support** - Ollama, vLLM, etc.
- ✅ **Better Diagnostics** - `/healthz`, `/setup/api/debug`
- ✅ **Auto Migration** - Legacy config files and env vars
- ✅ **Enhanced Security** - 700 permissions, debug-only token logging

## Migration Paths

### Path 1: Fresh Deploy (Recommended)

If you don't have important history:

1. **Export Backup** from old deployment:
   - Visit `/setup/export` and download backup
   - Or use curl: `curl -u user:PASSWORD https://old-app.up.railway.app/setup/export -o backup.tar.gz`

2. **Deploy New Template** to Railway:
   - Use the openclaw Railway template
   - Set `SETUP_PASSWORD`
   - Mount volume at `/data`
   - Set `OPENCLAW_STATE_DIR=/data/.openclaw`
   - Set `OPENCLAW_WORKSPACE_DIR=/data/workspace`

3. **Import Backup**:
   - Visit `/setup`
   - Use "Import backup" feature
   - Upload downloaded .tar.gz
   - Wait for import to complete
   - Gateway will restart automatically

4. **Verify Everything Works**:
   - Check `/healthz`
   - Test channels (Telegram/Discord)
   - Try debug console commands
   - Verify Control UI at `/openclaw`

### Path 2: In-Place Upgrade

If you want to keep your Railway service:

1. **Backup First** (IMPORTANT!):

   ```bash
   # Via curl
   curl -u username:$SETUP_PASSWORD \
     https://your-app.up.railway.app/setup/export \
     -o backup-$(date +%Y%m%d).tar.gz
   ```

2. **Update Repository**:
   - Fork openclaw-railway-template
   - Update your Railway service to point to your fork
   - Or: Update GitHub source in Railway settings to this repo

3. **Update Environment Variables** (if needed):
   - Add `OPENCLAW_STATE_DIR=/data/.openclaw` (if not set)
   - Add `OPENCLAW_WORKSPACE_DIR=/data/workspace` (if not set)
   - Keep `SETUP_PASSWORD`
   - Keep `OPENCLAW_GATEWAY_TOKEN` (if you have it)

4. **Redeploy**:
   - Railway will rebuild from new code
   - Config and data preserved (on /data volume)
   - Auto-migration will run for legacy env vars

5. **Verify Migration**:
   - Check `/healthz`
   - Visit `/setup` to see new features
   - Test debug console
   - Verify channels still work

### Path 3: Manual Update

If you made custom changes to the wrapper:

1. **Review Divergence Analysis**:
   - See `DIVERGENCE_ANALYSIS.md` for all changes
   - Compare your custom code with new features

2. **Follow Daily Plans**:
   - See `plan_day-*.md` files for implementation details
   - Implement features incrementally
   - Test after each day's changes

3. **Merge Carefully**:
   - Keep your customizations
   - Add new features selectively
   - Test thoroughly at each step

## Environment Variable Migration

### Automatic Migration

These are handled automatically by the new code:

```bash
# Old names → New names (auto-migrated on startup)
CLAWDBOT_PUBLIC_PORT    → OPENCLAW_PUBLIC_PORT
CLAWDBOT_STATE_DIR      → OPENCLAW_STATE_DIR
CLAWDBOT_WORKSPACE_DIR  → OPENCLAW_WORKSPACE_DIR
CLAWDBOT_GATEWAY_TOKEN  → OPENCLAW_GATEWAY_TOKEN
CLAWDBOT_CONFIG_PATH    → OPENCLAW_CONFIG_PATH

MOLTBOT_PUBLIC_PORT     → OPENCLAW_PUBLIC_PORT
MOLTBOT_STATE_DIR       → OPENCLAW_STATE_DIR
MOLTBOT_WORKSPACE_DIR   → OPENCLAW_WORKSPACE_DIR
MOLTBOT_GATEWAY_TOKEN   → OPENCLAW_GATEWAY_TOKEN
MOLTBOT_CONFIG_PATH     → OPENCLAW_CONFIG_PATH
```

**What happens:**

- You'll see warnings in logs: `[env-migration] Detected legacy CLAWDBOT_*, auto-migrating to OPENCLAW_*`
- The new env vars are used immediately
- Old env vars still work but are deprecated
- Update Railway Variables to new names when convenient

### Config File Migration

These are also automatic:

```bash
# Old names → New name (auto-renamed on startup)
/data/.openclaw/clawdbot.json → openclaw.json
/data/.openclaw/openclaw.json  → openclaw.json
```

**What happens:**

- You'll see warnings in logs: `[config-migration] Renamed legacy config file`
- Old config file is renamed (not copied)
- All settings preserved
- No manual intervention needed

## Post-Migration Checklist

After migrating, verify:

- [ ] `/healthz` returns healthy status
- [ ] `/setup` loads without errors
- [ ] Debug console commands work
- [ ] Config editor loads your config
- [ ] Channels (Telegram/Discord) work
- [ ] Control UI accessible at `/openclaw`
- [ ] WebSocket connection works (no auth errors)
- [ ] Backup export works
- [ ] Pairing helper lists devices (if any)
- [ ] Custom providers appear (if configured)

## Common Issues

### Issue: "Token mismatch" after upgrade

**Symptoms:**

- Gateway won't start
- Control UI shows auth errors
- Logs show "token_mismatch" errors

**Solution:**

1. Check if you have `OPENCLAW_GATEWAY_TOKEN` set in Railway Variables
2. If yes: Use Config Editor to verify `gateway.auth.token` matches the env var
3. If no: Set it now: `openssl rand -hex 32` → paste into Railway Variables
4. Or reset and reconfigure via `/setup`

### Issue: Legacy env vars not migrating

**Symptoms:**

- Warnings in logs but features not working
- STATE_DIR or WORKSPACE_DIR pointing to wrong location

**Solution:**

1. Check Railway logs for migration warnings
2. Manually set `OPENCLAW_*` variables in Railway Variables
3. Remove old `CLAWDBOT_*` or `MOLTBOT_*` variables
4. Redeploy

### Issue: Config file not found

**Symptoms:**

- `/setup` shows unconfigured state
- Logs show "Config file not found"

**Solution:**

1. Check `/data` volume is mounted correctly
2. Verify `OPENCLAW_STATE_DIR=/data/.openclaw`
3. Check if config file exists: Use Debug Console → `ls /data/.openclaw/`
4. If missing: Use Config Editor to create new config, or import backup

### Issue: Gateway won't start after migration

**Symptoms:**

- `/healthz` shows "Gateway not ready"
- Logs show gateway errors

**Solution:**

1. Visit `/healthz` to see error details
2. Run `openclaw doctor` in Debug Console
3. Check `/setup/api/debug` for full diagnostics
4. Verify `/data/.openclaw/credentials` directory exists with 700 permissions
5. Try `openclaw doctor --fix` in Debug Console

### Issue: Import fails with "/data" error

**Symptoms:**

- Import shows error: "Import requires both STATE_DIR and WORKSPACE_DIR under /data"

**Solution:**
Set these env vars in Railway Variables:

```bash
OPENCLAW_STATE_DIR=/data/.openclaw
OPENCLAW_WORKSPACE_DIR=/data/workspace
```

Then redeploy and try import again.

### Issue: Import fails with "File too large"

**Symptoms:**

- Import shows error: "File too large: X.XMB (max 250MB)"

**Solution:**

1. Your backup exceeds the 250MB safety limit
2. Clean up workspace files before exporting:
   - Remove old conversation histories
   - Remove cached files
   - Remove temp files
3. Or: Manually extract and copy files via Railway CLI

### Issue: Channels stopped working after migration

**Symptoms:**

- Telegram/Discord not responding
- Logs show "plugin not enabled" errors

**Solution:**

1. Check if plugins are enabled: Debug Console → `openclaw.plugins.list`
2. Enable plugins: Debug Console → `openclaw.plugins.enable telegram` (or discord)
3. Restart gateway: Debug Console → `gateway.restart`

## Rolling Back

If you need to rollback:

### Option 1: Railway Rollback Feature

1. Go to Railway dashboard
2. Find the deployment before upgrade
3. Click "Rollback" button

### Option 2: Manual Restore

1. **Export backup** from new version first (just in case)
2. **Redeploy** old version:
   - Update GitHub source to old repo/branch
   - Or revert commits in your fork
3. **Import old backup** (if you saved one)

## Feature Comparison

| Feature | Old Version | Enhanced Version |
|---------|-------------|------------------|
| Debug Console | ✗ | ✓ (13 commands) |
| Config Editor | ✗ | ✓ (with backups) |
| Pairing Helper | ✗ | ✓ |
| Import Backup | ✗ | ✓ (250MB max) |
| Custom Providers | ✗ | ✓ |
| Public /healthz | ✗ | ✓ |
| Auto doctor | ✗ | ✓ |
| Plugin Management | ✗ | ✓ |
| Env Migration | ✗ | ✓ (CLAWDBOT/MOLTBOT) |
| Config Migration | ✗ | ✓ (openclaw/clawdbot.json) |
| Enhanced Errors | Basic | Detailed with fixes |
| Security | 755 perms | 700 perms, debug-only logs |

## Need Help?

- **Check diagnostics**: `/healthz` and `/setup/api/debug`
- **Report issues**: <https://github.com/codetitlan/openclaw-railway-template/issues>
- **Ask in Discord**: <https://discord.com/invite/clawd>
- **Review docs**: README.md, CONTRIBUTING.md, CLAUDE.md

## Success Stories

If you successfully migrated, we'd love to hear about it! Share your experience:

- Open a GitHub Discussion
- Post in Discord
- Help others with migration issues

## What's Next?

After successful migration:

1. Explore the Debug Console features
2. Try the Config Editor
3. Set up custom providers (if using Ollama/vLLM)
4. Configure backup schedules (manual for now)
5. Join the community to stay updated on new features

Thank you for upgrading! 🎉
