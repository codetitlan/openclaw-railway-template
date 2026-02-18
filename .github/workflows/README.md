# CI/CD Workflows

This directory contains workflow definitions for the OpenClaw Railway Template.

## Main Pipeline

**`pipeline.yml`** — Shared CI/CD pipeline from [bb-claw/ci-workflows](https://github.com/bb-claw/ci-workflows)

Orchestrates the full build → test → deploy flow with **automatic validation**:

0. **Validate Pipeline** ← NEW (Job 0)
   - Checks all required variables set
   - Validates all required secrets configured
   - Verifies Dockerfile exists
   - Tests URL accessibility (best-effort)

1. Build Docker image and push to GHCR
2. Run unit tests inside container
3. Deploy to primary instance (dev)
4. Run smoke tests on primary
5. Run integration tests against primary
6. Deploy to buddy instance (prod)
7. Run smoke tests on buddy with auto-rollback

Triggered on:
- Push to main
- Pull requests
- Manual workflow dispatch

**Key Benefit:** Pipeline validation runs automatically as Job 0, catching configuration errors before expensive build/deploy steps. All projects using `full-pipeline.yml@v1` get this validation automatically — no code changes needed!

## Buddy Deployment

**`deploy-buddy.yml`** — Manual on-demand buddy instance deployment

Deploy the buddy instance independently without triggering the full pipeline.

Triggered on:
- Manual workflow dispatch

## Feature Branch Workflows

**`feature-branch-ci.yml`** — CI for feature branches
**`docker-build-feature.yml`** — Docker image build for feature branches

These are experimental/optional workflows for testing changes.

## Shared Workflows

All core workflows are defined in [bb-claw/ci-workflows](https://github.com/bb-claw/ci-workflows):
- `docker-build-push.yml` — Build and push Docker images
- `deploy-railway.yml` — Deploy to Railway
- `smoke-test.yml` — Run smoke tests with optional rollback
- `integration-test.yml` — Run integration tests
- `unit-test-container.yml` — Run unit tests in container

To improve or refine CI/CD tooling, submit changes to [bb-claw/ci-workflows](https://github.com/bb-claw/ci-workflows) instead of this repo.

## Variables Required

Set these in GitHub repo settings (Settings → Variables):

- `RAILWAY_PRIMARY_URL` — Primary instance URL (e.g., https://openclaw-builder-dev3.up.railway.app)
- `RAILWAY_BUDDY_URL` — Buddy instance URL (e.g., https://openclaw-buddy-dev3.up.railway.app)
- `RAILWAY_SERVICE_ID` — Primary Railway service ID
- `RAILWAY_BUDDY_SERVICE_ID` — Buddy Railway service ID

## Secrets Required

Set these in GitHub repo settings (Settings → Secrets):

- `RAILWAY_TOKEN_DEV` — Railway API token for primary instance
- `RAILWAY_TOKEN_PROD` — Railway API token for buddy instance
- `GITHUB_TOKEN` — Automatically available (used for GHCR auth)
