# Verification & Fix Checklist - 2026-02-22

## Branch: feature/verify-and-fix-issues

Ready to investigate and fix certain issues on this branch.

## Potential Areas to Verify

- [ ] **Deployment Verification**
  - Health check endpoint responding correctly
  - Version endpoint showing correct git_sha
  - Service actually deploying new code

- [ ] **GitHub Variables**
  - Check for trailing spaces in DEV_URL, PROD_URL
  - Verify all RAILWAY_* variables are correct
  - Check environment-specific variables

- [ ] **Integration Tests**
  - Telegram connectivity
  - Claude API connectivity
  - GitHub API connectivity

- [ ] **Service Health**
  - Primary instance (openclaw-builder-dev3) operational
  - Buddy instance (openclaw-buddy-dev3) operational
  - Health check endpoints responding

- [ ] **Other Issues**
  - TBD based on investigation

## How to Use PIPELINE_DEBUG

When you encounter a `"TOKEN INVALID"` or `"Unauthorized"` error:

1. **Set GitHub Variable**:
   - Go to Settings → Variables → New variable
   - Name: `PIPELINE_DEBUG`
   - Value: `1`

2. **Trigger Pipeline**:
   - Push a dummy commit to main
   - Go to Actions tab
   - Click on the CD pipeline run

3. **Check Logs**:
   - Find the "Deploy → Railway (dev)" job
   - Look for section: "🐛 DEBUG MODE ENABLED"
   - See full environment variables and token details

4. **Diagnose**:
   - **Token length**: Should be 80+ characters
   - **Token prefix**: Should look like `eyJhbGc...` (JWT format)
   - **Token suffix**: Last 10 characters
   - **Error details**: Full error message from Railway

5. **Regenerate if Needed**:
   - If token is invalid/expired, regenerate in Railway dashboard
   - Update `RAILWAY_TOKEN_DEV` in GitHub Secrets
   - Disable PIPELINE_DEBUG
   - Push again to trigger pipeline

## Status

🔄 **In Progress**: Debug feature PR #13 pending merge

## Enhancements Added

### Token Validation & Diagnostics (ci-workflows PR #12) ✅ MERGED
- ✅ **Validate token** with `railway whoami`
- ✅ **List services** with `railway service list --json`
- ✅ **Verify service access** - Check if target service exists
- ✅ **Enhanced error messages**:
  - Detect expired/invalid tokens
  - Detect service not found issues
  - Provide actionable suggestions
  - List available services when target not found

### Environment Variable Debugging (ci-workflows PR #13) 🔄 PENDING
- ✅ **PIPELINE_DEBUG variable support**
- ✅ Shows full environment when `PIPELINE_DEBUG=1`:
  - RAILWAY_TOKEN details (first 20 + last 10 chars)
  - Service/Project/Environment IDs
  - Railway CLI version
- ✅ **Token inspection on error**:
  - Token length
  - Token prefix (first 10 chars)
  - Token suffix (last 10 chars)
  - Detects truncation/format issues
- ✅ **Usage instructions in error messages**

### Deployment Diagnostics
When RAILWAY_TOKEN is invalid:
1. **Without PIPELINE_DEBUG**: Clear error message with action items
2. **With PIPELINE_DEBUG=1**:
   - See exact token format and length
   - See all environment variables
   - Diagnose if token is truncated
   - Compare with working token details

## Notes

- v5.2 deployed with correct railway redeploy syntax
- Investigation guide created: DEPLOY_FAILURE_INVESTIGATION.md
- Token validation PR #12 ready in ci-workflows
- Will update to new version once PR #12 merged
