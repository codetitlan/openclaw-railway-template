# Integration Tests

Verify connectivity to external services (Telegram, Claude API, GitHub API).

## Usage

```bash
# Run all integration tests
./scripts/integration-tests.sh

# Output example:
# ========== INTEGRATION TESTS ==========
# [1/3] Testing Telegram bot token...
# ✓ Telegram bot connected: railclaw
# [2/3] Testing Anthropic/Claude API...
# ✓ Claude API responding correctly
# [3/3] Testing GitHub API...
# ✓ GitHub authenticated as: bb-claw
# 
# ========== TEST SUMMARY ==========
# ✓ Telegram
# ✓ Claude API
# ✓ GitHub API
# 
# All integration tests passed!
```

## What Gets Tested

### 1. Telegram Bot Token
- **Env var**: `TELEGRAM_BOT_TOKEN`
- **Test**: Calls `getMe` API endpoint
- **Success**: Bot name returned
- **Failure**: Invalid token or API unreachable

### 2. Claude API
- **Env var**: `ANTHROPIC_API_KEY`
- **Test**: Sends test message to Claude API
- **Success**: API responds with content or expected error
- **Failure**: Invalid key or API unreachable

### 3. GitHub API
- **Env var**: `GITHUB_TOKEN` (optional)
- **Test**: Authenticates and fetches user info
- **Success**: GitHub username returned
- **Failure**: Invalid token or API unreachable
- **Note**: Test is skipped if token not set

## Exit Codes

- **0**: All tests passed
- **1**: One or more tests failed

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Run integration tests
  run: |
    ./scripts/integration-tests.sh
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Railway Deployment

Can be run in Railway post-deploy hooks to verify all services are accessible:

```bash
# In railway.toml or deployment config
postDeploy = "./scripts/integration-tests.sh"
```

## Troubleshooting

**"Telegram bot token invalid"**
- Check `TELEGRAM_BOT_TOKEN` is set correctly
- Verify token hasn't expired
- Test manually: `curl https://api.telegram.org/bot<TOKEN>/getMe`

**"Claude API unreachable"**
- Check `ANTHROPIC_API_KEY` is set
- Verify API key is valid (not a setup-token)
- Check outbound HTTPS connectivity
- Verify rate limits haven't been hit

**"GitHub authentication failed"**
- Check `GITHUB_TOKEN` is set (if you want to test)
- Verify token has appropriate scopes
- Check token hasn't expired
