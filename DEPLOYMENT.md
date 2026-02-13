# Deployment Guide

This document explains how the automated deployment pipeline works and how to monitor it.

## Pipeline Overview

The deployment pipeline consists of three main workflows:

### 1. Docker Build (`docker-build.yml`)
- **Trigger**: Push to any branch
- **Actions**:
  - Builds Docker image
  - Pushes to GHCR (GitHub Container Registry)
  - On `main` push: Redeploys primary instance to Railway

### 2. Health Check & Buddy (`health-check-and-buddy.yml`)
- **Trigger**: Docker build completes on main
- **Actions**:
  - **health-check job**: Waits 60s, then verifies `/setup/healthz` responds
  - **trigger-buddy job**: If health-check passes, triggers buddy deployment

### 3. Deploy Buddy (`deploy-buddy.yml`)
- **Trigger**: Manual dispatch or triggered by health-check-and-buddy.yml
- **Actions**:
  - Redeploys buddy service
  - Runs for configured duration (default: 2 hours)
  - Automatically scales down after duration

## Monitoring Deployments

### View Workflow Runs
1. Go to repository **Actions** tab
2. Select workflow: `Docker build`, `Health Check & Buddy`, or `Deploy Buddy`
3. Click run to see detailed logs

### Health Check Verification
The health-check job logs show:
```
🔍 Checking health endpoint: https://your-instance.up.railway.app/setup/healthz
⏳ Attempt 1/60 - instance not ready yet...
⏳ Attempt 2/60 - instance not ready yet...
✅ Primary instance is healthy (attempt 3/60)
```

If health check fails after 10 minutes, check:
- Primary instance is running on Railway
- `/setup/healthz` endpoint is accessible
- `RAILWAY_PRIMARY_URL` secret is correct

### Buddy Deployment Status
The trigger-buddy job logs show:
```
🤝 Triggering buddy instance deployment workflow...
✅ Buddy deployment workflow triggered
```

Check `Deploy Buddy` workflow for actual buddy instance logs.

## Cost Optimization

### Primary Instance
- Runs 24/7 on Railway
- Cost: ~$7-8/day
- Handles all traffic by default

### Buddy Instance
- Triggered automatically after each deployment on main
- Runs for 2 hours (configurable)
- Cost: ~$0.50-1/day per deployment
- **Total**: ~$8-9/day vs $14-16 for always-on dual setup

## Environment Setup

### Required GitHub Secrets
Configure these in repository Settings → Secrets:

```
RAILWAY_API_TOKEN              # Railway API token
RAILWAY_SERVICE_ID             # Primary service ID
RAILWAY_ENVIRONMENT_ID         # Primary environment ID
RAILWAY_PRIMARY_URL            # Primary instance URL (e.g., https://app.up.railway.app)
RAILWAY_BUDDY_SERVICE_ID       # Buddy service ID
RAILWAY_BUDDY_ENVIRONMENT_ID   # Buddy environment ID
```

### Finding Railway IDs

1. Go to [Railway Dashboard](https://railway.app)
2. Select your project
3. Go to **Settings** → **Tokens** for API token
4. For service/environment IDs:
   - Click service in left panel
   - URL will show: `/project/{PROJECT_ID}/service/{SERVICE_ID}?...`
   - Check environment in dropdown for ID

### Getting Primary URL

1. Go to primary service on Railway
2. Go to **Deployments** tab
3. Copy the public URL (e.g., `https://openclaw-primary.up.railway.app`)

## Troubleshooting

### Docker Build Fails
- Check Dockerfile syntax
- Verify all build arguments are valid
- Check Node dependencies in `package.json`

### Primary Redeploy Fails
- Verify `RAILWAY_API_TOKEN` is valid
- Check `RAILWAY_SERVICE_ID` and `RAILWAY_ENVIRONMENT_ID`
- Ensure service exists on Railway

### Health Check Fails
- Verify `RAILWAY_PRIMARY_URL` is correct and accessible
- Check if primary instance is running
- Ensure `/setup/healthz` endpoint is available
- Check firewall/network rules

### Buddy Deployment Doesn't Trigger
- Verify health-check job passed
- Check `RAILWAY_BUDDY_SERVICE_ID` and `RAILWAY_BUDDY_ENVIRONMENT_ID`
- Verify GitHub token has workflows permission
- Check Deploy Buddy workflow has required secrets

## Manual Deployment

### Redeploy Primary
1. Go to GitHub **Actions** → **Docker build**
2. Click **Run workflow** → `main` branch → **Run workflow**

### Run Buddy Manually
1. Go to GitHub **Actions** → **Deploy Buddy**
2. Click **Run workflow**
3. Set duration (hours) if needed
4. Click **Run workflow**

## Performance Metrics

Monitor these to optimize the pipeline:

- **Docker build time**: Target < 5 minutes
- **Primary redeploy time**: Target < 2 minutes
- **Health check time**: Usually < 2 minutes (after 60s wait)
- **Buddy startup time**: Typically < 3 minutes
- **Total pipeline**: End-to-end ~10-15 minutes

## Best Practices

1. **Only push meaningful changes to main**
   - Each push triggers full pipeline
   - Each pipeline run incurs costs

2. **Monitor health check logs**
   - Understand deployment health
   - Catch issues early

3. **Review buddy deployment logs**
   - Verify buddy is running correctly
   - Check for resource issues

4. **Use feature branches for testing**
   - Docker build still runs
   - Redeploy and health-check skipped
   - Low cost testing

5. **Keep secrets updated**
   - Rotate Railway tokens periodically
   - Update URLs if instance domains change
