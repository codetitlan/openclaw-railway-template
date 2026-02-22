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

# Pin to a known ref (tag/branch). If it doesn't exist, fall back to main.
ARG OPENCLAW_GIT_REF=main
RUN git clone --depth 1 --branch "${OPENCLAW_GIT_REF}" https://github.com/openclaw/openclaw.git .

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
    gh \
    jq \
    python3 \
    pkg-config \
    sudo \
    yamllint \
    shellcheck \
  && rm -rf /var/lib/apt/lists/*

# Install act (GitHub Actions local runner)
# Downloads prebuilt binary from GitHub releases
# Maps dpkg architecture names to act release names
RUN set -e && \
  ARCH=$(dpkg --print-architecture) && \
  case "$ARCH" in \
    amd64) ACT_ARCH="x86_64" ;; \
    arm64) ACT_ARCH="arm64" ;; \
    armhf) ACT_ARCH="armv7" ;; \
    armel) ACT_ARCH="armv6" ;; \
    i386) ACT_ARCH="i386" ;; \
    *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
  esac && \
  curl -fsSL -L https://github.com/nektos/act/releases/download/v0.2.84/act_Linux_${ACT_ARCH}.tar.gz \
  -o /tmp/act.tar.gz && \
  tar -xzf /tmp/act.tar.gz -C /usr/local/bin && \
  chmod +x /usr/local/bin/act && \
  rm /tmp/act.tar.gz && \
  act --version

# Install Himalaya (download prebuilt binary from GitHub releases)
RUN curl -fsSL https://github.com/pimalaya/himalaya/releases/download/v1.1.0/himalaya.x86_64-linux.tgz \
  | tar -xz -C /usr/local/bin && chmod +x /usr/local/bin/himalaya

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

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

COPY scripts ./scripts
COPY src ./src
COPY openclaw-optimized.json ./

# Build metadata (injected by CI)
ARG BUILD_DATE=unknown
ARG GIT_SHA=unknown
ENV BUILD_DATE=${BUILD_DATE}
ENV GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.created=${BUILD_DATE}
LABEL org.opencontainers.image.revision=${GIT_SHA}

ENV PORT=8080
ENV HEALTH_CHECK_PORT=8888
ENV HEALTH_CHECK_PATH=/health

EXPOSE 8080 8888

# OpenClaw optimization defaults (tuned for 120k context window)
ENV OPENCLAW_CONVERSATION_MAX_MESSAGES=20
ENV OPENCLAW_CONVERSATION_MAX_TOKENS=50000
ENV OPENCLAW_ENABLE_PROMPT_CACHING=true

# Docker HEALTHCHECK using the dedicated health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8888${HEALTH_CHECK_PATH:-/health} || exit 1

RUN chmod +x scripts/start.sh

CMD ["bash", "scripts/start.sh"]
