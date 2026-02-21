# OpenClaw Version Control

The template supports flexible OpenClaw version control via the `OPENCLAW_VERSION` build argument / environment variable.

## Default Behavior — Auto-Detection

When `OPENCLAW_VERSION` is **not set**, the Dockerfile automatically detects the latest stable release using a 3-tier cascade:

1. **GitHub Releases API** (`/releases/latest`) — queries `https://api.github.com/repos/openclaw/openclaw/releases/latest` with a 10-second timeout. This endpoint always returns the latest full release and automatically excludes pre-releases and drafts.
2. **`git ls-remote` tag detection** — if the API is unavailable (network issue, rate limit), falls back to `git ls-remote --tags --sort=-v:refname` which lists tags in descending version order and filters out pre-release tags (those containing a hyphen, e.g., `-beta.1`).
3. **`main` branch** — final fallback if both detection methods fail, with a warning in the build log that the build may be unstable.

This means a one-click Railway deployment will always use the latest stable release without any manual configuration.

## Manual Override — Pinning a Specific Version

To pin to a specific OpenClaw release, set `OPENCLAW_VERSION` to any valid Git tag or branch name.

### Railway Configuration

1. Go to your Railway service → Variables
2. Add a new variable:
   - Name: `OPENCLAW_VERSION`
   - Value: `v2026.2.15` (or any valid Git tag/branch)
3. Redeploy the service

Railway automatically passes environment variables as build args, so no additional configuration is needed.

## Use Cases

### Default — Latest Stable Release (Recommended for most users)
```
(Leave OPENCLAW_VERSION unset)
```
The build auto-detects and uses the latest stable release. Safe for production deployments.

### Pin to a Specific Stable Release
```
OPENCLAW_VERSION=v2026.2.15
```
Use this when you need reproducible builds or want to stay on a known-good version.

### Test a Specific Branch or Pre-release
```
OPENCLAW_VERSION=feature-branch-name
OPENCLAW_VERSION=v2026.2.19-beta.1
```
Useful for testing unreleased features. Note: pre-releases are explicitly excluded from auto-detection.

## Local Development

When building locally, override with:
```bash
docker build --build-arg OPENCLAW_VERSION=v2026.2.16 .
```

Or leave unset to exercise the same auto-detection path as Railway:
```bash
docker build -t openclaw-railway-template .
```

## Finding Available Versions

List all stable OpenClaw release tags (no pre-releases):
```bash
git ls-remote --tags --sort=-v:refname https://github.com/openclaw/openclaw.git 'v*' \
  | grep -v '\^{}' \
  | grep -v -- '-' \
  | sed 's|.*refs/tags/||'
```

Or via the GitHub Releases API (same source as Tier 1 detection):
```bash
curl -s "https://api.github.com/repos/openclaw/openclaw/releases/latest" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tag_name'])"
```
