# Dedicated Health Check Endpoint

This document explains the dedicated health check server that runs alongside the main OpenClaw application.

## Overview

The health check server provides a lightweight HTTP endpoint for verifying the OpenClaw instance during and after deployment, without depending on the main application server.

**Key Features:**
- ✅ Separate port (configurable, default 8888)
- ✅ Configurable endpoint path (default `/health`)
- ✅ Build & deployment metadata
- ✅ Gateway connectivity verification
- ✅ Resource monitoring (uptime, memory)
- ✅ Suitable for Kubernetes, Docker, and monitoring systems

## Quick Start

### Check Health (Default Configuration)

```bash
curl http://localhost:8888/health
```

Expected response (200 OK):
```json
{
  "timestamp": "2026-02-16T10:30:45.123Z",
  "status": "healthy",
  "version": {
    "git_sha": "e31368f2abc...",
    "git_sha_short": "e31368f",
    "build_date": "2026-02-16T09:00:00Z",
    "deployment_time": "2026-02-16T10:15:30Z"
  },
  "environment": {
    "node_env": "production",
    "gateway_host": "localhost",
    "gateway_port": 18789
  },
  "checks": {
    "gateway": {
      "status": "healthy",
      "latency_ms": 12,
      "status_code": 200
    }
  },
  "uptime_seconds": 3600,
  "memory_usage_mb": 128
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_CHECK_PORT` | `8888` | Port the health check server listens on |
| `HEALTH_CHECK_PATH` | `/health` | HTTP path for the health check endpoint |
| `BUILD_DATE` | `unknown` | Build timestamp (set by CI/CD) |
| `GIT_SHA` | `unknown` | Git commit SHA (set by CI/CD) |
| `DEPLOYMENT_TIME` | Now | Deployment timestamp |
| `OPENCLAW_GATEWAY_HOST` | `localhost` | Gateway hostname for health checks |
| `OPENCLAW_GATEWAY_PORT` | `18789` | Gateway port for health checks |

### Example: Custom Port and Path

```bash
HEALTH_CHECK_PORT=9000 \
HEALTH_CHECK_PATH=/status \
  node src/healthcheck-server.js
```

Then check health at: `http://localhost:9000/status`

### Example: In Docker

```bash
docker run \
  -e HEALTH_CHECK_PORT=8888 \
  -e HEALTH_CHECK_PATH=/health \
  -e BUILD_DATE="2026-02-16T09:00:00Z" \
  -e GIT_SHA="e31368f2abc..." \
  -p 8888:8888 \
  openclaw-railway-template
```

## Endpoints

### GET `/health` (or configured path)

Returns detailed health information with deployment metadata.

**Response (200 OK - Healthy):**
```json
{
  "timestamp": "2026-02-16T10:30:45.123Z",
  "status": "healthy",
  "version": { ... },
  "checks": { ... },
  "uptime_seconds": 3600,
  "memory_usage_mb": 128
}
```

**Response (503 Service Unavailable - Degraded):**
```json
{
  "timestamp": "2026-02-16T10:30:45.123Z",
  "status": "degraded",
  "version": { ... },
  "checks": {
    "gateway": {
      "status": "unreachable",
      "latency_ms": 5000,
      "error": "Gateway timeout"
    }
  }
}
```

### HEAD `/health` (or configured path)

Returns only HTTP status code (no body). Useful for load balancers and Kubernetes probes.

**Response (200 OK - Healthy):** Status code only
**Response (503 Service Unavailable - Degraded):** Status code only

```bash
curl -I http://localhost:8888/health
# HTTP/1.1 200 OK
```

### GET `/version`

Returns version information only (no full health check).

```bash
curl http://localhost:8888/version
```

Response:
```json
{
  "git_sha": "e31368f2abc...",
  "git_sha_short": "e31368f",
  "build_date": "2026-02-16T09:00:00Z",
  "deployment_time": "2026-02-16T10:15:30Z"
}
```

### GET `/ping`

Simple liveness check (no health verification).

```bash
curl http://localhost:8888/ping
```

Response:
```json
{
  "status": "ok"
}
```

## Health Checks

### Gateway Connectivity

The health check verifies that the OpenClaw Gateway is reachable and responding:

- **Tests:** HTTP GET to `OPENCLAW_GATEWAY_HOST:OPENCLAW_GATEWAY_PORT`
- **Timeout:** 5 seconds
- **Status Values:**
  - `healthy` — Gateway responding (HTTP 200)
  - `unreachable` — Connection refused or timeout
  - `timeout` — No response within 5 seconds

**Response includes latency (ms) for monitoring.**

## Use Cases

