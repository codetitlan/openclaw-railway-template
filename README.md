# Openclaw Railway Template (1‑click deploy)

[![Docker build](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/docker-build.yml/badge.svg)](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/docker-build.yml)
[![Docker build (Feature Branches)](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/docker-build-feature.yml/badge.svg)](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/docker-build-feature.yml)
[![Feature branch CI](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/feature-branch-ci.yml/badge.svg)](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/feature-branch-ci.yml)
[![Integration Tests](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/integration-tests.yml/badge.svg)](https://github.com/bb-claw/openclaw-railway-template/actions/workflows/integration-tests.yml)

This repo packages **Openclaw** for Railway with a small **/setup** web wizard so users can deploy and onboard **without running any commands**.

## What you get

- **Openclaw Gateway + Control UI** (served at `/` and `/openclaw`)
- A friendly **Setup Wizard** at `/setup` (protected by a password)
- Persistent state via **Railway Volume** (so config/credentials/memory survive redeploys)
- One-click **Export backup** (so users can migrate off Railway later)

## How it works (high level)

- The container runs a wrapper web server.
- The wrapper protects `/setup` with `SETUP_PASSWORD`.
- During setup, the wrapper runs `openclaw onboard --non-interactive ...` inside the container, writes state to the volume, and then starts the gateway.
- After setup, **`/` is Openclaw**. The wrapper reverse-proxies all traffic (including WebSockets) to the local gateway process.

## Railway deploy instructions (what you’ll publish as a Template)

In Railway Template Composer:

1. Create a new template from this GitHub repo.
2. Add a **Volume** mounted at `/data`.
3. Set the following variables:

Required:

- `SETUP_PASSWORD` — user-provided password to access `/setup`

Recommended:

- `OPENCLAW_STATE_DIR=/data/.openclaw`
- `OPENCLAW_WORKSPACE_DIR=/data/workspace`

Optional:

- `OPENCLAW_GATEWAY_TOKEN` — if not set, the wrapper generates one (not ideal). In a template, set it using a generated secret.

Notes:

- This template pins Openclaw to a known-good version by default via Docker build arg `OPENCLAW_VERSION`.

4. Enable **Public Networking** (HTTP). Railway will assign a domain.
5. Deploy.

Then:

- Visit `https://<your-app>.up.railway.app/setup`
- Complete setup
- Visit `https://<your-app>.up.railway.app/` and `/openclaw`

## Getting chat tokens (so you don’t have to scramble)

### Telegram bot token

1. Open Telegram and message **@BotFather**
2. Run `/newbot` and follow the prompts
3. BotFather will give you a token that looks like: `123456789:AA...`
4. Paste that token into `/setup`

### Discord bot token

1. Go to the Discord Developer Portal: https://discord.com/developers/applications
2. **New Application** → pick a name
3. Open the **Bot** tab → **Add Bot**
4. Copy the **Bot Token** and paste it into `/setup`
5. Invite the bot to your server (OAuth2 URL Generator → scopes: `bot`, `applications.commands`; then choose permissions)

## Deployment & Health Checks

After pushing to `main`, the following workflows run automatically:

1. **Docker build** - Builds and pushes image to GHCR
2. **Redeploy on Railway** - Triggers primary instance redeploy
3. **Health check** - Waits 60s, then verifies `/setup/healthz` endpoint is responding (max 10 minutes)
4. **Buddy deployment** - Automatically triggers after health check succeeds
   - Redeploys buddy service with latest image
   - Runs for configurable duration (default 2 hours)
   - Automatically scales down to save costs

### Health Check Details

- **Endpoint**: `{RAILWAY_PRIMARY_URL}/setup/healthz`
- **Initial wait**: 60 seconds after primary redeploy
- **Poll interval**: 10 seconds
- **Max attempts**: 60 (10 minutes total timeout)
- **Trigger**: Only runs on `main` branch pushes

### Buddy Instance Details

- **Triggered by**: Successful health check
- **Duration**: 2 hours (configurable via workflow dispatch)
- **Cost**: ~$0.50-1/day vs $7-8/day for always-on
- **Workflow**: `.github/workflows/deploy-buddy.yml`

See `.github/workflows/` for implementation details.

## Cost Optimization (Future-Ready)

This template includes forward-looking optimizations to reduce Anthropic API costs by 50-60%+ when OpenClaw adds support for these configuration options.

> ⚠️ **Note:** These settings require OpenClaw **v2026.3.0 or later** (currently running 2026.2.9). Configuration keys will be recognized once the feature is available upstream.

### Optimization Strategy

The following configuration reduces token usage by eliminating context bloat and enabling Anthropic prompt caching:

- **Context window** set to 120,000 tokens (safe limit, prevents edge case crashes)
- **Conversation history** limited to 20 messages / 50,000 tokens (prevents unbounded growth)
- **Prompt caching enabled** (reuses system prompts across requests, saves 90% on repeated context)
- **Auto-summarization** of old messages after 30 exchanges
- **Thinking budget** capped at 2000 tokens (prevents excessive reasoning cost)

### Expected Impact

- Input tokens: **20M → 8-10M per day** (50-60% reduction)
- Monthly savings: **~$216-288 on Anthropic API costs**
- Input/output ratio: **254:1 → 100:1** (optimized context usage)

### Configuration File (When Supported)

Once available, create or update `/data/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "contextTokens": 120000,
      "conversationHistory": {
        "maxMessages": 20,
        "maxTokens": 50000,
        "summarizeEvery": 30
      },
      "anthropic": {
        "enablePromptCaching": true,
        "cacheSystemPrompts": true
      },
      "reasoning": {
        "thinkingBudgetTokens": 2000
      }
    }
  }
}
```

See `openclaw-optimized.json` in this repo for full reference configuration.

### References

- **Cost optimization analysis:** Token usage pattern review (input tokens: 20.2M vs output: 79K = 254:1 ratio)
- **Anthropic Prompt Caching:** https://docs.anthropic.com/en/docs/build-a-bot/caching
- **OpenClaw Releases:** https://github.com/openclaw/openclaw/releases

## GitHub Secrets Setup

To enable the full deployment pipeline (health checks + buddy instance), configure these secrets in the repository settings:

| Secret | Description | Example |
|--------|-------------|---------|
| `RAILWAY_API_TOKEN` | Railway API token for service management | `eyJ...` |
| `RAILWAY_SERVICE_ID` | Primary service ID on Railway | `svc_xxxxx` |
| `RAILWAY_ENVIRONMENT_ID` | Railway environment ID | `env_xxxxx` |
| `RAILWAY_PRIMARY_URL` | Primary instance public URL | `https://openclaw-primary.up.railway.app` |
| `RAILWAY_BUDDY_SERVICE_ID` | Buddy service ID on Railway | `svc_yyyyy` |
| `RAILWAY_BUDDY_ENVIRONMENT_ID` | Buddy environment ID | `env_yyyyy` |

Without these secrets, workflows will be skipped. See Railway dashboard for IDs.

## Local smoke test

```bash
docker build -t openclaw-railway-template .

docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  openclaw-railway-template

# open http://localhost:8080/setup (password: test)
```
