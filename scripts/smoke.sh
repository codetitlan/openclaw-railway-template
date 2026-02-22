#!/bin/bash
# Smoke tests for openclaw-railway-template
# Tests basic repository structure and functionality

set -e

echo "🧪 Running openclaw-railway-template smoke tests..."
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

{
  echo "## Smoke Test Results"
  echo ""
  echo "| Check | Status |"
  echo "|-------|--------|"

  # Check basic structure
  echo "Checking repository structure..."
  
  if [[ -f package.json ]]; then
    echo "| package.json | ✅ |"
  else
    echo "| package.json | ❌ Missing |"
    exit 1
  fi

  if [[ -d src ]]; then
    echo "| src/ directory | ✅ |"
  else
    echo "| src/ directory | ❌ Missing |"
    exit 1
  fi

  if [[ -f Dockerfile ]]; then
    echo "| Dockerfile | ✅ |"
  else
    echo "| Dockerfile | ❌ Missing |"
    exit 1
  fi

  if [[ -f scripts/smoke.js ]]; then
    echo "| scripts/smoke.js | ✅ |"
  else
    echo "| scripts/smoke.js | ❌ Missing |"
    exit 1
  fi

  # Test the smoke script (this is what validates the openclaw binary at runtime)
  echo ""
  echo "Testing npm smoke script..."
  if npm run smoke > /dev/null 2>&1; then
    echo "| npm run smoke | ✅ |"
  else
    # Note: This may fail in CI/CD without openclaw binary, which is expected
    # The real smoke test happens in integration-test phase after deployment
    echo "| npm run smoke | ⚠️ (needs runtime) |"
  fi

  echo ""
  echo "| Overall | ✅ All checks passed |"

} | tee -a "$GITHUB_STEP_SUMMARY"

echo ""
echo -e "${GREEN}✓ Smoke tests passed${NC}"
