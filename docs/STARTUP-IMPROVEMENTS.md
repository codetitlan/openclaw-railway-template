# Startup Experience Improvements

## Problem

During cold starts (~58s on Railway), the service showed:
- Repeated `ECONNREFUSED 127.0.0.1:18789` proxy errors flooding logs
- Users hitting `/` got 502 errors instead of friendly "starting up" messages
- No visibility into startup progress or estimated completion time

## Solution

Added comprehensive startup state tracking and user-friendly messaging:

### 1. Startup State Tracking

New `StartupState` enum with 4 states:
- `UNCONFIGURED` - No openclaw.json exists yet
- `STARTING` - Gateway is booting up
- `READY` - Gateway is ready and healthy
- `ERROR` - Gateway failed to start or crashed

States are tracked in `currentStartupState` and logged via `setStartupState()`.

### 2. Public Status Endpoints

**`GET /startup-status`** (no auth required):
```json
{
  "state": "STARTING",
  "reason": "Initializing gateway...",
  "elapsedMs": 42350,
  "configured": true,
  "gatewayProcessRunning": true
}
```

Allows external monitoring tools to track cold start progress.

### 3. Friendly Startup Page

When `state === STARTING`, all non-`/setup` routes show an HTML page with:
- Animated spinner
- Current startup reason (e.g., "Gateway is booting")
- Elapsed time counter
- Auto-refresh every 3 seconds
- Links to `/startup-status` and `/healthz` for programmatic monitoring

### 4. Reduced Log Spam

Proxy error handler now:
- Suppresses `ECONNREFUSED` errors during `STARTING` state (expected)
- Returns 503 with "Gateway is starting up, please wait..." instead of logging
- Only logs proxy errors when `state !== STARTING` (actual issues)

### 5. Extended Timeout

Gateway readiness timeout increased:
- **Before**: 60 seconds
- **After**: 120 seconds

This accommodates Railway's cold start times (observed 58s) with safety margin.

### 6. Background Health Monitor

If initial readiness check times out, background monitor continues:
- Checks every 10 seconds
- Automatically sets state to `READY` when gateway responds
- Updates startup state with elapsed time for diagnostics

## Changes to `src/server.js`

1. **Lines 104-123**: Added `StartupState` enum and tracking variables
2. **Lines 347-373**: Updated `waitForGatewayReady()` with 120s timeout and state updates
3. **Lines 378-381**: Set `STARTING` state when `startGateway()` begins
4. **Lines 459-470**: Set `ERROR` state on gateway spawn errors/exits
5. **Lines 494-497**: Background monitor sets `READY` state on success
6. **Lines 525-552**: `ensureGatewayRunning()` sets states throughout lifecycle
7. **Lines 664-682**: New `/startup-status` endpoint
8. **Lines 2053-2079**: Proxy error handler suppresses ECONNREFUSED during startup
9. **Lines 2095-2127**: Middleware shows startup page during `STARTING` state

## Testing

### Local Docker Test

```bash
# Build and run
docker build -t openclaw-test .
docker run --rm -p 8080:8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-test

# In another terminal, monitor startup
watch -n 1 'curl -s http://localhost:8080/startup-status | jq'

# Try accessing root while starting
curl http://localhost:8080/
# Should show friendly HTML page, not 502
```

### Railway Deployment Test

1. Deploy to Railway with attached volume
2. Monitor startup via `/startup-status`:
   ```bash
   watch -n 2 'curl -s https://your-app.railway.app/startup-status | jq'
   ```
3. Visit `https://your-app.railway.app/` during startup:
   - Should show animated spinner page
   - Should auto-refresh every 3 seconds
   - Should transition to OpenClaw UI when ready

4. Check logs for cleanup:
   - No `ECONNREFUSED` spam during startup
   - Clear state transitions logged:
     ```
     [startup-state] → STARTING: Initializing gateway...
     [gateway] ready at /openclaw (58.2s elapsed)
     [startup-state] → READY: Gateway ready after 58.2s
     ```

## Benefits

✅ **User Experience**: Friendly "starting up" page instead of 502 errors  
✅ **Observability**: `/startup-status` endpoint for monitoring  
✅ **Log Quality**: No ECONNREFUSED spam during normal cold starts  
✅ **Reliability**: 120s timeout handles Railway's cold start times  
✅ **Diagnostics**: Elapsed time tracking helps identify slow starts  

## Backward Compatibility

- No breaking changes to existing endpoints
- `/healthz` unchanged (Railway health checks continue working)
- Setup wizard `/setup` unchanged
- Only affects unconfigured state or startup window
