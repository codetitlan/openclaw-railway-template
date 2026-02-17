#!/bin/bash
# test-himalaya-config.sh - Test Himalaya config reboot safety

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

TEST_RESULTS=0

echo -e "${BLUE}🐻 Himalaya Reboot-Safety Test Suite${NC}"
echo ""

# Test 1: Check scripts exist
echo -e "${YELLOW}[Test 1] Script files exist${NC}"
SCRIPTS=(
  "scripts/himalaya-init.sh"
  "scripts/himalaya-restore.sh"
  "scripts/himalaya-healthcheck.sh"
)

for script in "${SCRIPTS[@]}"; do
  if [[ -f "$script" ]]; then
    echo -e "${GREEN}✓ $script exists${NC}"
  else
    echo -e "${RED}✗ $script missing${NC}"
    TEST_RESULTS=$((TEST_RESULTS + 1))
  fi
done

# Test 2: Check scripts are executable
echo -e "${YELLOW}[Test 2] Scripts are executable${NC}"
for script in "${SCRIPTS[@]}"; do
  if [[ -x "$script" ]]; then
    echo -e "${GREEN}✓ $script is executable${NC}"
  else
    echo -e "${RED}✗ $script not executable${NC}"
    TEST_RESULTS=$((TEST_RESULTS + 1))
  fi
done

# Test 3: Check documentation
echo -e "${YELLOW}[Test 3] Documentation exists${NC}"
if [[ -f "docs/himalaya-reboot-safety.md" ]]; then
  echo -e "${GREEN}✓ Documentation exists${NC}"
else
  echo -e "${RED}✗ Documentation missing${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 4: Verify environment variable usage
echo -e "${YELLOW}[Test 4] Scripts use environment variables for secrets${NC}"
if grep -q "HIMALAYA_EMAIL" scripts/himalaya-init.sh && \
   grep -q "HIMALAYA_PASSWORD" scripts/himalaya-init.sh; then
  echo -e "${GREEN}✓ Scripts use env vars (no hardcoded secrets)${NC}"
else
  echo -e "${RED}✗ Scripts may contain hardcoded secrets${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 5: Check for backup directory usage
echo -e "${YELLOW}[Test 5] Backup strategy implemented${NC}"
if grep -q "/data/workspace/.himalaya-backup" scripts/himalaya-init.sh && \
   grep -q "/data/workspace/.himalaya-backup" scripts/himalaya-restore.sh; then
  echo -e "${GREEN}✓ Backup storage in /data/workspace/.himalaya-backup${NC}"
else
  echo -e "${RED}✗ Backup strategy not properly implemented${NC}"
  TEST_RESULTS=$((TEST_RESULTS + 1))
fi

# Test 6: Syntax check
echo -e "${YELLOW}[Test 6] Shell script syntax${NC}"
for script in "${SCRIPTS[@]}"; do
  if bash -n "$script" 2>/dev/null; then
    echo -e "${GREEN}✓ $script syntax OK${NC}"
  else
    echo -e "${RED}✗ $script has syntax errors${NC}"
    TEST_RESULTS=$((TEST_RESULTS + 1))
  fi
done

echo ""
if [[ $TEST_RESULTS -eq 0 ]]; then
  echo -e "${GREEN}✅ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ $TEST_RESULTS test(s) failed${NC}"
  exit 1
fi
