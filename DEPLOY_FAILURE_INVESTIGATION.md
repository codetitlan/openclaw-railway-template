# Deploy Failure - Root Cause Found & Fixed

## Failed Run
- URL: https://github.com/bb-claw/openclaw-railway-template/actions/runs/22275704046/job/64437912177
- Error: `error: unexpected argument '--project' found`
- Usage: `railway redeploy --service <SERVICE> --yes`

## Root Cause

**The `railway redeploy` command does NOT accept `--project` or `--environment` flags!**

```
❌ WRONG:
railway redeploy --service ID --project PID --environment EID --yes
error: unexpected argument '--project' found

✅ CORRECT:
railway redeploy --service ID --yes
```

The global flags `--project` and `--environment` work with OTHER Railway CLI commands, but NOT with `redeploy`.

## Solution

The `redeploy` command only accepts:
- `--service <SERVICE>` - Target service (required)
- `--yes` - Skip confirmation (optional)

Project/environment context is determined by:
1. **RAILWAY_TOKEN scope** - Token is already scoped to project + environment
2. **Linked service** - Railway CLI remembers the current service context

## Fix Applied

In `deploy-railway.yml`:
- ✅ Removed `--project` flag (not supported)
- ✅ Removed `--environment` flag (not supported)
- ✅ Use only: `railway redeploy --service SERVICE_ID --yes`
- ✅ Project/environment IDs still logged for debugging (but not used in command)
- ✅ Token scope handles the context automatically

## New Flow

```bash
# Set up - Railway CLI initialization with token
export RAILWAY_TOKEN="..."

# Debug output - show what IDs we have
echo "📍 Project ID: ..."
echo "📍 Environment ID: ..."

# Execute - only what redeploy actually supports
railway redeploy --service "fb931a8f-..." --yes
```

## Status

✅ **FIXED**: Updated deploy-railway.yml in ci-workflows
✅ **Ready**: Feature branch prepared with fix
🔄 **Next**: Create PR in ci-workflows, merge, tag v5.2, update openclaw-railway-template
