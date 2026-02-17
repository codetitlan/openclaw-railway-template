import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import * as tar from "tar";

// ========== ENVIRONMENT VARIABLE MIGRATION ==========
// Auto-migrate legacy CLAWDBOT_* and MOLTBOT_* env vars to OPENCLAW_* for backward compatibility.
// This ensures existing Railway deployments continue working after the rename.
const ENV_MIGRATIONS = [
  { old: "CLAWDBOT_PUBLIC_PORT", new: "OPENCLAW_PUBLIC_PORT" },
  { old: "MOLTBOT_PUBLIC_PORT", new: "OPENCLAW_PUBLIC_PORT" },
  { old: "CLAWDBOT_STATE_DIR", new: "OPENCLAW_STATE_DIR" },
  { old: "MOLTBOT_STATE_DIR", new: "OPENCLAW_STATE_DIR" },
  { old: "CLAWDBOT_WORKSPACE_DIR", new: "OPENCLAW_WORKSPACE_DIR" },
  { old: "MOLTBOT_WORKSPACE_DIR", new: "OPENCLAW_WORKSPACE_DIR" },
  { old: "CLAWDBOT_GATEWAY_TOKEN", new: "OPENCLAW_GATEWAY_TOKEN" },
  { old: "MOLTBOT_GATEWAY_TOKEN", new: "OPENCLAW_GATEWAY_TOKEN" },
  { old: "CLAWDBOT_CONFIG_PATH", new: "OPENCLAW_CONFIG_PATH" },
  { old: "MOLTBOT_CONFIG_PATH", new: "OPENCLAW_CONFIG_PATH" },
];

for (const { old, new: newVar } of ENV_MIGRATIONS) {
  if (process.env[old] && !process.env[newVar]) {
    console.warn(`[env-migration] Detected legacy ${old}, auto-migrating to ${newVar}`);
    process.env[newVar] = process.env[old];
  }
}

// Railway commonly sets PORT=8080 for HTTP services.
// Prefer OPENCLAW_PUBLIC_PORT (explicit user config) over Railway's default PORT.
const PORT = Number.parseInt(
  process.env.OPENCLAW_PUBLIC_PORT?.trim() || process.env.PORT || "8080",
  10,
);
const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".openclaw");
const WORKSPACE_DIR =
  process.env.OPENCLAW_WORKSPACE_DIR?.trim() ||
  path.join(STATE_DIR, "workspace");

// Protect /setup with a user-provided password.
const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Debug logging helper
const DEBUG = process.env.OPENCLAW_TEMPLATE_DEBUG?.toLowerCase() === "true";
function debug(...args) {
  if (DEBUG) console.log(...args);
}

// Gateway admin token (protects Openclaw gateway + Control UI).
// Must be stable across restarts. If not provided via env, persist it in the state dir.
function resolveGatewayToken() {
  console.log(`[token] ========== SERVER STARTUP TOKEN RESOLUTION ==========`);
  const envTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  console.log(`[token] ENV OPENCLAW_GATEWAY_TOKEN exists: ${!!process.env.OPENCLAW_GATEWAY_TOKEN}`);
  console.log(`[token] ENV value length: ${process.env.OPENCLAW_GATEWAY_TOKEN?.length || 0}`);
  console.log(`[token] After trim length: ${envTok?.length || 0}`);

  if (envTok) {
    console.log(`[token] ✓ Using token from OPENCLAW_GATEWAY_TOKEN env variable`);
    debug(`[token]   First 16 chars: ${envTok.slice(0, 16)}...`);
    debug(`[token]   Full token: ${envTok}`);
    return envTok;
  }

  console.log(`[token] Env variable not available, checking persisted file...`);
  const tokenPath = path.join(STATE_DIR, "gateway.token");
  console.log(`[token] Token file path: ${tokenPath}`);

  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) {
      console.log(`[token] ✓ Using token from persisted file`);
      debug(`[token]   First 8 chars: ${existing.slice(0, 8)}...`);
      return existing;
    }
  } catch (err) {
    console.log(`[token] Could not read persisted file: ${err.message}`);
  }

  const generated = crypto.randomBytes(32).toString("hex");
  console.log(`[token] ⚠️  Generating new random token`);
  debug(`[token]   First 8 chars: ${generated.slice(0, 8)}...`);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
    console.log(`[token] Persisted new token to ${tokenPath}`);
  } catch (err) {
    console.warn(`[token] Could not persist token: ${err}`);
  }
  return generated;
}

