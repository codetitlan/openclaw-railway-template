# Container Shutdown Script

Gracefully shutdown the OpenClaw container with optional cleanup.

## Usage

```bash
# Graceful shutdown (default: 20s timeout, cleanup enabled)
./scripts/shutdown.sh

# Graceful shutdown with custom reason
./scripts/shutdown.sh --reason "Maintenance window"

# Force shutdown after timeout
./scripts/shutdown.sh --force

# Skip cleanup tasks
./scripts/shutdown.sh --no-cleanup

# Combined options
./scripts/shutdown.sh --force --no-cleanup --reason "Emergency stop"
```

## Options

- **`--force`**: Force kill (SIGKILL) if graceful shutdown exceeds timeout
- **`--no-cleanup`**: Skip cleanup tasks (filesystem sync, process cleanup)
- **`--reason`**: Custom shutdown reason (for logging)

## What It Does

### Cleanup Phase (if `--no-cleanup` not set)
1. **Filesystem sync**: Flushes pending writes to disk (`sync`)
2. **Process cleanup**: Kills stray gateway/tailscale processes
3. Logs completion

### Shutdown Phase
1. Sends SIGTERM to wrapper process (PID 1)
2. Waits up to 20 seconds for graceful shutdown
3. Logs waiting status every second
4. If still running after timeout and `--force` is set, sends SIGKILL
5. Returns exit code (0 = success, 1 = failure)

## Exit Codes

- **0**: Shutdown successful
- **1**: Shutdown failed (process still running)

## When to Use

### Normal Shutdown
```bash
./scripts/shutdown.sh
```
Allows graceful shutdown with cleanup (good for planned maintenance).

### Emergency Stop
```bash
./scripts/shutdown.sh --force
```
Forces termination if graceful shutdown is hanging (use when container is unresponsive).

### Diagnostic Shutdown
```bash
./scripts/shutdown.sh --no-cleanup --reason "Debugging filesystem"
```
Skips cleanup to preserve state for investigation.

## Container Environment

The script is designed for use in the railway container where:
- Wrapper process runs as PID 1
- Container has 20-30s total shutdown window before Railway force-kills
- Graceful shutdown allows state flushing to `/data/.openclaw` volume

## Example: Railway Lifecycle Hook

To integrate with Railway's container lifecycle (if supported):

```bash
# Before container stop
POST /shutdown

# Server response should:
# - Run cleanup tasks
# - Flush state
# - Exit cleanly within 20s
```

## Logs

The script outputs colored status messages:

```
========== OPENCLAW SHUTDOWN ==========
Reason: manual shutdown
Force after 20s: false
Cleanup: true

Running cleanup tasks...
  • Syncing filesystem...
  • Cleaning up processes...
Cleanup complete

Sending SIGTERM to wrapper process...
  • Waiting for graceful shutdown (0s/20s)...
  • Waiting for graceful shutdown (1s/20s)...
✓ OpenClaw shutdown complete (2s)
```

## Timeout Tuning

Current timeout: 20 seconds (configurable in script)

This matches:
- Gateway shutdown grace period: 5s
- Force-kill timeout: 20s total (to stay under Railway's 30s shutdown window)

Increase if you have large state files or slow disk I/O:
```bash
# In shutdown.sh, modify:
TIMEOUT=30  # was 20
```

## Troubleshooting

**"Shutdown failed (process still running)"**
- Wrapper didn't respond to SIGTERM
- Try with `--force` to SIGKILL
- Check container logs for errors

**"Waiting for graceful shutdown (Xs/20s)..."** keeps repeating
- Gateway taking too long to flush state
- Volume I/O may be slow
- Consider using `--force` after a few iterations
