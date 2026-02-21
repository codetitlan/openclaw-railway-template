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
# Local development (requires Openclaw in /openclaw or OPENCLAW_ENTRY set)
npm run dev

# Production start
npm start

# Syntax check
npm run lint

# Local smoke test (requires Docker)
npm run smoke
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

### Request Flow

1. **User → Railway → Wrapper (Express on PORT)** → routes to:
   - `/setup/*` → setup wizard (auth: Basic with `SETUP_PASSWORD`)
   - All other routes → proxied to internal gateway

2. **Wrapper → Gateway** (localhost:18789 by default)
   - HTTP/WebSocket reverse proxy via `http-proxy`
   - Automatically injects `Authorization: Bearer <token>` header

### Lifecycle States

1. **Unconfigured**: No `openclaw.json` exists
   - All non-`/setup` routes redirect to `/setup`
   - User completes setup wizard → runs `openclaw onboard --non-interactive`

2. **Configured**: `openclaw.json` exists
   - Wrapper spawns `openclaw gateway run` as child process
   - Waits for gateway to respond on multiple health endpoints
   - Proxies all traffic with injected bearer token

### Key Files

- **src/server.js** (main entry): Express wrapper, proxy setup, gateway lifecycle management, configuration persistence (server logic only - no inline HTML/CSS)
- **src/public/** (static assets for setup wizard):
  - **setup.html**: Setup wizard HTML structure
  - **styles.css**: Setup wizard styling (extracted from inline styles)
  - **setup-app.js**: Client-side JS for `/setup` wizard (vanilla JS, no build step)
- **Dockerfile**: Multi-stage build (builds Openclaw from source, installs wrapper deps). When `OPENCLAW_VERSION` is not set, auto-detects the latest stable GitHub release via a 3-tier cascade: GitHub Releases API → `git ls-remote` tag detection → `main` fallback (with warning)

### Environment Variables

**Required:**

- `SETUP_PASSWORD` — protects `/setup` wizard

**Recommended (Railway template defaults):**

- `OPENCLAW_STATE_DIR=/data/.openclaw` — config + credentials
- `OPENCLAW_WORKSPACE_DIR=/data/workspace` — agent workspace

**Optional:**

- `OPENCLAW_GATEWAY_TOKEN` — auth token for gateway (auto-generated if unset)
- `PORT` — wrapper HTTP port (default 8080)
- `INTERNAL_GATEWAY_PORT` — gateway internal port (default 18789)
- `OPENCLAW_ENTRY` — path to `entry.js` (default `/openclaw/dist/entry.js`)

### Authentication Flow

The wrapper manages a **two-layer auth scheme**:

1. **Setup wizard auth**: Basic auth with `SETUP_PASSWORD` (src/server.js:190)
2. **Gateway auth**: Bearer token with multi-source resolution and automatic sync
   - **Token resolution order** (src/server.js:25-55):
     1. `OPENCLAW_GATEWAY_TOKEN` env variable (highest priority) ✅
     2. Persisted file at `${STATE_DIR}/gateway.token`
     3. Generate new random token and persist
   - **Token synchronization**:
     - During onboarding: Synced to `openclaw.json` with verification (src/server.js:478-511)
     - Every gateway start: Synced to `openclaw.json` with verification (src/server.js:120-143)
     - Reason: Openclaw gateway reads token from config file, not from `--token` flag
   - **Token injection**:
     - HTTP requests: via `proxy.on("proxyReq")` event handler (src/server.js:761)
     - WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler (src/server.js:766)

### Onboarding Process

When the user runs setup (src/server.js:447-650):

1. Calls `openclaw onboard --non-interactive` with user-selected auth provider and `--gateway-token` flag
2. **Syncs wrapper token to `openclaw.json`** (overwrites whatever `onboard` generated):
   - Sets `gateway.auth.token` to `OPENCLAW_GATEWAY_TOKEN` env variable
   - Verifies sync succeeded by reading config file back
   - Logs warning/error if mismatch detected
3. Writes channel configs (Telegram/Discord/Slack) directly to `openclaw.json` via `openclaw config set --json`
4. Force-sets gateway config to use token auth + loopback bind + allowInsecureAuth
5. Restarts gateway process to apply all config changes
6. Waits for gateway readiness (polls multiple endpoints)

**Important**: Channel setup bypasses `openclaw channels add` and writes config directly because `channels add` is flaky across different Openclaw builds.

### Gateway Token Injection

The wrapper **always** injects the bearer token into proxied requests so browser clients don't need to know it:

- HTTP requests: via `proxy.on("proxyReq")` event handler (src/server.js:736)
- WebSocket upgrades: via `proxy.on("proxyReqWs")` event handler (src/server.js:741)

**Important**: Token injection uses `http-proxy` event handlers (`proxyReq` and `proxyReqWs`) rather than direct `req.headers` modification. Direct header modification does not reliably work with WebSocket upgrades, causing intermittent `token_missing` or `token_mismatch` errors.

This allows the Control UI at `/openclaw` to work without user authentication.

### Backup Export

`GET /setup/export` (src/server.js:752-800):

- Creates a `.tar.gz` archive of `STATE_DIR` and `WORKSPACE_DIR`
- Preserves relative structure under `/data` (e.g., `.openclaw/`, `workspace/`)
- Includes dotfiles (config, credentials, sessions)

## Common Development Tasks

### Testing the setup wizard

1. Delete `${STATE_DIR}/openclaw.json` (or run Reset in the UI)
2. Visit `/setup` and complete onboarding
3. Check logs for gateway startup and channel config writes

### Testing authentication

- Setup wizard: Clear browser auth, verify Basic auth challenge
- Gateway: Remove `Authorization` header injection (src/server.js:736) and verify requests fail

### Debugging gateway startup

Check logs for:

- `[gateway] starting with command: ...` (src/server.js:142)
- `[gateway] ready at <endpoint>` (src/server.js:100)
- `[gateway] failed to become ready after 20000ms` (src/server.js:109)

If gateway doesn't start:

- Verify `openclaw.json` exists and is valid JSON
- Check `STATE_DIR` and `WORKSPACE_DIR` are writable
- Ensure bearer token is set in config

### Modifying onboarding args

Edit `buildOnboardArgs()` (src/server.js:442-496) to add new CLI flags or auth providers.

### Adding new channel types

1. Add channel-specific fields to `/setup` HTML (src/public/setup.html)
2. Add config-writing logic in `/setup/api/run` handler (src/server.js)
3. Update client JS to collect the fields (src/public/setup-app.js)

## Railway Deployment Notes

- Template must mount a volume at `/data`
- Must set `SETUP_PASSWORD` in Railway Variables
- Public networking must be enabled (assigns `*.up.railway.app` domain)
- Openclaw version is **auto-detected** at build time (latest stable release); set `OPENCLAW_VERSION` only to pin a specific tag/branch

## Serena Semantic Coding

This project has been onboarded with **Serena** (semantic coding assistant via MCP). Comprehensive memory files are available covering:

- Project overview and architecture
- Tech stack and codebase structure
- Code style and conventions
- Development commands and task completion checklist
- Quirks and gotchas

**When working on tasks:**

1. Check `mcp__serena__check_onboarding_performed` first to see available memories
2. Read relevant memory files before diving into code (e.g., `mcp__serena__read_memory`)
3. Use Serena's semantic tools for efficient code exploration:
   - `get_symbols_overview` - Get high-level file structure without reading entire file
   - `find_symbol` - Find classes, functions, methods by name path
   - `find_referencing_symbols` - Understand dependencies and usage
4. Prefer symbolic editing (`replace_symbol_body`, `insert_after_symbol`) for precise modifications

This avoids repeatedly reading large files and provides instant context about the project.

## New Features (Enhanced OpenClaw - Days 1-7)

### Day 1: Health, Diagnostics & Gateway Lifecycle

**Public Health Endpoint** (src/server.js:330-355)

- `GET /healthz` - No auth required, returns gateway status
- TCP-based gateway probe for reliable up/down detection
- Returns: `{ok: true/false, gateway: {status, lastError, lastExit, lastDoctor}}`

**Error Tracking** (src/server.js:140-144)

- `lastGatewayError` - Last error from gateway process
- `lastGatewayExit` - Last exit code and signal
- `lastDoctorOutput` - Last `openclaw doctor` output

**Auto Doctor** (src/server.js:218-231)

- Runs `openclaw doctor` automatically on gateway failures
- 5-minute rate limit to prevent spam
- Output stored in `lastDoctorOutput` for diagnostics

**Secret Redaction** (src/server.js:244-270)

- `redactSecrets()` function redacts 5 token patterns
- Applied to all debug console output
- Protects API keys, tokens, and secrets

### Day 2: Environment Migration & Configuration

**Environment Variable Migration** (src/server.js:11-32)

- Auto-migrates `CLAWDBOT_*` → `OPENCLAW_*`
- Auto-migrates `MOLTBOT_*` → `OPENCLAW_*`
- Logs warnings for deprecated env vars

**Legacy Config File Migration** (src/server.js:116-135)

- Auto-renames `moltbot.json` → `openclaw.json`
- Auto-renames `clawdbot.json` → `openclaw.json`
- Atomic rename with existence checks

**Enhanced runCmd** (src/server.js:173-216)

- 120s default timeout (configurable)
- SIGTERM → SIGKILL escalation
- Returns exit code 124 for timeout (GNU timeout compatible)

**Railway Proxy Trust** (src/server.js:751-754)

- Sets `gateway.trustedProxies=["127.0.0.1"]`
- Required for Railway reverse proxy

### Day 3: Debug Console (Backend & Frontend)

**Allowlisted Command System** (src/server.js:1313-1442)

- 13 commands in strict allowlist (Set-based)
- Gateway lifecycle: restart, stop, start
- OpenClaw CLI: version, status, health, doctor, logs --tail
- Config inspection: get any config path
- Device management: list, approve with requestId regex
- Plugin management: list, enable with name regex

**POST /setup/api/console/run** (src/server.js:1313-1442)

- Validates command against allowlist
- Executes via runCmd with timeout
- Returns redacted output
- Requires SETUP_PASSWORD auth

**Enhanced /setup/api/debug** (src/server.js:1268-1311)

- Channel diagnostics (Telegram/Discord status)
- Plugin list
- Auth groups
- Full system diagnostics

### Day 4: Config Editor & Pairing Helper

**Config Editor** (src/server.js:1444-1528)

- `GET /setup/api/config/raw` - Load config
- `POST /setup/api/config/raw` - Save config
- 500KB size limit (DoS prevention)
- Timestamped backups: `.bak-YYYY-MM-DDTHH-MM-SS-SSSZ`
- JSON validation before save
- File permissions 0o600
- Auto-restart gateway after save

**Device Pairing Helper** (src/server.js:1530-1601)

- `GET /setup/api/devices/pending` - List pending devices
- `POST /setup/api/devices/approve` - Approve device
- Extracts requestIds from `openclaw devices list` output
- Validates requestId format (alphanumeric + hyphens)
- Fixes "disconnected (1008): pairing required" errors

### Day 5: Import Backup & Plugin Management

**Backup Import** (src/server.js:1713-1831)

- `POST /setup/import` - Import .tar.gz backup
- 250MB max upload size
- Path traversal prevention (`isUnderDir`, `looksSafeTarPath`)
- Extracts to /data only (Railway volume security)
- Gateway stop before import, restart after
- Temp file cleanup

**Security Helpers** (src/server.js:1604-1678)

- `isUnderDir(child, parent)` - Prevents path traversal
- `looksSafeTarPath(entry)` - Rejects `.., /, C:` patterns
- `readBodyBuffer(req, maxBytes)` - Enforces size limits

**Enhanced Setup** (src/server.js:1078-1109)

- Telegram plugin auto-enable after config
- `openclaw doctor --fix` after setup
- Better error messages with troubleshooting steps

### Day 6: Custom Providers & Robustness

**Custom Provider Configuration** (src/server.js:756-788)

- Add OpenAI-compatible providers (Ollama, vLLM, etc.)
- Validation: URL, provider ID, env var names, model
- `models.mode='merge'` preserves existing providers
- API keys via env var interpolation (`${VAR}`)

**Status Endpoint Resilience** (src/server.js:642-676)

- 5s timeout on openclaw CLI calls
- Try-catch around version/help checks
- Returns 'unknown' on failure (no UI blocking)
- Frontend fallback if auth groups fail

**Enhanced Error Messages** (src/server.js:Various)

- Gateway failure: actionable troubleshooting
- Proxy error: references `/healthz`, Debug Console
- Auth secret: hints about API key field
- Import errors: show file sizes, paths, env var fixes (Day 7)

### Day 7: Polish, Testing & Documentation

**Improved Error Messages** (src/server.js:1690, 1488, 1721)

- File size errors show human-readable units (MB/KB)
- Import /data error shows actual paths and env var fix
- All errors include actionable details

**Security Hardening** (src/server.js:2031, 68, 922, 1981, 2075)

- Credentials directory: 700 permissions (not 755)
- Token logging: Protected by DEBUG flag
- Sensitive logs: Use `debug()` helper or `if (DEBUG)`
- Only logs full tokens when `OPENCLAW_TEMPLATE_DEBUG=true`

**Debug Helper** (src/server.js:51-54)

- `debug()` function only logs when DEBUG=true
- Used for verbose/sensitive logging
- Prevents token leaks in production

## Testing New Features

See `DAY7-TEST-REPORT.md` for comprehensive test results.

Quick smoke test:

```bash
# 1. Health check
curl http://localhost:8080/healthz

# 2. Debug console (visit /setup and try commands)

# 3. Config editor (visit /setup and load/save config)

# 4. Export backup
curl -u user:$SETUP_PASSWORD http://localhost:8080/setup/export -o backup.tar.gz

# 5. Import backup (via UI at /setup)

# 6. Custom provider (configure Ollama in /setup wizard)
```

## Quirks & Gotchas

1. **Gateway token must be stable across redeploys** → Always set `OPENCLAW_GATEWAY_TOKEN` env variable in Railway (highest priority); token is synced to `openclaw.json` during onboarding (src/server.js:478-511) and on every gateway start (src/server.js:120-143) with verification. This is required because `openclaw onboard` generates its own random token and the gateway reads from config file, not from `--token` CLI flag. Sync failures throw errors and prevent gateway startup.
2. **Channels are written via `config set --json`, not `channels add`** → avoids CLI version incompatibilities
3. **Gateway readiness check polls multiple endpoints** (`/openclaw`, `/`, `/health`) → some builds only expose certain routes (src/server.js:92)
4. **Discord bots require MESSAGE CONTENT INTENT** → document this in setup wizard (src/server.js:295-298)
5. **Gateway spawn inherits stdio** → logs appear in wrapper output (src/server.js:134)
6. **WebSocket auth requires proxy event handlers** → Direct `req.headers` modification doesn't work for WebSocket upgrades with http-proxy; must use `proxyReqWs` event (src/server.js:741) to reliably inject Authorization header
7. **Control UI requires allowInsecureAuth to bypass pairing** → Set `gateway.controlUi.allowInsecureAuth=true` during onboarding to prevent "disconnected (1008): pairing required" errors (GitHub issue #2284). Wrapper already handles bearer token auth, so device pairing is unnecessary.
8. **Debug logging must check DEBUG flag** → Never log sensitive tokens/keys without checking `if (DEBUG)` or using `debug()` helper. Production logs must not leak secrets.
9. **Credentials directory permissions** → Must be 700 (owner-only), not 755. Set during mkdir and enforce with explicit chmod.
10. **Import requires /data paths** → `OPENCLAW_STATE_DIR` and `OPENCLAW_WORKSPACE_DIR` must be under `/data` for Railway volume security. Import validates this and shows detailed error with fix.
