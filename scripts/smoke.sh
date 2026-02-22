#!/bin/bash
# Smoke tests for openclaw-railway-template
# Tests basic repository structure and deployment readiness

set -e

echo "🧪 Running openclaw-railway-template smoke tests..."
echo ""

# Exit codes
EXIT_CODE=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Run tests in a subshell to avoid set -e issues
(
  echo "## Smoke Test Results"
  echo ""
  echo "| Category | Check | Status |"
  echo "|----------|-------|--------|"

  # Required: Core files
  if [[ -f package.json ]]; then
    echo "| **Structure** | package.json | ✅ |"
  else
    echo "| **Structure** | package.json | ❌ Missing |"
    exit 1
  fi

  if [[ -d src ]]; then
    echo "| | src/ directory | ✅ |"
  else
    echo "| | src/ directory | ⚠️ (optional) |"
  fi
  
  if [[ -f Dockerfile ]]; then
    echo "| | Dockerfile | ✅ |"
  else
    echo "| | Dockerfile | ❌ Missing |"
    exit 1
  fi

  if [[ -d scripts ]]; then
    echo "| | scripts/ directory | ✅ |"
  else
    echo "| | scripts/ directory | ⚠️ (optional) |"
  fi

  # Deployment-critical
  if [[ -d .github/workflows ]]; then
    echo "| **Deployment** | .github/workflows/ | ✅ |"
  else
    echo "| **Deployment** | .github/workflows/ | ❌ Missing |"
    exit 1
  fi

  if [[ -f .github/workflows/ci.yml ]]; then
    echo "| | GitHub Actions configured | ✅ |"
  else
    echo "| | GitHub Actions configured | ❌ Missing |"
    exit 1
  fi

  if [[ -f .github/workflows/cd.yml ]]; then
    echo "| | CD pipeline configured | ✅ |"
  else
    echo "| | CD pipeline configured | ❌ Missing |"
    exit 1
  fi

  # Runtime tests
  if [[ -f scripts/smoke.js ]]; then
    echo "| **Runtime** | scripts/smoke.js | ✅ |"
  else
    echo "| **Runtime** | scripts/smoke.js | ⚠️ (optional) |"
  fi

  # Check for package manager
  if command -v npm &>/dev/null || command -v pnpm &>/dev/null || command -v yarn &>/dev/null; then
    echo "| | npm/pnpm/yarn | ✅ |"
  else
    echo "| | npm/pnpm/yarn | ⚠️ (optional) |"
  fi

  echo ""
  echo "| **Summary** | All critical checks | ✅ Passed |"

) | tee -a "$GITHUB_STEP_SUMMARY"

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}✓ Smoke tests passed${NC}"
  exit 0
else
  echo -e "${RED}✗ Smoke tests failed${NC}"
  exit 1
fi
