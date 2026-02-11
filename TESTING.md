# Testing & Deployment Scripts

## Integration Tests

Run integration tests to verify all critical services are accessible:

```bash
./scripts/integration-tests.sh
```

**Tests:**
1. **Telegram Bot** - Verifies bot token is valid and Telegram API is reachable
2. **Claude API** - Verifies Anthropic API key and Claude model availability
3. **GitHub API** - Verifies GitHub token (optional) and API connectivity

**Exit codes:**
- `0` - All tests passed
- `1` - One or more tests failed

**Environment variables required:**
- `TELEGRAM_BOT_TOKEN` - Telegram bot token (required for Telegram test)
- `ANTHROPIC_API_KEY` - Anthropic API key (required for Claude test)
- `GITHUB_TOKEN` - GitHub personal access token (optional)

**Example output:**
```
========== INTEGRATION TESTS ==========

[1/3] Testing Telegram bot token...
✓ Telegram bot connected: railclaw

[2/3] Testing Anthropic/Claude API...
✓ Claude API responding correctly

[3/3] Testing GitHub API...
✓ GitHub authenticated as: bb-claw

========== TEST SUMMARY ==========
✓ Telegram
✓ Claude API
✓ GitHub API

All integration tests passed!
```

## Container Shutdown

Gracefully shut down the container with optional Railway service restart:

```bash
./scripts/shutdown-container.sh
```

**What it does:**
1. Sends SIGTERM to container (wrapper has 20s to gracefully shutdown)
2. Waits 25s for process termination
3. Forces SIGKILL if process still running
4. (Optional) Triggers Railway service redeploy if on Railway

**Environment variables:**
- `RAILWAY_SERVICE_ID` - Automatically set on Railway
- `RAILWAY_API_TOKEN` - Required for redeploy (set in Railway Variables)
- `RAILWAY_ENVIRONMENT_ID` - Required for redeploy

## Running Tests in CI/CD

Add to your GitHub Actions workflow:

```yaml
- name: Integration Tests
  run: ./scripts/integration-tests.sh
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Local Testing

Test Telegram connectivity:
```bash
curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

Test Claude API:
```bash
curl -X POST "https://api.anthropic.com/v1/messages" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -H "x-api-key: ${ANTHROPIC_API_KEY}" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "test"}]
  }'
```

Test GitHub API:
```bash
curl -H "Authorization: token ${GITHUB_TOKEN}" https://api.github.com/user
```
