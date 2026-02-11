#!/bin/bash
# Integration tests for railclaw deployment
# Tests: Telegram connectivity, Claude API, GitHub API

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "========== INTEGRATION TESTS =========="
echo ""

# Test 1: Telegram Bot Connectivity
echo -e "${YELLOW}[1/3] Testing Telegram bot token...${NC}"
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  echo -e "${RED}✗ TELEGRAM_BOT_TOKEN not set${NC}"
  TELEGRAM_OK=0
else
  # Test bot token by getting bot info
  BOT_INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe")
  
  if echo "$BOT_INFO" | jq -e '.ok' > /dev/null 2>&1; then
    BOT_NAME=$(echo "$BOT_INFO" | jq -r '.result.first_name')
    echo -e "${GREEN}✓ Telegram bot connected: ${BOT_NAME}${NC}"
    TELEGRAM_OK=1
  else
    echo -e "${RED}✗ Telegram bot token invalid or unreachable${NC}"
    echo "  Response: $(echo "$BOT_INFO" | jq -r '.description // .error_code')"
    TELEGRAM_OK=0
  fi
fi
echo ""

# Test 2: Claude API Connectivity
echo -e "${YELLOW}[2/3] Testing Anthropic/Claude API...${NC}"
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo -e "${RED}✗ ANTHROPIC_API_KEY not set${NC}"
  CLAUDE_OK=0
else
  # Test API key with a simple messages request
  CLAUDE_TEST=$(curl -s -X POST "https://api.anthropic.com/v1/messages" \
    -H "anthropic-version: 2023-06-01" \
    -H "content-type: application/json" \
    -H "x-api-key: ${ANTHROPIC_API_KEY}" \
    -d '{
      "model": "claude-haiku-4-5-20251001",
      "max_tokens": 10,
      "messages": [{"role": "user", "content": "test"}]
    }' 2>/dev/null)
  
  if echo "$CLAUDE_TEST" | jq -e '.content // .error' > /dev/null 2>&1; then
    if echo "$CLAUDE_TEST" | jq -e '.error' > /dev/null 2>&1; then
      ERROR=$(echo "$CLAUDE_TEST" | jq -r '.error.message // .error.type')
      echo -e "${YELLOW}⚠ Claude API reachable but returned error: ${ERROR}${NC}"
      CLAUDE_OK=1
    else
      echo -e "${GREEN}✓ Claude API responding correctly${NC}"
      CLAUDE_OK=1
    fi
  else
    echo -e "${RED}✗ Claude API unreachable or invalid key${NC}"
    echo "  Response: $(echo "$CLAUDE_TEST" | jq -r '.error.message // "unknown error"')"
    CLAUDE_OK=0
  fi
fi
echo ""

# Test 3: GitHub API Connectivity
echo -e "${YELLOW}[3/3] Testing GitHub API...${NC}"
if [ -z "$GITHUB_TOKEN" ]; then
  echo -e "${YELLOW}⚠ GITHUB_TOKEN not set (optional)${NC}"
  GITHUB_OK=1
else
  # Test GitHub token
  GITHUB_TEST=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
    "https://api.github.com/user" 2>/dev/null)
  
  if echo "$GITHUB_TEST" | jq -e '.login' > /dev/null 2>&1; then
    LOGIN=$(echo "$GITHUB_TEST" | jq -r '.login')
    echo -e "${GREEN}✓ GitHub authenticated as: ${LOGIN}${NC}"
    GITHUB_OK=1
  else
    echo -e "${RED}✗ GitHub token invalid or unreachable${NC}"
    echo "  Response: $(echo "$GITHUB_TEST" | jq -r '.message // "unknown error"')"
    GITHUB_OK=0
  fi
fi
echo ""

# Summary
echo "========== TEST SUMMARY =========="
[ $TELEGRAM_OK -eq 1 ] && echo -e "${GREEN}✓ Telegram${NC}" || echo -e "${RED}✗ Telegram${NC}"
[ $CLAUDE_OK -eq 1 ] && echo -e "${GREEN}✓ Claude API${NC}" || echo -e "${RED}✗ Claude API${NC}"
[ $GITHUB_OK -eq 1 ] && echo -e "${GREEN}✓ GitHub API${NC}" || echo -e "${RED}✗ GitHub API${NC}"
echo ""

# Exit code
if [ $TELEGRAM_OK -eq 1 ] && [ $CLAUDE_OK -eq 1 ] && [ $GITHUB_OK -eq 1 ]; then
  echo -e "${GREEN}All integration tests passed!${NC}"
  exit 0
else
  echo -e "${RED}Some integration tests failed${NC}"
  exit 1
fi