const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;
debug(`[token] Final resolved token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
console.log(`[token] ========== TOKEN RESOLUTION COMPLETE ==========\n`);

// Where the gateway will listen internally (we proxy to it).
const INTERNAL_GATEWAY_PORT = Number.parseInt(
  process.env.INTERNAL_GATEWAY_PORT ?? "18789",
  10,
);
const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Always run the built-from-source CLI entry directly to avoid PATH/global-install mismatches.
const OPENCLAW_ENTRY =
  process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

function clawArgs(args) {
  return [OPENCLAW_ENTRY, ...args];
}

// ========== AUTH PROVIDER GROUPS ==========
// Hardcoded auth provider groups for setup wizard (avoids CLI dependency for UI rendering).
// This matches Openclaw's auth-choice grouping logic for consistency.
const AUTH_GROUPS = [
  {
    value: "openai",
    label: "OpenAI",
    hint: "Codex OAuth + API key",
    options: [
      { value: "codex-cli", label: "OpenAI Codex OAuth (Codex CLI)" },
      { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
      { value: "openai-api-key", label: "OpenAI API key" },
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "Claude Code CLI + API key",
    options: [
      { value: "claude-cli", label: "Anthropic token (Claude Code CLI)" },
      { value: "token", label: "Anthropic token (paste setup-token)" },
      { value: "apiKey", label: "Anthropic API key" },
    ],
  },
  {
    value: "google",
    label: "Google",
    hint: "Gemini API key + OAuth",
    options: [
      { value: "gemini-api-key", label: "Google Gemini API key" },
      { value: "google-antigravity", label: "Google Antigravity OAuth" },
      { value: "google-gemini-cli", label: "Google Gemini CLI OAuth" },
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "API key",
    options: [{ value: "openrouter-api-key", label: "OpenRouter API key" }],
  },
  {
    value: "ai-gateway",
    label: "Vercel AI Gateway",
    hint: "API key",
    options: [
      { value: "ai-gateway-api-key", label: "Vercel AI Gateway API key" },
    ],
  },
  {
    value: "moonshot",
    label: "Moonshot AI",
    hint: "Kimi K2 + Kimi Code",
    options: [
      { value: "moonshot-api-key", label: "Moonshot AI API key" },
      { value: "kimi-code-api-key", label: "Kimi Code API key" },
    ],
  },
  {
    value: "zai",
    label: "Z.AI (GLM 4.7)",
    hint: "API key",
    options: [{ value: "zai-api-key", label: "Z.AI (GLM 4.7) API key" }],
  },
  {
    value: "minimax",
    label: "MiniMax",
    hint: "M2.1 (recommended)",
    options: [
      { value: "minimax-api", label: "MiniMax M2.1" },
      { value: "minimax-api-lightning", label: "MiniMax M2.1 Lightning" },
    ],
  },
  {
    value: "qwen",
    label: "Qwen",
    hint: "OAuth",
    options: [{ value: "qwen-portal", label: "Qwen OAuth" }],
  },
  {
    value: "copilot",
    label: "Copilot",
    hint: "GitHub + local proxy",
    options: [
      {
        value: "github-copilot",
        label: "GitHub Copilot (GitHub device login)",
      },
      { value: "copilot-proxy", label: "Copilot Proxy (local)" },
    ],
  },
  {
    value: "synthetic",
    label: "Synthetic",
    hint: "Anthropic-compatible (multi-model)",
    options: [{ value: "synthetic-api-key", label: "Synthetic API key" }],
  },
  {
    value: "opencode-zen",
    label: "OpenCode Zen",
    hint: "API key",
    options: [
      { value: "opencode-zen", label: "OpenCode Zen (multi-model proxy)" },
    ],
  },
];

// Returns all candidate config paths in priority order.
// Supports explicit override + legacy config file migration.
function resolveConfigCandidates() {
  const candidates = [];
  
  // 1. Explicit override (highest priority)
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) {
    candidates.push(explicit);
  }
  
  // 2. Current openclaw.json
  candidates.push(path.join(STATE_DIR, "openclaw.json"));
  
  // 3. Legacy config files (for auto-migration)
  candidates.push(path.join(STATE_DIR, "moltbot.json"));
  candidates.push(path.join(STATE_DIR, "clawdbot.json"));
  
  return candidates;
}

// Returns the active config path (prefers explicit override, falls back to default location).
function configPath() {
  const explicit = process.env.OPENCLAW_CONFIG_PATH?.trim();
  if (explicit) return explicit;
  return path.join(STATE_DIR, "openclaw.json");
}

// Returns true if any config file exists (including legacy files).
function isConfigured() {
  const candidates = resolveConfigCandidates();
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

// ========== LEGACY CONFIG FILE MIGRATION ==========
// Auto-migrate legacy config files (moltbot.json, clawdbot.json) → openclaw.json on module load.
// This runs once at startup before any gateway operations.
(function migrateLegacyConfigFiles() {
  const target = configPath();
  
  // If target already exists, nothing to migrate
  try {
    if (fs.existsSync(target)) {
      return;
    }
  } catch {
    return;
  }
  
  // Check for legacy files and migrate the first one found
  const legacyFiles = [
    path.join(STATE_DIR, "moltbot.json"),
    path.join(STATE_DIR, "clawdbot.json"),
  ];
  
  for (const legacyPath of legacyFiles) {
    try {
      if (fs.existsSync(legacyPath)) {
        console.warn(`[config-migration] Found legacy config file: ${legacyPath}`);
        console.warn(`[config-migration] Renaming to: ${target}`);
        
        // Ensure target directory exists
        fs.mkdirSync(path.dirname(target), { recursive: true });
        
        // Rename (atomic on same filesystem)
        fs.renameSync(legacyPath, target);
        
        console.warn(`[config-migration] ✓ Migration complete`);
        return;
      }
    } catch (err) {
      console.error(`[config-migration] Failed to migrate ${legacyPath}: ${err.message}`);
      // Continue checking other legacy files
    }
  }
})();

let gatewayProc = null;
let gatewayStarting = null;
let gatewayHealthy = false;  // Track if gateway responded to health check

// Debug breadcrumbs for common Railway failures (502 / "Application failed to respond").
let lastGatewayError = null;
let lastGatewayExit = null;
let lastDoctorOutput = null;
let lastDoctorAt = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 60_000;  // Increased from 20s to 60s for Railway startup
  const start = Date.now();
  const endpoints = ["/openclaw", "/openclaw", "/", "/health"];
  
  while (Date.now() - start < timeoutMs) {
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${GATEWAY_TARGET}${endpoint}`, { method: "GET" });
        // Any HTTP response means the port is open.
        if (res) {
          const elapsed = ((Date.now() - start) / 1000).toFixed(1);
          console.log(`[gateway] ready at ${endpoint} (${elapsed}s elapsed)`);
          gatewayHealthy = true;
          return true;
        }
      } catch (err) {
        // not ready, try next endpoint
      }
    }
    await sleep(250);
  }
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.warn(`[gateway] initial readiness check timed out after ${elapsed}s, but gateway may still be starting...`);
  console.warn(`[gateway] continuing health monitoring in background`);
  return false;
}

async function startGateway() {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  // Sync wrapper token to openclaw.json before every gateway start.
  // This ensures the gateway's config-file token matches what the wrapper injects via proxy.
  console.log(`[gateway] ========== GATEWAY START TOKEN SYNC ==========`);
  console.log(`[gateway] Syncing wrapper token to config (length: ${OPENCLAW_GATEWAY_TOKEN.length})`);
  debug(`[gateway] Token preview: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);

  const syncResult = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.auth.token", OPENCLAW_GATEWAY_TOKEN]),
  );

  console.log(`[gateway] Sync result: exit code ${syncResult.code}`);
  if (syncResult.output?.trim()) {
    console.log(`[gateway] Sync output: ${syncResult.output}`);
  }

  if (syncResult.code !== 0) {
    console.error(`[gateway] ⚠️  WARNING: Token sync failed with code ${syncResult.code}`);
    throw new Error(`Token sync failed: ${syncResult.output}`);
  }

  // Verify sync succeeded
  try {
    const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const configToken = config?.gateway?.auth?.token;

    console.log(`[gateway] Token verification:`);
    debug(`[gateway]   Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
    debug(`[gateway]   Config:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`);
    console.log(`[gateway]   Token lengths - Wrapper: ${OPENCLAW_GATEWAY_TOKEN.length}, Config: ${configToken?.length || 0}`);

    if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
      console.error(`[gateway] ✗ Token mismatch detected!`);
      debug(`[gateway]   Full wrapper: ${OPENCLAW_GATEWAY_TOKEN}`);
      debug(`[gateway]   Full config:  ${configToken || 'null'}`);
      throw new Error(
        `Token mismatch: tokens don't match (enable DEBUG logging for details)`
      );
    }
    console.log(`[gateway] ✓ Token verification PASSED`);
  } catch (err) {
    console.error(`[gateway] ERROR: Token verification failed: ${err}`);
    throw err; // Don't start gateway with mismatched token
  }

  console.log(`[gateway] ========== TOKEN SYNC COMPLETE ==========`);

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_NODE, clawArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  console.log(`[gateway] starting with command: ${OPENCLAW_NODE} ${clawArgs(args).join(" ")}`);
  console.log(`[gateway] STATE_DIR: ${STATE_DIR}`);
  console.log(`[gateway] WORKSPACE_DIR: ${WORKSPACE_DIR}`);
  console.log(`[gateway] config path: ${configPath()}`);

  gatewayProc.on("error", (err) => {
    const msg = `[gateway] spawn error: ${String(err)}`;
    console.error(msg);
    lastGatewayError = msg;
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    const msg = `[gateway] exited code=${code} signal=${signal}`;
    console.error(msg);
    lastGatewayExit = { code, signal, at: new Date().toISOString() };
    gatewayProc = null;
    gatewayHealthy = false;
  });
  
  // Start background health monitoring
  startBackgroundHealthMonitor();
}

// Background health monitor - continues checking if gateway becomes healthy after timeout
let healthMonitorInterval = null;
function startBackgroundHealthMonitor() {
  // Clear any existing monitor
  if (healthMonitorInterval) {
    clearInterval(healthMonitorInterval);
  }
  
  // Check gateway health every 10 seconds
  healthMonitorInterval = setInterval(async () => {
    // Only monitor if gateway process exists but hasn't responded yet
    if (gatewayProc && !gatewayHealthy) {
      try {
        const res = await fetch(`${GATEWAY_TARGET}/health`, { 
          method: "GET",
          signal: AbortSignal.timeout(5000)
        });
        if (res) {
          console.log(`[gateway] background health check: gateway is NOW HEALTHY`);
          gatewayHealthy = true;
          clearInterval(healthMonitorInterval);
          healthMonitorInterval = null;
        }
      } catch (err) {
        // Still not ready, will check again in 10s
      }
    } else if (!gatewayProc && healthMonitorInterval) {
      // Gateway stopped, clear monitor
      clearInterval(healthMonitorInterval);
      healthMonitorInterval = null;
      gatewayHealthy = false;
    }
  }, 10_000);
}