### Docker HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8888/health || exit 1
```

The provided Dockerfile already includes this.

### Kubernetes Liveness & Readiness Probes

**liveness (is the container alive?):**
```yaml
livenessProbe:
  httpGet:
    path: /ping
    port: 8888
  initialDelaySeconds: 15
  periodSeconds: 30
```

**readiness (is the app ready to serve traffic?):**
```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 8888
  initialDelaySeconds: 10
  periodSeconds: 10
```

### Deployment Verification

After deploying a new version, verify the instance:

```bash
#!/bin/bash
NEW_INSTANCE="https://my-openclaw-instance.railway.app:8888"

echo "Waiting for deployment to complete..."
for i in {1..30}; do
  RESPONSE=$(curl -s "$NEW_INSTANCE/health")
  GIT_SHA=$(echo "$RESPONSE" | jq -r '.version.git_sha_short')
  STATUS=$(echo "$RESPONSE" | jq -r '.status')
  
  if [[ "$STATUS" == "healthy" ]]; then
    echo "✅ Deployment successful!"
    echo "Running version: $GIT_SHA"
    exit 0
  fi
  
  echo "⏳ Waiting... ($i/30)"
  sleep 2
done

echo "❌ Deployment failed to become healthy"
exit 1
```

### Monitoring & Alerts

Track deployment times and build information:

```bash
# Check deployment time
curl -s http://localhost:8888/version | jq '.deployment_time'

# Check build date
curl -s http://localhost:8888/version | jq '.build_date'

# Monitor memory usage
curl -s http://localhost:8888/health | jq '.memory_usage_mb'

# Check gateway latency
curl -s http://localhost:8888/health | jq '.checks.gateway.latency_ms'
```

## Performance & Resource Usage

The health check server:
- Runs on a **separate port** → doesn't compete with main application
- Lightweight HTTP server → minimal CPU/memory overhead
- Async health checks → non-blocking verification
- Short timeouts → fails fast on connection issues

**Typical resource usage:**
- Memory: ~10-20 MB (varies by Node.js version)
- CPU: <1% at rest
- Network: ~200 bytes per request

## Response Headers

All responses include CORS headers:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, HEAD, OPTIONS
Content-Type: application/json; charset=utf-8
```

## Status Codes

| Code | Meaning |
|------|---------|
| `200` | Healthy (gateway reachable, all checks pass) |
| `503` | Degraded (gateway unreachable or timeout) |
| `404` | Endpoint not found |
| `405` | Method not allowed |

## Troubleshooting

### "Connection refused" on port 8888

Check if the health check server is running:

```bash
# Inside the container
curl http://localhost:8888/ping

# Or check the server is listening
netstat -tlnp | grep 8888

# Check logs for startup errors
docker logs <container-id>
```

### "Gateway unreachable" in response

The health check server can't reach the OpenClaw Gateway.

**Possible causes:**
- Gateway not running
- Wrong `OPENCLAW_GATEWAY_HOST` or `OPENCLAW_GATEWAY_PORT`
- Network connectivity issues

**Check:**
```bash
# Verify Gateway is running
curl http://localhost:18789/

# Check env vars
env | grep OPENCLAW_GATEWAY

# Inside container, test connectivity
nc -zv localhost 18789
```

### Deployment shows "degraded" status

This is normal if the Gateway hasn't fully started yet. The health check is working correctly.

**Solution:**
- Wait a few seconds and retry
- Adjust Docker `start-period` if using HEALTHCHECK
- Check Gateway logs for startup issues

### Custom path not working

Verify `HEALTH_CHECK_PATH` env var is set:

```bash
# Should respond
curl http://localhost:8888/health

# Won't respond (not configured)
curl http://localhost:8888/custom
```

Change the path:

```bash
HEALTH_CHECK_PATH=/custom \
  node src/healthcheck-server.js

# Now responds
curl http://localhost:8888/custom
```

## Architecture

```
┌─────────────────────────┐
│  Container/Instance     │
├─────────────────────────┤
│                         │
│  ┌─────────────────┐   │
│  │ Health Check    │◄──┼─── :8888 (configurable)
│  │ Server          │   │
│  └────────┬────────┘   │
│           │            │
│           ├──checks──► Gateway (18789)
│           │            │
│           └──reports   └─ Build metadata
│                           - GIT_SHA
│  ┌──────────────────┐    - BUILD_DATE
│  │ Main Application │    - DEPLOYMENT_TIME
│  │ (OpenClaw)       │    - Uptime
│  │ :8080            │    - Memory usage
│  └──────────────────┘   │
│                         │
└─────────────────────────┘
```

## Related Documentation

- [Dockerfile](../Dockerfile) - Container configuration
- [scripts/start.sh](../scripts/start.sh) - Startup script (runs both servers)
- [OpenClaw Gateway](https://docs.openclaw.ai) - Main application docs
