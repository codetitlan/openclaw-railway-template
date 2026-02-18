# CI/CD Workflows

This directory contains workflow definitions for the OpenClaw Railway Template.
All heavy lifting is delegated to [bb-claw/ci-workflows](https://github.com/bb-claw/ci-workflows).

## Workflows

**`ci.yml`** — Continuous integration (all non-main branches + PRs to main)

Calls `node-ci.yml@v1` from ci-workflows. Runs lint and smoke tests on every
branch push. Also runs Docker build validation on pull requests to main.

**`cd.yml`** — Continuous deployment (push to `main` only)

Calls `full-pipeline.yml@v1` from ci-workflows. Orchestrates:
0. Validate pipeline configuration
1. Build Docker image and push to GHCR
2. Run smoke tests inside container
3. Deploy to dev, run smoke + integration tests
4. Deploy to prod, run smoke tests with auto-rollback

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