async function runDoctorBestEffort() {
  // Avoid spamming `openclaw doctor` in a crash loop.
  const now = Date.now();
  if (lastDoctorAt && now - lastDoctorAt < 5 * 60 * 1000) return;
  lastDoctorAt = now;

  try {
    const r = await runCmd(OPENCLAW_NODE, clawArgs(["doctor"]));
    const out = redactSecrets(r.output || "");
    lastDoctorOutput = out.length > 50_000 ? out.slice(0, 50_000) + "\n... (truncated)\n" : out;
  } catch (err) {
    lastDoctorOutput = `doctor failed: ${String(err)}`;
  }
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      try {
        lastGatewayError = null;
        gatewayHealthy = false;
        await startGateway();
        const ready = await waitForGatewayReady({ timeoutMs: 60_000 });
        if (!ready) {
          console.warn(`[gateway] Initial readiness check timed out, but background monitor will continue checking`);
          // Don't throw error - background monitor will detect when ready
        }
      } catch (err) {
        const msg = `[gateway] start failure: ${String(err)}`;
        lastGatewayError = msg;
        // Collect extra diagnostics to help users file issues.
        await runDoctorBestEffort();
        throw err;
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

async function restartGateway() {
  console.log("[gateway] Restarting gateway...");

  // Kill gateway process tracked by wrapper
  if (gatewayProc) {
    console.log(`[gateway] Killing wrapper-managed gateway process (PID: ${gatewayProc.pid})`);
    try {
      gatewayProc.kill("SIGTERM");
    } catch (err) {
      console.log(`[gateway] Failed to kill wrapper process: ${err.message}`);
    }
    gatewayProc = null;
  }

  // Also kill any other gateway processes (e.g., started by onboard command)
  // Use pkill to ensure ALL gateway processes are stopped before restart
  console.log(`[gateway] Ensuring all gateway processes stopped with pkill...`);
  
  // Try multiple patterns to catch all gateway variants
  const killPatterns = [
    "gateway run",           // Main gateway command
    "openclaw.*gateway",     // Any openclaw gateway process
    `port.*${INTERNAL_GATEWAY_PORT}`, // Processes using our port
  ];
  
  for (const pattern of killPatterns) {
    try {
      const killResult = await runCmd("pkill", ["-f", pattern], { timeoutMs: 5000 });
      if (killResult.code === 0) {
        console.log(`[gateway] pkill -f "${pattern}" succeeded`);
      }
    } catch (err) {
      // pkill returns 1 if no processes match, which is fine
      console.log(`[gateway] pkill -f "${pattern}": ${err.message}`);
    }
  }

  // Give processes time to exit and release the port
  // Increased from 1.5s to 2s for more reliable cleanup
  await sleep(2000);

  // Verify port is actually free before restarting
  try {
    const stillListening = await probeGateway();
    if (stillListening) {
      console.warn(`[gateway] ⚠️  Port ${INTERNAL_GATEWAY_PORT} still in use after pkill!`);
      // Wait a bit longer
      await sleep(3000);
    }
  } catch {
    // probeGateway throws if port is free, which is what we want
  }

  return ensureGatewayRunning();
}

function requireSetupAuth(req, res, next) {
  if (!SETUP_PASSWORD) {
    return res
      .status(500)
      .type("text/plain")
      .send(
        "SETUP_PASSWORD is not set. Set it in Railway Variables before using /setup.",
      );
  }

  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme !== "Basic" || !encoded) {
    res.set("WWW-Authenticate", 'Basic realm="Openclaw Setup"');
    return res.status(401).send("Auth required");
  }
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  const password = idx >= 0 ? decoded.slice(idx + 1) : "";
  if (password !== SETUP_PASSWORD) {
    res.set("WWW-Authenticate", 'Basic realm="Openclaw Setup"');
    return res.status(401).send("Invalid password");
  }
  return next();
}

async function probeGateway() {
  // Don't assume HTTP — the gateway primarily speaks WebSocket.
  // A simple TCP connect check is enough for "is it up".
  const net = await import("node:net");

  return await new Promise((resolve) => {
    const sock = net.createConnection({
      host: INTERNAL_GATEWAY_HOST,
      port: INTERNAL_GATEWAY_PORT,
      timeout: 750,
    });

    const done = (ok) => {
      try { sock.destroy(); } catch {}
      resolve(ok);
    };

    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
  });
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Minimal health endpoint for Railway.
app.get("/setup/healthz", (_req, res) => res.json({ ok: true }));

// Public health endpoint (no auth) so Railway can probe without /setup.
// Keep this free of secrets.
app.get("/healthz", async (_req, res) => {
  let gatewayReachable = false;
  if (isConfigured()) {
    try {
      gatewayReachable = await probeGateway();
    } catch {
      gatewayReachable = false;
    }
  }

  res.json({
    ok: true,
    wrapper: {
      configured: isConfigured(),
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
    },
    gateway: {
      target: GATEWAY_TARGET,
      reachable: gatewayReachable,
      healthy: gatewayHealthy,
      processRunning: !!gatewayProc,
      lastError: lastGatewayError,
      lastExit: lastGatewayExit,
      lastDoctorAt,
    },
  });
});

// Serve static files for setup wizard
app.get("/setup/app.js", requireSetupAuth, (_req, res) => {
  res.type("application/javascript");
  res.sendFile(path.join(process.cwd(), "src", "public", "setup-app.js"));
});

app.get("/setup/styles.css", requireSetupAuth, (_req, res) => {
  res.type("text/css");
  res.sendFile(path.join(process.cwd(), "src", "public", "styles.css"));
});

app.get("/setup", requireSetupAuth, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "src", "public", "setup.html"));
});

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  // Resilient version check with timeout and fallback
  let openclawVersion = "unknown";
  try {
    const version = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]), { timeoutMs: 5000 });
    if (version.code === 0 && version.output?.trim()) {
      openclawVersion = version.output.trim();
    }
  } catch (err) {
    console.warn(`[status] Failed to get openclaw version: ${err.message}`);
  }

  // Resilient channels help check with timeout and fallback
  let channelsAddHelp = "";
  try {
    const channelsHelpResult = await runCmd(
      OPENCLAW_NODE,
      clawArgs(["channels", "add", "--help"]),
      { timeoutMs: 5000 }
    );
    if (channelsHelpResult.code === 0) {
      channelsAddHelp = channelsHelpResult.output;
    }
  } catch (err) {
    console.warn(`[status] Failed to get channels help: ${err.message}`);
  }

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    openclawVersion,
    channelsAddHelp,
    authGroups: AUTH_GROUPS, // Use constant instead of inline definition
  });
});

function buildOnboardArgs(payload) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    // The wrapper owns public networking; keep the gateway internal.
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    OPENCLAW_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart",
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    // Map secret to correct flag for common choices.
    const secret = (payload.authSecret || "").trim();
    
    // Auth choices that require a secret (API keys, tokens, etc.)
    const requiresSecret = [
      "openai-api-key",
      "apiKey",
      "token",
      "openrouter-api-key",
      "ai-gateway-api-key",
      "moonshot-api-key",
      "kimi-code-api-key",
      "gemini-api-key",
      "zai-api-key",
      "minimax-api",
      "minimax-api-lightning",
      "synthetic-api-key",
      "opencode-zen",
    ];
    
    // Validate: if user selected an auth choice that requires a secret, fail fast
    if (requiresSecret.includes(payload.authChoice) && !secret) {
      throw new Error(
        `Missing auth secret for authChoice=${payload.authChoice}.\n` +
        `Please provide your API key or token in the "Key / Token" field above.\n\n` +
        `Troubleshooting:\n` +
        `- Ensure you've pasted the API key correctly (no extra spaces)\n` +
        `- Check the provider's documentation for how to obtain the key\n` +
        `- Verify the key is valid and not expired`
      );
    }
    
    const map = {
      "openai-api-key": "--openai-api-key",
      apiKey: "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key",
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }

    if (payload.authChoice === "token" && secret) {
      // This is the Anthropics setup-token flow.
      args.push("--token-provider", "anthropic", "--token", secret);
    }
  }

  return args;
}

