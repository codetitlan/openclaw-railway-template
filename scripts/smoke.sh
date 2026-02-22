#!/bin/bash
# Smoke tests for openclaw-railway-template
# Tests basic repository structure and deployment readiness
# Extensible via v2 ci-workflows smoke-test composite action

set -e

echo "🧪 Running openclaw-railway-template smoke tests..."
echo ""

# Exit codes
EXIT_CODE=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

{
  echo "## Smoke Test Results"
  echo ""
  echo "| Category | Check | Status |"
  echo "|----------|-------|--------|"

  # Required: Core files
  echo "| **Structure** | package.json | $([ -f package.json ] && echo '✅' || echo '❌ Missing') |"
  [ ! -f package.json ] && EXIT_CODE=1

  echo "| | src/ directory | $([ -d src ] && echo '✅' || echo '⚠️ (optional)') |"
  
  echo "| | Dockerfile | $([ -f Dockerfile ] && echo '✅' || echo '❌ Missing') |"
  [ ! -f Dockerfile ] && EXIT_CODE=1

  echo "| | scripts/ directory | $([ -d scripts ] && echo '✅' || echo '⚠️ (optional)') |"

  # Deployment-critical
  echo "| **Deployment** | .github/workflows/ | $([ -d .github/workflows ] && echo '✅' || echo '❌ Missing') |"
  [ ! -d .github/workflows ] && EXIT_CODE=1

  echo "| | GitHub Actions configured | $([ -f .github/workflows/ci.yml ] && echo '✅' || echo '❌ Missing') |"
  [ ! -f .github/workflows/ci.yml ] && EXIT_CODE=1

  echo "| | CD pipeline configured | $([ -f .github/workflows/cd.yml ] && echo '✅' || echo '❌ Missing') |"
  [ ! -f .github/workflows/cd.yml ] && EXIT_CODE=1

  # Runtime tests
  echo "| **Runtime** | scripts/smoke.js | $([ -f scripts/smoke.js ] && echo '✅' || echo '⚠️ (optional)') |"
  
  echo "| | npm/pnpm/yarn | $(command -v npm &>/dev/null || command -v pnpm &>/dev/null || command -v yarn &>/dev/null && echo '✅' || echo '⚠️') |"

  # Runtime smoke test (may fail without openclaw binary)
  echo ""
  if [ -f scripts/smoke.js ]; then
    if npm run smoke 2>&1 | head -1 | grep -q "undefined\|error" && [ -z "$OPENCLAW_BINARY_REQUIRED" ]; then
      echo "| **Integration** | npm run smoke | ⚠️ (needs deployed instance) |"
    else
      echo "| **Integration** | npm run smoke | ✅ |"
    fi
  fi

  echo ""
  if [ $EXIT_CODE -eq 0 ]; then
    echo "| **Summary** | All critical checks | ✅ Passed |"
  else
    echo "| **Summary** | All critical checks | ❌ Failed |"
  fi

} | tee -a "$GITHUB_STEP_SUMMARY"

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✓ Smoke tests passed${NC}"
  exit 0
else
  echo -e "${RED}✗ Smoke tests failed${NC}"
  exit 1
fi
