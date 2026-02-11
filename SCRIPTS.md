# Scripts

Utility scripts for railclaw deployment and testing.

## integration-tests.sh

Tests connectivity and authentication with key integrations.

**Tests:**
- **Telegram**: Bot token validation via `getMe` API
- **Claude API**: Anthropic API key validation with test message
- **GitHub API**: GitHub token authentication (optional)

**Usage:**
```bash
# Set environment variables
export TELEGRAM_BOT_TOKEN="..."
export ANTHROPIC_API_KEY="..."
export GITHUB_TOKEN="..."  # Optional

# Run tests
./scripts/integration-tests.sh
```

**Exit codes:**
- `0`: All tests passed
- `1`: At least one test failed

**Environment variables:**
- `TELEGRAM_BOT_TOKEN` — Telegram bot token (required)
- `ANTHROPIC_API_KEY` — Anthropic/Claude API key (required)
- `GITHUB_TOKEN` — GitHub personal access token (optional)

## shutdown-container.sh

Gracefully shuts down the container and optionally triggers Railway redeploy.

**Behavior:**
1. Sends SIGTERM signal to PID 1 (wrapper process)
2. Waits 25s for graceful shutdown (wrapper has 20s timeout)
3. If still running after 25s, sends SIGKILL
4. Optionally triggers Railway service redeploy via API

**Usage:**
```bash
# Graceful shutdown
./scripts/shutdown-container.sh

# With Railway redeploy (requires env vars)
export RAILWAY_API_TOKEN="..."
export RAILWAY_SERVICE_ID="..."
export RAILWAY_ENVIRONMENT_ID="..."
./scripts/shutdown-container.sh
```

**Environment variables:**
- `RAILWAY_SERVICE_ID` — Railway service ID (auto-set on Railway)
- `RAILWAY_API_TOKEN` — Railway API token (required for redeploy)
- `RAILWAY_ENVIRONMENT_ID` — Railway environment ID (required for redeploy)

## smoke.js

Simple smoke test (legacy, checks if server responds on PORT).

## shutdown.sh

Deprecated shutdown script (use `shutdown-container.sh` instead).