// Runs a command with timeout support (default: 120s).
// Escalates from SIGTERM → SIGKILL to prevent hanging commands.
function runCmd(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 120_000; // 2 minutes default
  
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    let timedOut = false;
    let killTimer = null;
    
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    // Timeout handler: SIGTERM first, then SIGKILL after 5s
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      out += `\n[timeout] Command exceeded ${timeoutMs}ms, sending SIGTERM...\n`;
      
      try {
        proc.kill("SIGTERM");
      } catch (err) {
        out += `[timeout] SIGTERM failed: ${err.message}\n`;
      }
      
      // Escalate to SIGKILL after 5 seconds
      killTimer = setTimeout(() => {
        out += `[timeout] Process still alive after SIGTERM, sending SIGKILL...\n`;
        try {
          proc.kill("SIGKILL");
        } catch (err) {
          out += `[timeout] SIGKILL failed: ${err.message}\n`;
        }
      }, 5000);
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      
      if (timedOut && code === null) {
        // Process was killed by our timeout handler
        resolve({ code: 124, output: out }); // 124 = timeout exit code (like GNU timeout)
      } else {
        resolve({ code: code ?? 0, output: out });
      }
    });
  });
}

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  try {
    if (isConfigured()) {
      await ensureGatewayRunning();
      return res.json({
        ok: true,
        output:
          "Already configured.\nUse Reset setup if you want to rerun onboarding.\n",
      });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

    const payload = req.body || {};
    const onboardArgs = buildOnboardArgs(payload);

    // DIAGNOSTIC: Log token we're passing to onboard (DEBUG only)
    debug(`[onboard] ========== TOKEN DIAGNOSTIC START ==========`);
    debug(`[onboard] Wrapper token (from env/file/generated): ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (length: ${OPENCLAW_GATEWAY_TOKEN.length})`);
    debug(`[onboard] Onboard command args include: --gateway-token ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
    debug(`[onboard] Full onboard command: node ${clawArgs(onboardArgs).join(' ').replace(OPENCLAW_GATEWAY_TOKEN, OPENCLAW_GATEWAY_TOKEN.slice(0, 16) + '...')}`);

    const onboard = await runCmd(OPENCLAW_NODE, clawArgs(onboardArgs));

    let extra = "";

    const ok = onboard.code === 0 && isConfigured();

    // DIAGNOSTIC: Check what token onboard actually wrote to config (DEBUG only)
    if (ok) {
      try {
        const configAfterOnboard = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        const tokenAfterOnboard = configAfterOnboard?.gateway?.auth?.token;
        debug(`[onboard] Token in config AFTER onboard: ${tokenAfterOnboard?.slice(0, 16)}... (length: ${tokenAfterOnboard?.length || 0})`);
        const tokensMatch = tokenAfterOnboard === OPENCLAW_GATEWAY_TOKEN;
        console.log(`[onboard] Token match: ${tokensMatch ? '✓ MATCHES' : '✗ MISMATCH!'}`);
        if (!tokensMatch) {
          console.log(`[onboard] ⚠️  PROBLEM: onboard command ignored --gateway-token flag and wrote its own token!`);
          extra += `\n[WARNING] onboard wrote different token than expected\n`;
          if (DEBUG) {
            extra += `  Expected: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
            extra += `  Got:      ${tokenAfterOnboard?.slice(0, 16)}...\n`;
          }
        }
      } catch (err) {
        console.error(`[onboard] Could not check config after onboard: ${err}`);
      }
    }

    // Optional channel setup (only after successful onboarding, and only if the installed CLI supports it).
    if (ok) {
      // Ensure gateway token is written into config so the browser UI can authenticate reliably.
      // (We also enforce loopback bind since the wrapper proxies externally.)
      console.log(`[onboard] Now syncing wrapper token to config`);
      debug(`[onboard] Token preview: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 8)}...`);

      await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.mode", "local"]));
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.auth.mode", "token"]),
      );

      const setTokenResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.auth.token",
          OPENCLAW_GATEWAY_TOKEN,
        ]),
      );

      console.log(`[onboard] config set gateway.auth.token result: exit code ${setTokenResult.code}`);
      if (setTokenResult.output?.trim()) {
        console.log(`[onboard] config set output: ${setTokenResult.output}`);
      }

      if (setTokenResult.code !== 0) {
        console.error(`[onboard] ⚠️  WARNING: config set gateway.auth.token failed with code ${setTokenResult.code}`);
        extra += `\n[WARNING] Failed to set gateway token in config: ${setTokenResult.output}\n`;
      }

      // Verify the token was actually written to config
      try {
        const configContent = fs.readFileSync(configPath(), "utf8");
        const config = JSON.parse(configContent);
        const configToken = config?.gateway?.auth?.token;

        console.log(`[onboard] Token verification after sync:`);
        debug(`[onboard]   Wrapper token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
        debug(`[onboard]   Config token:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`);
        console.log(`[onboard]   Token lengths - Wrapper: ${OPENCLAW_GATEWAY_TOKEN.length}, Config: ${configToken?.length || 0}`);

        if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
          console.error(`[onboard] ✗ ERROR: Token mismatch after config set!`);
          debug(`[onboard]   Full wrapper token: ${OPENCLAW_GATEWAY_TOKEN}`);
          debug(`[onboard]   Full config token:  ${configToken || 'null'}`);
          extra += `\n[ERROR] Token verification failed! Config has different token than wrapper.\n`;
          if (DEBUG) {
            extra += `  Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
            extra += `  Config:  ${configToken?.slice(0, 16)}...\n`;
          }
        } else {
          console.log(`[onboard] ✓ Token verification PASSED - tokens match!`);
          extra += `\n[onboard] ✓ Gateway token synced successfully\n`;
        }
      } catch (err) {
        console.error(`[onboard] ERROR: Could not verify token in config: ${err}`);
        extra += `\n[ERROR] Could not verify token: ${String(err)}\n`;
      }

      console.log(`[onboard] ========== TOKEN DIAGNOSTIC END ==========`);

      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.bind", "loopback"]),
      );
      await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.port",
          String(INTERNAL_GATEWAY_PORT),
        ]),
      );
      // Allow Control UI access without device pairing (fixes error 1008: pairing required)
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.controlUi.allowInsecureAuth", "true"]),
      );

      // Configure trusted proxies for gateway (based on PR #12 by ArtificialSight)
      // - Auto-detects Railway environment via env vars
      // - Security enhancement: Trust localhost only (not 0.0.0.0/0) since wrapper proxies all traffic
      {
        const isRailwayEnv =
          !!process.env.RAILWAY_PROJECT_ID ||
          !!process.env.RAILWAY_ENVIRONMENT ||
          !!process.env.RAILWAY_STATIC_URL;
        const trustAllProxies = process.env.OPENCLAW_TRUST_PROXY_ALL === "true";
        
        // Security: Even on Railway, only trust localhost since wrapper proxies all traffic through 127.0.0.1
        // This is more secure than PR #12's original 0.0.0.0/0 while maintaining functionality
        const trustedProxies = (isRailwayEnv || trustAllProxies)
          ? ["127.0.0.1"]  // Enhanced from PR #12: was ["0.0.0.0/0"], now localhost only
          : ["127.0.0.1/32"];

        console.log(`[setup] Configuring trusted proxies: ${JSON.stringify(trustedProxies)} (Railway: ${isRailwayEnv})`);

        await runCmd(
          OPENCLAW_NODE,
          clawArgs([
            "config",
            "set",
            "--json",
            "gateway.trustedProxies",
            JSON.stringify(trustedProxies),
          ]),
        );
      }

      // ========== CUSTOM PROVIDER CONFIGURATION ==========
      // Add custom OpenAI-compatible provider if provided
      if (payload.customProviderId?.trim()) {
        const providerId = payload.customProviderId.trim();
        const baseUrl = payload.customProviderBaseUrl?.trim();
        const api = payload.customProviderApi?.trim();
        const apiKeyEnv = payload.customProviderApiKeyEnv?.trim();
        const modelId = payload.customProviderModelId?.trim();

        // Validation: Provider ID (alphanumeric + underscore + dash)
        if (!/^[A-Za-z0-9_-]+$/.test(providerId)) {
          throw new Error(
            `Invalid custom provider ID "${providerId}". Must contain only alphanumeric characters, underscores, and dashes.`
          );
        }

        // Validation: Base URL (must start with http:// or https://)
        if (!baseUrl || !/^https?:\/\/.+/.test(baseUrl)) {
          throw new Error(
            `Invalid custom provider base URL "${baseUrl || '(empty)'}". Must start with http:// or https://.`
          );
        }

        // Validation: API type (must be openai-completions or openai-responses)
        if (api !== "openai-completions" && api !== "openai-responses") {
          throw new Error(
            `Invalid custom provider API type "${api || '(empty)'}". Must be "openai-completions" or "openai-responses".`
          );
        }

        // Validation: API key env var (optional, but must match pattern if provided)
        if (apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/.test(apiKeyEnv)) {
          throw new Error(
            `Invalid API key environment variable name "${apiKeyEnv}". Must be uppercase with underscores (e.g., MY_API_KEY).`
          );
        }

        console.log(`[custom-provider] Configuring custom provider: ${providerId}`);
        console.log(`[custom-provider]   Base URL: ${baseUrl}`);
        console.log(`[custom-provider]   API: ${api}`);
        console.log(`[custom-provider]   API Key Env: ${apiKeyEnv || '(none)'}`);
        console.log(`[custom-provider]   Model ID: ${modelId || '(none)'}`);

        // Build provider config object
        const providerConfig = {
          api,
          baseUrl,
        };

        // Add API key if provided (use env var interpolation)
        if (apiKeyEnv) {
          providerConfig.apiKey = `\${${apiKeyEnv}}`;
        }

        // Add default model if provided
        if (modelId) {
          providerConfig.models = {
            [modelId]: {
              id: modelId,
            },
          };
        }

        // Write provider config to models.providers.{providerId}
        const setProviderResult = await runCmd(
          OPENCLAW_NODE,
          clawArgs([
            "config",
            "set",
            "--json",
            `models.providers.${providerId}`,
            JSON.stringify(providerConfig),
          ]),
        );

        extra += `\n[custom-provider] exit=${setProviderResult.code}\n${setProviderResult.output || "(no output)"}`;

        if (setProviderResult.code !== 0) {
          throw new Error(`Failed to configure custom provider: ${setProviderResult.output}`);
        }

        // Set models.mode to "merge" to prevent overwriting other providers
        const setModeResult = await runCmd(
          OPENCLAW_NODE,
          clawArgs(["config", "set", "models.mode", "merge"]),
        );

        extra += `\n[custom-provider] Set models.mode=merge: exit=${setModeResult.code}\n${setModeResult.output || "(no output)"}`;

        if (setModeResult.code !== 0) {
          console.warn(`[custom-provider] Failed to set models.mode=merge: ${setModeResult.output}`);
        }

        console.log(`[custom-provider] ✓ Custom provider "${providerId}" configured successfully`);
      }

      const channelsHelp = await runCmd(
        OPENCLAW_NODE,
        clawArgs(["channels", "add", "--help"]),
      );
      const helpText = channelsHelp.output || "";

      const supports = (name) => helpText.includes(name);

      if (payload.telegramToken?.trim()) {
        if (!supports("telegram")) {
          extra +=
            "\n[telegram] skipped (this openclaw build does not list telegram in `channels add --help`)\n";
        } else {
          // Avoid `channels add` here (it has proven flaky across builds); write config directly.
          const token = payload.telegramToken.trim();
          const cfgObj = {
            enabled: true,
            dmPolicy: "pairing",
            botToken: token,
            groupPolicy: "allowlist",
            streamMode: "partial",
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.telegram",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.telegram"]),
          );
          extra += `\n[telegram config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[telegram verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
          
          // Enable telegram plugin
          console.log("[telegram] Enabling telegram plugin...");
          const enablePlugin = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["plugins", "enable", "telegram"]),
          );
          extra += `\n[telegram plugin] exit=${enablePlugin.code}\n${enablePlugin.output || "(no output)"}`;
        }
      }

      if (payload.discordToken?.trim()) {
        if (!supports("discord")) {
          extra +=
            "\n[discord] skipped (this openclaw build does not list discord in `channels add --help`)\n";
        } else {
          const token = payload.discordToken.trim();
          const cfgObj = {
            enabled: true,
            token,
            groupPolicy: "allowlist",
            dm: {
              policy: "pairing",
            },
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.discord",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.discord"]),
          );
          extra += `\n[discord config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[discord verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
        }
      }

      if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
        if (!supports("slack")) {
          extra +=
            "\n[slack] skipped (this openclaw build does not list slack in `channels add --help`)\n";
        } else {
          const cfgObj = {
            enabled: true,
            botToken: payload.slackBotToken?.trim() || undefined,
            appToken: payload.slackAppToken?.trim() || undefined,
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.slack",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.slack"]),
          );
          extra += `\n[slack config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[slack verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
        }
      }

      // Run doctor --fix to fix any configuration issues before gateway restart
      console.log("[setup] Running openclaw doctor --fix...");
      const doctorFix = await runCmd(
        OPENCLAW_NODE,
        clawArgs(["doctor", "--fix"]),
      );
      extra += `\n[doctor --fix] exit=${doctorFix.code}\n${doctorFix.output || "(no output)"}`;

      // Apply changes immediately.
      await restartGateway();
    }

    return res.status(ok ? 200 : 500).json({
      ok,
      output: `${onboard.output}${extra}`,
    });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res
      .status(500)
      .json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

function redactSecrets(text) {
  if (!text) return text;
  // Very small best-effort redaction. (Config paths/values may still contain secrets.)
  return String(text)
    .replace(/(sk-[A-Za-z0-9_-]{10,})/g, "[REDACTED]")
    .replace(/(gho_[A-Za-z0-9_]{10,})/g, "[REDACTED]")
    .replace(/(xox[baprs]-[A-Za-z0-9-]{10,})/g, "[REDACTED]")
    // Telegram bot tokens look like: 123456:ABCDEF...
    .replace(/(\d{5,}:[A-Za-z0-9_-]{10,})/g, "[REDACTED]")
    .replace(/(AA[A-Za-z0-9_-]{10,}:\S{10,})/g, "[REDACTED]");
}

// ========== DEBUG CONSOLE: HELPER FUNCTIONS & ALLOWLIST ==========

// Extract device requestIds from device list output for validation
function extractDeviceRequestIds(output) {
  const ids = [];
  const lines = (output || "").split("\n");
  // Look for lines with requestId format: alphanumeric, underscore, dash
  for (const line of lines) {
    const match = line.match(/requestId[:\s]+([A-Za-z0-9_-]+)/i);
    if (match) ids.push(match[1]);
  }
  return ids;
}

// Allowlisted commands for debug console (security-critical: no arbitrary shell execution)
const ALLOWED_CONSOLE_COMMANDS = new Set([
  // Gateway lifecycle (wrapper-managed, no openclaw CLI needed)
  "gateway.restart",
  "gateway.stop",
  "gateway.start",
  
  // OpenClaw CLI commands (all safe, read-only or user-controlled)
  "openclaw.version",
  "openclaw.status",
  "openclaw.health",
  "openclaw.doctor",
  "openclaw.logs.tail",
  "openclaw.config.get",
  "openclaw.devices.list",
  "openclaw.devices.approve",
  "openclaw.plugins.list",
  "openclaw.plugins.enable",
]);

// Debug console command handler (POST /setup/api/console/run)
app.post("/setup/api/console/run", requireSetupAuth, async (req, res) => {
  try {
    const { command, arg } = req.body || {};
    
    // Validate command is allowlisted
    if (!command || !ALLOWED_CONSOLE_COMMANDS.has(command)) {
      return res.status(400).json({
        ok: false,
        error: `Command not allowed: ${command || "(empty)"}`,
      });
    }
    
    let result;
    
    // Gateway lifecycle commands (wrapper-managed, no openclaw CLI)
    if (command === "gateway.restart") {
      await restartGateway();
      result = { code: 0, output: "Gateway restarted successfully\n" };
    } else if (command === "gateway.stop") {
      if (gatewayProc) {
        gatewayProc.kill("SIGTERM");
        gatewayProc = null;
        result = { code: 0, output: "Gateway stopped\n" };
      } else {
        result = { code: 0, output: "Gateway not running\n" };
      }
    } else if (command === "gateway.start") {
      await ensureGatewayRunning();
      result = { code: 0, output: "Gateway started successfully\n" };
    }
    
    // OpenClaw CLI commands
    else if (command === "openclaw.version") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
    } else if (command === "openclaw.status") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["status"]));
    } else if (command === "openclaw.health") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["health"]));
    } else if (command === "openclaw.doctor") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["doctor"]));
    } else if (command === "openclaw.logs.tail") {
      // arg is the tail count (default 50)
      const count = arg?.trim() || "50";
      if (!/^\d+$/.test(count)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid tail count (must be a number)",
        });
      }
      result = await runCmd(OPENCLAW_NODE, clawArgs(["logs", "--tail", count]));
    } else if (command === "openclaw.config.get") {
      // arg is the config path (e.g., "gateway.port")
      const configPath = arg?.trim();
      if (!configPath) {
        return res.status(400).json({
          ok: false,
          error: "Config path required (e.g., gateway.port)",
        });
      }
      result = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", configPath]));
    } else if (command === "openclaw.devices.list") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["devices", "list"]));
    } else if (command === "openclaw.devices.approve") {
      // arg is the device requestId
      const requestId = arg?.trim();
      if (!requestId) {
        return res.status(400).json({
          ok: false,
          error: "Device requestId required",
        });
      }
      // Validate requestId format (alphanumeric, underscore, dash)
      if (!/^[A-Za-z0-9_-]+$/.test(requestId)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid requestId format (alphanumeric, underscore, dash only)",
        });
      }
      result = await runCmd(OPENCLAW_NODE, clawArgs(["devices", "approve", requestId]));
    } else if (command === "openclaw.plugins.list") {
      result = await runCmd(OPENCLAW_NODE, clawArgs(["plugins", "list"]));
    } else if (command === "openclaw.plugins.enable") {
      // arg is the plugin name
      const pluginName = arg?.trim();
      if (!pluginName) {
        return res.status(400).json({
          ok: false,
          error: "Plugin name required",
        });
      }
      // Validate plugin name format (alphanumeric, underscore, dash)
      if (!/^[A-Za-z0-9_-]+$/.test(pluginName)) {
        return res.status(400).json({
          ok: false,
          error: "Invalid plugin name format (alphanumeric, underscore, dash only)",
        });
      }
      result = await runCmd(OPENCLAW_NODE, clawArgs(["plugins", "enable", pluginName]));
    } else {
      // Should never reach here due to allowlist check
      return res.status(500).json({
        ok: false,
        error: "Internal error: command allowlisted but not implemented",
      });
    }
    
    // Apply secret redaction to all output
    const output = redactSecrets(result.output || "");
    
    return res.json({
      ok: result.code === 0,
      output,
      exitCode: result.code,
    });
  } catch (err) {
    console.error("[/setup/api/console/run] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
  const help = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["channels", "add", "--help"]),
  );
  
  // Enhanced diagnostics: channel config checks
  let telegramConfig = null;
  let discordConfig = null;
  try {
    const tg = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", "channels.telegram"]));
    if (tg.code === 0) {
      telegramConfig = redactSecrets(tg.output.trim());
    }
  } catch {}
  
  try {
    const dc = await runCmd(OPENCLAW_NODE, clawArgs(["config", "get", "channels.discord"]));
    if (dc.code === 0) {
      discordConfig = redactSecrets(dc.output.trim());
    }
  } catch {}
  
  // Gateway diagnostics
  const gatewayReachable = isConfigured() ? await probeGateway() : false;
  
  // Doctor output (cached or fresh)
  let doctorOutput = lastDoctorOutput;
  if (!doctorOutput && isConfigured()) {
    try {
      const dr = await runCmd(OPENCLAW_NODE, clawArgs(["doctor"]));
      doctorOutput = redactSecrets(dr.output || "");
    } catch {}
  }
  
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim()),
      gatewayTokenPersisted: fs.existsSync(
        path.join(STATE_DIR, "gateway.token"),
      ),
      railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
    openclaw: {
      entry: OPENCLAW_ENTRY,
      node: OPENCLAW_NODE,
      version: v.output.trim(),
      channelsAddHelpIncludesTelegram: help.output.includes("telegram"),
    },
    channels: {
      telegram: telegramConfig,
      discord: discordConfig,
    },
    gateway: {
      reachable: gatewayReachable,
      lastError: lastGatewayError,
      lastExit: lastGatewayExit,
    },
    diagnostics: {
      doctor: doctorOutput,
    },
  });
});

// ========== CONFIG EDITOR ENDPOINTS ==========

// GET /setup/api/config/raw - Load raw config file
app.get("/setup/api/config/raw", requireSetupAuth, async (_req, res) => {
  try {
    const cfgPath = configPath();
    const exists = fs.existsSync(cfgPath);
    let content = "";
    
    if (exists) {
      try {
        content = fs.readFileSync(cfgPath, "utf8");
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: `Failed to read config file: ${String(err)}`,
        });
      }
    }
    
    return res.json({
      ok: true,
      path: cfgPath,
      exists,
      content,
    });
  } catch (err) {
    console.error("[/setup/api/config/raw GET] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

// POST /setup/api/config/raw - Save raw config file with backup and restart
app.post("/setup/api/config/raw", requireSetupAuth, async (req, res) => {
  try {
    const { content } = req.body || {};
    
    if (typeof content !== "string") {
      return res.status(400).json({
        ok: false,
        error: "Missing or invalid 'content' field (must be string)",
      });
    }
    
    // Size limit: 500KB to prevent DoS
    const MAX_SIZE = 500 * 1024;
    if (content.length > MAX_SIZE) {
      const sizeKB = (content.length / 1024).toFixed(1);
      const maxKB = (MAX_SIZE / 1024).toFixed(0);
      return res.status(400).json({
        ok: false,
        error: `Config file too large: ${sizeKB}KB (max ${maxKB}KB)`,
      });
    }
    
    // Validate JSON syntax
    try {
      JSON.parse(content);
    } catch (err) {
      return res.status(400).json({
        ok: false,
        error: `Invalid JSON: ${String(err)}`,
      });
    }
    
    const cfgPath = configPath();
    
    // Create timestamped backup if file exists
    if (fs.existsSync(cfgPath)) {
      const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
      const backupPath = `${cfgPath}.bak-${timestamp}`;
      
      try {
        // Use copyFileSync for atomic backup
        fs.copyFileSync(cfgPath, backupPath);
        console.log(`[config-editor] Created backup: ${backupPath}`);
      } catch (err) {
        return res.status(500).json({
          ok: false,
          error: `Failed to create backup: ${String(err)}`,
        });
      }
    }
    
    // Write new config with secure permissions
    try {
      fs.writeFileSync(cfgPath, content, { encoding: "utf8", mode: 0o600 });
      console.log(`[config-editor] Saved config to ${cfgPath}`);
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: `Failed to write config file: ${String(err)}`,
      });
    }
    
    // Restart gateway to apply changes
    let restartOutput = "";
    try {
      await restartGateway();
      restartOutput = "Gateway restarted successfully to apply changes.";
      console.log("[config-editor] Gateway restarted after config save");
    } catch (err) {
      restartOutput = `Warning: Config saved but gateway restart failed: ${String(err)}`;
      console.error("[config-editor] Gateway restart failed:", err);
    }
    
    return res.json({
      ok: true,
      message: "Config saved successfully",
      restartOutput,
    });
  } catch (err) {
    console.error("[/setup/api/config/raw POST] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

// ========== DEVICE PAIRING HELPER ENDPOINTS ==========

// GET /setup/api/devices/pending - List pending device requests
app.get("/setup/api/devices/pending", requireSetupAuth, async (_req, res) => {
  try {
    // Run openclaw devices list command
    const result = await runCmd(OPENCLAW_NODE, clawArgs(["devices", "list"]));
    
    // Extract requestIds from output
    const requestIds = extractDeviceRequestIds(result.output || "");
    
    return res.json({
      ok: result.code === 0,
      requestIds,
      output: result.output || "",
      exitCode: result.code,
    });
  } catch (err) {
    console.error("[/setup/api/devices/pending] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

// POST /setup/api/devices/approve - Approve a device request
app.post("/setup/api/devices/approve", requireSetupAuth, async (req, res) => {
  try {
    const { requestId } = req.body || {};
    
    if (!requestId) {
      return res.status(400).json({
        ok: false,
        error: "Missing 'requestId' field",
      });
    }
    
    // Validate requestId format (alphanumeric + underscore + dash only)
    if (!/^[A-Za-z0-9_-]+$/.test(requestId)) {
      return res.status(400).json({
        ok: false,
        error: "Invalid requestId format (alphanumeric, underscore, dash only)",
      });
    }
    
    // Run openclaw devices approve command
    const result = await runCmd(OPENCLAW_NODE, clawArgs(["devices", "approve", requestId]));
    
    return res.json({
      ok: result.code === 0,
      output: result.output || "",
      exitCode: result.code,
    });
  } catch (err) {
    console.error("[/setup/api/devices/approve] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

// DEPRECATED: Legacy pairing endpoint (kept for backward compatibility)
// Use /setup/api/devices/approve instead for device pairing
app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["pairing", "approve", String(channel), String(code)]),
  );
  return res
    .status(r.code === 0 ? 200 : 500)
    .json({ ok: r.code === 0, output: r.output });
});

// ========== BACKUP IMPORT HELPER FUNCTIONS ==========

/**
 * Check if path p is under root directory (prevents path traversal attacks)
 */
function isUnderDir(p, root) {
  const normP = path.resolve(p);
  const normRoot = path.resolve(root);
  return normP === normRoot || normP.startsWith(normRoot + path.sep);
}

/**
 * Validate that a tar entry path is safe (no path traversal, no absolute paths)
 * Returns true if path looks safe, false if it should be filtered out
 */
function looksSafeTarPath(p) {
  // Reject absolute paths (leading /)
  if (p.startsWith("/")) {
    return false;
  }
  
  // Reject Windows drive letters (e.g., C:, D:)
  if (/^[a-zA-Z]:/.test(p)) {
    return false;
  }
  
  // Reject paths containing .. (parent directory traversal)
  const parts = p.split(/[/\\]/);
  if (parts.some((part) => part === "..")) {
    return false;
  }
  
  return true;
}

/**
 * Read request body into a Buffer with size limit
 * Enforces size limit during streaming (not after) to prevent memory exhaustion
 */
function readBodyBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    
    req.on("data", (chunk) => {
      totalSize += chunk.length;
      
      if (totalSize > maxBytes) {
        req.destroy();
        const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
        const maxMB = (maxBytes / (1024 * 1024)).toFixed(0);
        reject(new Error(`File too large: ${sizeMB}MB (max ${maxMB}MB)`));
        return;
      }
      
      chunks.push(chunk);
    });
    
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    
    req.on("error", (err) => {
      reject(err);
    });
  });
}

// ========== BACKUP IMPORT ENDPOINT ==========

/**
 * POST /setup/import - Import backup archive
 * Security: 250MB max, path traversal prevention, /data-only extraction
 */
app.post("/setup/import", requireSetupAuth, async (req, res) => {
  const MAX_UPLOAD_SIZE = 250 * 1024 * 1024; // 250MB
  
  try {
    console.log("[import] Starting backup import...");
    
    // Verify STATE_DIR and WORKSPACE_DIR are under /data for security
    const dataRoot = "/data";
    if (!isUnderDir(STATE_DIR, dataRoot) || !isUnderDir(WORKSPACE_DIR, dataRoot)) {
      console.error("[import] Security check failed: STATE_DIR or WORKSPACE_DIR not under /data");
      return res.status(400).json({
        ok: false,
        error: `Import requires both STATE_DIR and WORKSPACE_DIR under /data. Current: STATE_DIR=${STATE_DIR}, WORKSPACE_DIR=${WORKSPACE_DIR}. Set OPENCLAW_STATE_DIR=/data/.openclaw and OPENCLAW_WORKSPACE_DIR=/data/workspace in Railway Variables.`,
      });
    }
    
    // Stop gateway before import to prevent file conflicts
    console.log("[import] Stopping gateway...");
    if (gatewayProc) {
      try {
        gatewayProc.kill("SIGTERM");
        gatewayProc = null;
      } catch (err) {
        console.warn(`[import] Failed to stop gateway: ${err.message}`);
      }
    }
    
    // Also pkill any orphaned gateway processes
    try {
      await runCmd("pkill", ["-f", "gateway run"], { timeoutMs: 5000 });
    } catch {
      // Ignore pkill errors (process may not exist)
    }
    
    // Wait for gateway to fully stop
    await sleep(2000);
    console.log("[import] Gateway stopped");
    
    // Read request body with size limit
    console.log("[import] Reading upload (max 250MB)...");
    const buffer = await readBodyBuffer(req, MAX_UPLOAD_SIZE);
    console.log(`[import] Received ${buffer.length} bytes`);
    
    // Write to temp file for extraction
    const tmpFile = path.join(os.tmpdir(), `openclaw-import-${Date.now()}.tar.gz`);
    fs.writeFileSync(tmpFile, buffer);
    console.log(`[import] Wrote temp file: ${tmpFile}`);
    
    try {
      // Extract tar to /data with security filter
      console.log("[import] Extracting archive to /data...");
      let extractedCount = 0;
      let filteredCount = 0;
      
      await tar.x({
        file: tmpFile,
        cwd: dataRoot,
        filter: (path, entry) => {
          // Security: only allow safe paths
          if (!looksSafeTarPath(path)) {
            console.warn(`[import] Filtered unsafe path: ${path}`);
            filteredCount++;
            return false;
          }
          extractedCount++;
          return true;
        },
        onwarn: (code, message) => {
          console.warn(`[import] tar warning: ${code} - ${message}`);
        },
      });
      
      console.log(`[import] Extraction complete: ${extractedCount} files extracted, ${filteredCount} filtered`);
      
      // Cleanup temp file
      fs.rmSync(tmpFile, { force: true });
      
      // Restart gateway to load imported config
      console.log("[import] Restarting gateway...");
      try {
        await restartGateway();
        console.log("[import] Gateway restarted successfully");
      } catch (err) {
        console.error(`[import] Gateway restart failed: ${err}`);
        return res.status(500).json({
          ok: false,
          error: `Import succeeded but gateway restart failed: ${String(err)}`,
        });
      }
      
      return res.json({
        ok: true,
        message: `Import successful: ${extractedCount} files extracted, ${filteredCount} filtered`,
      });
      
    } catch (err) {
      // Cleanup temp file on error
      try {
        fs.rmSync(tmpFile, { force: true });
      } catch {}
      
      throw err;
    }
    
  } catch (err) {
    console.error("[import] Error:", err);
    return res.status(500).json({
      ok: false,
      error: `Import failed: ${String(err)}`,
    });
  }
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  // Minimal reset: delete the config file so /setup can rerun.
  // Keep credentials/sessions/workspace by default.
  try {
    // Stop gateway before deleting config to prevent race conditions
    // (gateway may try to read/write config during shutdown)
    console.log("[reset] Stopping gateway before config deletion...");
    if (gatewayProc) {
      try {
        gatewayProc.kill("SIGTERM");
        gatewayProc = null;
      } catch (err) {
        console.warn(`[reset] Failed to stop gateway: ${err.message}`);
      }
    }
    
    // Also pkill any orphaned gateway processes
    try {
      await runCmd("pkill", ["-f", "gateway run"], { timeoutMs: 5000 });
    } catch {
      // Ignore pkill errors (process may not exist)
    }
    
    // Wait for gateway to fully stop
    await sleep(1000);
    
    console.log("[reset] Deleting config file...");
    fs.rmSync(configPath(), { force: true });
    
    res
      .type("text/plain")
      .send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

// ========== FAST AUTH GROUPS ENDPOINT ==========

/**
 * GET /setup/api/auth-groups - Fast auth groups loading
 * Returns auth groups without running expensive openclaw commands
 */
app.get("/setup/api/auth-groups", requireSetupAuth, async (_req, res) => {
  try {
    return res.json({
      ok: true,
      authGroups: AUTH_GROUPS,
    });
  } catch (err) {
    console.error("[/setup/api/auth-groups] error:", err);
    return res.status(500).json({
      ok: false,
      error: `Internal error: ${String(err)}`,
    });
  }
});

app.get("/setup/export", requireSetupAuth, async (_req, res) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader("content-type", "application/gzip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="openclaw-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz"`,
  );

  // Prefer exporting from a common /data root so archives are easy to inspect and restore.
  // This preserves dotfiles like /data/.openclaw/openclaw.json.
  const stateAbs = path.resolve(STATE_DIR);
  const workspaceAbs = path.resolve(WORKSPACE_DIR);

  const dataRoot = "/data";
  const underData = (p) => p === dataRoot || p.startsWith(dataRoot + path.sep);

  let cwd = "/";
  let paths = [stateAbs, workspaceAbs].map((p) => p.replace(/^\//, ""));

  if (underData(stateAbs) && underData(workspaceAbs)) {
    cwd = dataRoot;
    // We export relative to /data so the archive contains: .openclaw/... and workspace/...
    paths = [
      path.relative(dataRoot, stateAbs) || ".",
      path.relative(dataRoot, workspaceAbs) || ".",
    ];
  }

  const stream = tar.c(
    {
      gzip: true,
      portable: true,
      noMtime: true,
      cwd,
      onwarn: () => {},
    },
    paths,
  );

  stream.on("error", (err) => {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });

  stream.pipe(res);
});

