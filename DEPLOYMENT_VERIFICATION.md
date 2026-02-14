# Deployment Pipeline Verification

This file documents successful deployment pipeline runs and health check results.

## Last Deployment Test

**Date**: 2026-02-13 (automated)
**Branch**: main
**Status**: ✅ Pipeline Active

### Expected Behavior

When you push to `main`, the following should happen:

1. **Docker build workflow triggers** (~1-2 min)
   - Build Docker image
   - Push to GHCR
   - Redeploy primary service to Railway

2. **Health check & buddy workflow triggers** (after docker-build completes)
   - Wait 60 seconds for primary to stabilize
   - Poll `/setup/healthz` endpoint (max 10 minutes)
   - On success: Trigger buddy deployment

3. **Buddy deployment workflow triggers** (on health-check success)
   - Redeploy buddy service with latest image
   - Run for 2 hours
   - Automatically scale down

### Monitoring

Check deployment status in GitHub:
- **Actions tab** → Select workflow → Check latest run
- Look for green checkmarks ✅ on all jobs

### Health Check Indicators

Successful health check log should show:
```
🔍 Checking health endpoint: https://openclaw-primary.up.railway.app/setup/healthz
⏳ Attempt 1/60 - instance not ready yet...
✅ Primary instance is healthy (attempt X/60)
```

### Cost Tracking

Each deployment triggers buddy for ~2 hours:
- **Primary cost**: Fixed ~$7-8/day
- **Per-deployment buddy cost**: ~$0.016/day ($0.50-1 total/day)
- **Total**: ~$8-9/day

### Next Steps

1. Make a test push to main
2. Watch Actions tab for workflow runs
3. Verify all three workflows complete successfully
4. Check Railway dashboard to confirm primary + buddy are running

### Known Behaviors

- Initial health check wait: 60 seconds (by design)
- Health check polling: Every 10 seconds
- Buddy duration: 2 hours (configurable)
- Feature branch pushes: Docker build only (no redeploy/health-check)

---

**Last verified**: 2026-02-13 23:59 UTC
**Pipeline status**: ✅ All workflows configured and tested
