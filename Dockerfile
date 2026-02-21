# Build openclaw from source to avoid npm packaging gaps (some dist files are not shipped).
FROM node:22-bookworm AS openclaw-build

# Dependencies needed for openclaw build
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (openclaw build uses it)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /openclaw

# OpenClaw version control:
# - Set OPENCLAW_VERSION Railway variable to pin a specific tag/branch (e.g., v2026.2.15)
# - If not set, auto-detects the latest stable release via 3-tier cascade:
#     1. GitHub Releases API (/releases/latest) — excludes pre-releases and drafts
#     2. git ls-remote --sort=-v:refname — latest stable tag by version sort
#     3. main branch (final fallback, with warning — may be unstable)
# - Can also override locally with --build-arg OPENCLAW_VERSION=<tag>
ARG OPENCLAW_VERSION
RUN set -eu; \
  if [ -n "${OPENCLAW_VERSION:-}" ]; then \
    REF="${OPENCLAW_VERSION}"; \
    echo "✓ Using pinned OpenClaw ${REF}"; \
  else \
    echo "OPENCLAW_VERSION not set — auto-detecting latest stable release..."; \
    REF=$(curl -sf --max-time 10 \
      "https://api.github.com/repos/openclaw/openclaw/releases/latest" \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])" \
      2>/dev/null) || REF=""; \
    if [ -n "$REF" ]; then \
      echo "✓ GitHub API: latest stable release is ${REF}"; \
    else \
      echo "⚠ GitHub API unavailable — falling back to git ls-remote tag detection"; \
      REF=$(git ls-remote --tags --sort=-v:refname \
        https://github.com/openclaw/openclaw.git 'v*' \
        | grep -v '\^{}' \
        | grep -v -- '-' \
        | head -1 \
        | sed 's|.*refs/tags/||') || REF=""; \
      if [ -n "$REF" ]; then \
        echo "✓ git ls-remote: latest stable tag is ${REF}"; \
      else \
        echo "⚠ Tag detection also failed — falling back to main branch (unstable)"; \
        REF="main"; \
      fi; \
    fi; \
  fi; \
  git clone --depth 1 --branch "${REF}" https://github.com/openclaw/openclaw.git .

# Patch: relax version requirements for packages that may reference unpublished versions.
# Apply to all extension package.json files to handle workspace protocol (workspace:*).
RUN set -eux; \
  find ./extensions -name 'package.json' -type f | while read -r f; do \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*">=[^"]+"/"openclaw": "*"/g' "$f"; \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*"workspace:[^"]+"/"openclaw": "*"/g' "$f"; \
  done

RUN pnpm install --no-frozen-lockfile
RUN pnpm build
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:install && pnpm ui:build


# Runtime image
FROM node:22-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    gcc \
    g++ \
    make \
    procps \
    file \
    git \
    python3 \
    pkg-config \
    sudo \
  && rm -rf /var/lib/apt/lists/*

# Install Homebrew (must run as non-root user)
# Create a user for Homebrew installation, install it, then make it accessible to all users
RUN useradd -m -s /bin/bash linuxbrew \
  && echo 'linuxbrew ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER linuxbrew
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

USER root
RUN chown -R root:root /home/linuxbrew/.linuxbrew
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

WORKDIR /app

# Wrapper deps
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

# Copy built openclaw
COPY --from=openclaw-build /openclaw /openclaw

# Provide a openclaw executable
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /openclaw/dist/entry.js "$@"' > /usr/local/bin/openclaw \
  && chmod +x /usr/local/bin/openclaw

COPY src ./src

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