// Proxy everything else to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
});

// Prevent proxy errors from crashing the wrapper.
// Common errors: ECONNREFUSED (gateway not ready), ECONNRESET (client disconnect).
proxy.on("error", (err, req, res) => {
  console.error("[proxy] error:", err.message, `(${req?.method} ${req?.url})`);
  
  // Only send error response if headers haven't been sent yet
  if (res && !res.headersSent) {
    try {
      const troubleshooting = [
        `Proxy error: ${err.message}`,
        "",
        "Gateway may not be ready or has crashed.",
        "",
        "Troubleshooting:",
        "- Visit /healthz for gateway status",
        "- Visit /setup/api/debug for full diagnostics",
        "- Check Debug Console in /setup",
        "- Run 'gateway.restart' in Debug Console",
      ].join("\n");
      
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(troubleshooting);
    } catch {
      // Response already partially sent, can't recover
    }
  }
  
  // Don't throw - just log and continue
});

// Inject auth token into HTTP proxy requests
proxy.on("proxyReq", (proxyReq, req, res) => {
  debug(`[proxy] HTTP ${req.method} ${req.url} - injecting token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
  proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
});

// Log WebSocket upgrade proxy events (token is injected via headers option in server.on("upgrade"))
proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
  console.log(`[proxy-event] WebSocket proxyReqWs event fired for ${req.url}`);
  console.log(`[proxy-event] Headers:`, JSON.stringify(proxyReq.getHeaders()));
});

app.use(async (req, res) => {
  // If not configured, force users to /setup for any non-setup routes.
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  if (isConfigured()) {
    try {
      await ensureGatewayRunning();
    } catch (err) {
      // Provide helpful troubleshooting hints with actionable steps
      const errorMsg = [
        "Gateway not ready.",
        "",
        `Error: ${String(err)}`,
        "",
        "Troubleshooting:",
        "- Visit /setup and check the Debug Console",
        "- Run 'openclaw doctor' in Debug Console to diagnose issues",
        "- Visit /setup/api/debug for full diagnostics",
        "- Check /healthz for gateway status and reachability",
        "- Visit /setup Config Editor to verify openclaw.json is valid",
        "",
        "Recent gateway diagnostics:",
        lastGatewayError ? `  Last error: ${lastGatewayError}` : "",
        lastGatewayExit ? `  Last exit: code=${lastGatewayExit.code} signal=${lastGatewayExit.signal} at=${lastGatewayExit.at}` : "",
        "",
        lastDoctorOutput ? `Doctor output (last 500 chars):\n${lastDoctorOutput.slice(0, 500)}` : "Run 'openclaw doctor' in Debug Console for detailed diagnostics",
      ]
        .filter(Boolean)
        .join("\n");
      
      return res.status(503).type("text/plain").send(errorMsg);
    }
  }

  // Proxy to gateway (auth token injected via proxyReq event)
  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

// Create HTTP server from Express app
const server = app.listen(PORT, async () => {
  console.log(`[wrapper] listening on port ${PORT}`);
  console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
  console.log(`[wrapper] configured: ${isConfigured()}`);

  // Harden state dir for OpenClaw and avoid missing credentials dir on fresh volumes.
  try {
    fs.mkdirSync(path.join(STATE_DIR, "credentials"), { recursive: true, mode: 0o700 });
  } catch {}
  try {
    fs.chmodSync(STATE_DIR, 0o700);
  } catch {}
  try {
    fs.chmodSync(path.join(STATE_DIR, "credentials"), 0o700);
  } catch {}

  // Auto-start the gateway if already configured so polling channels (Telegram/Discord/etc.)
  // work even if nobody visits the web UI.
  if (isConfigured()) {
    console.log("[wrapper] config detected; starting gateway...");
    try {
      await ensureGatewayRunning();
      console.log("[wrapper] gateway ready");
    } catch (err) {
      console.error(`[wrapper] gateway failed to start at boot: ${String(err)}`);
    }
  }
});

// Handle WebSocket upgrades
server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }
  try {
    await ensureGatewayRunning();
  } catch {
    socket.destroy();
    return;
  }

  // Inject auth token via headers option (req.headers modification doesn't work for WS)
  debug(`[ws-upgrade] Proxying WebSocket upgrade with token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);

  proxy.ws(req, socket, head, {
    target: GATEWAY_TARGET,
    headers: {
      Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
    },
  });
});

// Graceful shutdown handler for Railway deployments
process.on("SIGTERM", async () => {
  console.log("[shutdown] Received SIGTERM, starting graceful shutdown...");
  
  // Close HTTP server (stops accepting new connections)
  server.close(() => {
    console.log("[shutdown] HTTP server closed");
  });
  
  // Stop gateway process
  if (gatewayProc) {
    console.log("[shutdown] Stopping gateway process...");
    try {
      gatewayProc.kill("SIGTERM");
      gatewayProc = null;
    } catch (err) {
      console.error(`[shutdown] Failed to stop gateway: ${err.message}`);
    }
  }
  
  // Give in-flight requests time to complete (Railway allows ~10s)
  // Wait up to 5 seconds for graceful shutdown
  setTimeout(() => {
    console.log("[shutdown] Graceful shutdown timeout, forcing exit");
    process.exit(0);
  }, 5000);
  
  // If all connections close naturally, exit immediately
  server.on("close", () => {
    console.log("[shutdown] All connections closed, exiting cleanly");
    process.exit(0);
  });
});
