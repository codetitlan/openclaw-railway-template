# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is a Railway deployment wrapper for **Openclaw** (an AI coding assistant platform). It provides:

- A web-based setup wizard at `/setup` (protected by `SETUP_PASSWORD`)
- Automatic reverse proxy from public URL → internal Openclaw gateway
- Persistent state via Railway Volume at `/data`
- One-click backup export of configuration and workspace

The wrapper manages the Openclaw lifecycle: onboarding → gateway startup → traffic proxying.

## Development Commands

```bash
# Local development — starts server.js only (no healthcheck-server)
npm run dev

# Syntax check (only checks src/server.js)
npm run lint

# Local smoke test (requires Docker)
npm run smoke

# Full stack start (production) — starts both servers via scripts/start.sh
bash scripts/start.sh
```

## Docker Build & Local Testing

```bash
# Build the container (builds Openclaw from source)
docker build -t openclaw-railway-template .

# Run locally with volume
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# Access setup wizard
open http://localhost:8080/setup  # password: test
```

## Architecture

### Two-Process Design

Production startup (`scripts/start.sh`) runs two Node processes in parallel:

| Process | Port | Serves |
|---|---|---|
| `src/healthcheck-server.js` | `HEALTH_CHECK_PORT` (default 8888) | External Railway traffic: `/health`, `/integration-test`, `/version`, `/ping` |
| `src/server.js` | `PORT` (default 8080) | Setup wizard (`/setup/*`) + gateway reverse proxy (all other routes) |

**Critical**: External Railway traffic goes to `healthcheck-server.js`. Adding routes to `server.js` alone will not make them externally reachable. The `/integration-test` endpoint belongs in `healthcheck-server.js`.

`start.sh` traps `SIGTERM`/`SIGINT` and kills both PIDs, so `npm start` (server.js only) is unsuitable for production.

### Request Flow

```
External request
  └─► healthcheck-server.js (port 8888)
        ├─ /health          → buildHealthResponse() (gateway connectivity + version)
        ├─ /integration-test → runIntegrationChecks() (Himalaya, Claude API, Telegram, GitHub, Brave)
        ├─ /version         → build metadata
        └─ /ping            → {"status":"ok"}

Browser / setup wizard
  └─► server.js (port 8080)
        ├─ /setup/*         → setup wizard (Basic auth with SETUP_PASSWORD)
        └─ *                → reverse proxy → Openclaw gateway (localhost:18789)
```

### Lifecycle States

1. **Unconfigured**: No `openclaw.json` exists
   - All non-`/setup` routes redirect to `/setup`
   - User completes setup wizard → runs `openclaw onboard --non-interactive`

2. **Configured**: `openclaw.json` exists
   - `server.js` spawns `openclaw gateway run` as child process
   - Waits for gateway to respond on multiple health endpoints
   - Proxies all traffic with injected bearer token

### Key Files

- **src/healthcheck-server.js**: Standalone HTTP server (raw `node:http`). Serves all external health/status endpoints including `/integration-test`. Uses `execFile` for shell checks. No Express dependency.
- **src/server.js**: Express app. Setup wizard, gateway lifecycle management (spawn/wait/restart), config persistence, reverse proxy with bearer token injection.
- **src/public/**: Static assets for setup wizard (`setup.html`, `styles.css`, `setup-app.js`). Vanilla JS, no build step.
- **scripts/start.sh**: Production entrypoint — starts both servers, handles signals.
- **Dockerfile**: Multi-stage build (builds Openclaw from source, installs wrapper deps).

### Environment Variables

**Required:**
- `SETUP_PASSWORD` — protects `/setup` wizard

**Recommended (Railway template defaults):**
- `OPENCLAW_STATE_DIR=/data/.openclaw` — config + credentials
- `OPENCLAW_WORKSPACE_DIR=/data/workspace` — agent workspace

**Optional:**
- `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway (auto-generated if unset; set this to keep token stable across redeploys)
- `PORT` — wrapper HTTP port (default 8080)
- `HEALTH_CHECK_PORT` — healthcheck server port (default 8888)
- `INTERNAL_GATEWAY_PORT` — gateway internal port (default 18789)
- `OPENCLAW_ENTRY` — path to `entry.js` (default `/openclaw/dist/entry.js`)
- `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `BRAVE_API_KEY` — checked by `/integration-test`

### Authentication Flow

Two-layer auth:

1. **Setup wizard**: Basic auth with `SETUP_PASSWORD`
2. **Gateway**: Bearer token with multi-source resolution:
   - Priority order: `OPENCLAW_GATEWAY_TOKEN` env → persisted `${STATE_DIR}/gateway.token` → auto-generated
   - Token is synced to `openclaw.json` during onboarding and on every gateway start (gateway reads from config file, not from CLI flag)
   - Token is injected into all proxied requests via `proxy.on("proxyReq")` and `proxy.on("proxyReqWs")` — direct `req.headers` modification does not work reliably for WebSocket upgrades

### Integration Test Endpoint

`GET /integration-test` (served by `healthcheck-server.js`):

- **Himalaya**: required — checks `which himalaya`
- **Claude API** (`ANTHROPIC_API_KEY`): required — hits `GET /v1/models`
- **Telegram** (`TELEGRAM_BOT_TOKEN`): optional — calls `getMe`
- **GitHub** (`GITHUB_TOKEN`): optional — calls `/user`
- **Brave Search** (`BRAVE_API_KEY`): optional — calls `/res/v1/web/search`

Returns `{ status: "ok"|"failed", timestamp, results: {...} }` with HTTP 200/500.
CI calls this via: `curl -s --fail-with-body "${API_BASE_URL}/integration-test"`

### Backup Export

`GET /setup/export` (served by `server.js`):
- Creates `.tar.gz` of `STATE_DIR` + `WORKSPACE_DIR`
- Preserves relative structure under `/data`

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → Always set `OPENCLAW_GATEWAY_TOKEN` in Railway Variables. `openclaw onboard` generates its own random token; the wrapper overwrites it in `openclaw.json` and verifies the sync. Sync failures throw errors and block gateway startup.
2. **Channels written via `config set --json`, not `channels add`** → avoids CLI version incompatibilities.
3. **Gateway readiness polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some Openclaw builds only expose certain routes.
4. **Discord bots require MESSAGE CONTENT INTENT** → document in setup wizard.
5. **Control UI requires `allowInsecureAuth`** → set `gateway.controlUi.allowInsecureAuth=true` during onboarding to prevent "disconnected (1008): pairing required" errors. The wrapper handles bearer token auth, so device pairing is unnecessary.
6. **Railway healthcheck path** (`railway.toml`) is `/setup/healthz`, served by `server.js`.

## Railway Deployment Notes

- Template must mount a volume at `/data`
- Must set `SETUP_PASSWORD` in Railway Variables
- Public networking must be enabled (assigns `*.up.railway.app` domain)
- Openclaw version is pinned via Docker build arg `OPENCLAW_GIT_REF` (default: `main`)
- CI/CD pipeline is in `.github/workflows/cd.yml`, delegating to `bb-claw/ci-workflows@main`
