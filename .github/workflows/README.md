# CI/CD Workflows

This directory contains workflow definitions for the OpenClaw Railway Template.
All heavy lifting is delegated to [bb-claw/ci-workflows](https://github.com/bb-claw/ci-workflows).

## Workflows

**`ci.yml`** — Continuous integration (all non-main branches + PRs to main)

Calls `node-ci.yml@v2` from ci-workflows. Runs lint and custom smoke tests 
(via `scripts/smoke.sh`) on every branch push. Also runs Docker build validation 
on pull requests to main.

**`cd.yml`** — Continuous deployment (push to `main` only)

Calls `full-pipeline.yml@v2` from ci-workflows. Orchestrates:
0. Validate pipeline configuration
1. Build Docker image and push to GHCR
2. Run unit tests (lint) inside container
3. Deploy to dev, run smoke + integration tests
4. Manual approval before production
5. Deploy to prod, run smoke tests with auto-rollback

## Custom Smoke Tests

Feature branch CI runs `scripts/smoke.sh` to validate repository structure and 
basic functionality. This script:
- Checks for required files (package.json, Dockerfile, src/, scripts/)
- Runs `npm run smoke` if available (gracefully skips without binary)
- Generates summary for GitHub Actions

**To customize:**
Edit `scripts/smoke.sh` with your repository-specific smoke tests. The shared 
workflow's smoke-test composite action will automatically detect and run it.

## Variables Required

Set these in GitHub repo settings (Settings → Variables):

- `DEV_URL` — Primary instance URL (e.g., https://openclaw-builder-dev3.up.railway.app)
- `PROD_URL` — Buddy/prod instance URL (e.g., https://openclaw-buddy-dev3.up.railway.app)
- `RAILWAY_SERVICE_ID_DEV` — Primary Railway service ID
- `RAILWAY_SERVICE_ID_PROD` — Buddy Railway service ID

## Secrets Required

Set these in GitHub repo settings (Settings → Secrets):

- `RAILWAY_TOKEN_DEV` — Railway API token for primary instance
- `RAILWAY_TOKEN_PROD` — Railway API token for buddy instance
- `GITHUB_TOKEN` — Automatically available (used for GHCR auth)
Test run to trigger CD pipeline
# Updated Railway tokens
