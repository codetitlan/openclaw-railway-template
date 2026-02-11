import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import express from "express";
import httpProxy from "http-proxy";
import * as tar from "tar";

// Railway commonly sets PORT=8080 for HTTP services.
const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
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
    console.log(`[token]   First 16 chars: ${envTok.slice(0, 16)}...`);
    console.log(`[token]   Full token: ${envTok}`);
    return envTok;
  }

  console.log(`[token] Env variable not available, checking persisted file...`);
  const tokenPath = path.join(STATE_DIR, "gateway.token");
  console.log(`[token] Token file path: ${tokenPath}`);

  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) {
      console.log(`[token] ✓ Using token from persisted file`);
      console.log(`[token]   First 16 chars: ${existing.slice(0, 8)}...`);
      return existing;
    }
  } catch (err) {
    console.log(`[token] Could not read persisted file: ${err.message}`);
  }

  const generated = crypto.randomBytes(32).toString("hex");
  console.log(`[token] ⚠️  Generating new random token (${generated.slice(0, 8)}...)`);
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
console.log(`[token] Final resolved token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
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

function configPath() {
  return (
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    path.join(STATE_DIR, "openclaw.json")
  );
}

function isConfigured() {
  try {
    return fs.existsSync(configPath());
  } catch {
    return false;
  }
}

let gatewayProc = null;
let gatewayStarting = null;
let tailscaleProc = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startTailscale() {
  const TAILSCALE_AUTH_KEY = (process.env.TAILSCALE_AUTH_KEY || "").trim();
  
  if (!TAILSCALE_AUTH_KEY) {
    console.log("[tailscale] TAILSCALE_AUTH_KEY not set, skipping Tailscale initialization");
    return { ok: false, reason: "no auth key" };
  }

  const isRoot = process.getuid?.() === 0;
  console.log(`[tailscale] Starting Tailscale daemon (running as ${isRoot ? 'root' : 'non-root'})...`);
  
  // Build command: use sudo if not root, otherwise run directly
  const tsCmd = isRoot ? "tailscaled" : "sudo";
  const tsArgs = isRoot ? ["-cleanup=false"] : ["tailscaled", "-cleanup=false"];
  
  // Start tailscaled daemon
  tailscaleProc = childProcess.spawn(tsCmd, tsArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  tailscaleProc.on("error", (err) => {
    console.error(`[tailscale] tailscaled spawn error: ${String(err)}`);
  });

  tailscaleProc.stderr?.on("data", (d) => {
    console.log(`[tailscale] daemon stderr: ${d.toString("utf8").trim()}`);
  });

  tailscaleProc.stdout?.on("data", (d) => {
    console.log(`[tailscale] daemon stdout: ${d.toString("utf8").trim()}`);
  });

  // Give daemon time to start
  await sleep(2000);

  console.log("[tailscale] Bringing up Tailscale with auth key...");
  
  const upCmd = isRoot ? "tailscale" : "sudo";
  const upArgs = isRoot 
    ? ["up", "--auth-key", TAILSCALE_AUTH_KEY, "--tun=userspace", "--accept-routes=true", "--accept-dns=false", "--advertise-exit-node=false"]
    : ["tailscale", "up", "--auth-key", TAILSCALE_AUTH_KEY, "--tun=userspace", "--accept-routes=true", "--accept-dns=false", "--advertise-exit-node=false"];
  
  const tailscaleUp = await runCmd(upCmd, upArgs);

  if (tailscaleUp.code !== 0) {
    console.error(`[tailscale] tailscale up failed with code ${tailscaleUp.code}:`);
    console.error(tailscaleUp.output);
    return { ok: false, reason: "tailscale up failed" };
  }

  // Get Tailscale status
  const statusCmd = isRoot ? "tailscale" : "sudo";
  const statusArgs = isRoot ? ["status"] : ["tailscale", "status"];
  const status = await runCmd(statusCmd, statusArgs);
  console.log("[tailscale] Status:");
  console.log(status.output);

  console.log("[tailscale] ✓ Tailscale initialized successfully");
  return { ok: true };
}


async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const start = Date.now();
  const endpoints = ["/openclaw", "/openclaw", "/", "/health"];
  
  while (Date.now() - start < timeoutMs) {
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${GATEWAY_TARGET}${endpoint}`, { method: "GET" });
        // Any HTTP response means the port is open.
        if (res) {
          console.log(`[gateway] ready at ${endpoint}`);
          return true;
        }
      } catch (err) {
        // not ready, try next endpoint
      }
    }
    await sleep(250);
  }
  console.error(`[gateway] failed to become ready after ${timeoutMs}ms`);
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
  console.log(`[gateway] Syncing wrapper token to config: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);

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
  }

  // Verify sync succeeded
  try {
    const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const configToken = config?.gateway?.auth?.token;

    console.log(`[gateway] Token verification:`);
    console.log(`[gateway]   Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
    console.log(`[gateway]   Config:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`);

    if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
      console.error(`[gateway] ✗ Token mismatch detected!`);
      console.error(`[gateway]   Full wrapper: ${OPENCLAW_GATEWAY_TOKEN}`);
      console.error(`[gateway]   Full config:  ${configToken || 'null'}`);
      throw new Error(
        `Token mismatch: wrapper has ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... but config has ${(configToken || 'null')?.slice?.(0, 16)}...`
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
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;
  });
}

async function ensureGatewayRunning() {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway();
      const ready = await waitForGatewayReady({ timeoutMs: 20_000 });
      if (!ready) {
        throw new Error("Gateway did not become ready in time");
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
    console.log("[gateway] Killing wrapper-managed gateway process");
    try {
      gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    gatewayProc = null;
  }

  // Also kill any other gateway processes (e.g., started by onboard command)
  // by finding processes listening on the gateway port
  console.log(`[gateway] Killing any other gateway processes on port ${INTERNAL_GATEWAY_PORT}`);
  try {
    const killResult = await runCmd("pkill", ["-f", "openclaw-gateway"]);
    console.log(`[gateway] pkill result: exit code ${killResult.code}`);
  } catch (err) {
    console.log(`[gateway] pkill failed: ${err.message}`);
  }

  // Give processes time to exit and release the port
  await sleep(1500);

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

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Health state tracking for Railway healthchecks.
let healthState = "starting";
let lastHealthState = null;

function logHealthTransition(newState, detail) {
  if (newState !== lastHealthState) {
    console.log(`[health] ${lastHealthState || "init"} → ${newState}${detail ? ` (${detail})` : ""}`);
    lastHealthState = newState;
  }
}

app.get("/setup/healthz", (_req, res) => {
  const configured = isConfigured();
  const gatewayUp = !!gatewayProc;
  const healthy = true; // wrapper is up, that's enough for Railway

  const state = configured ? (gatewayUp ? "healthy" : "degraded") : "setup-pending";
  logHealthTransition(state, `configured=${configured} gateway=${gatewayUp}`);

  res.json({ ok: healthy, state, configured, gateway: gatewayUp });
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
  const version = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
  const channelsHelp = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["channels", "add", "--help"]),
  );

  // We reuse Openclaw's own auth-choice grouping logic indirectly by hardcoding the same group defs.
  // This is intentionally minimal; later we can parse the CLI help output to stay perfectly in sync.
  const authGroups = [
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

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    openclawVersion: version.output.trim(),
    channelsAddHelp: channelsHelp.output,
    authGroups,
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

function runCmd(cmd, args, opts = {}) {
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
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
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

    // DIAGNOSTIC: Log token we're passing to onboard
    console.log(`[onboard] ========== TOKEN DIAGNOSTIC START ==========`);
    console.log(`[onboard] Wrapper token (from env/file/generated): ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (length: ${OPENCLAW_GATEWAY_TOKEN.length})`);
    console.log(`[onboard] Onboard command args include: --gateway-token ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
    console.log(`[onboard] Full onboard command: node ${clawArgs(onboardArgs).join(' ').replace(OPENCLAW_GATEWAY_TOKEN, OPENCLAW_GATEWAY_TOKEN.slice(0, 16) + '...')}`);

    const onboard = await runCmd(OPENCLAW_NODE, clawArgs(onboardArgs));

    let extra = "";

    const ok = onboard.code === 0 && isConfigured();

    // DIAGNOSTIC: Check what token onboard actually wrote to config
    if (ok) {
      try {
        const configAfterOnboard = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        const tokenAfterOnboard = configAfterOnboard?.gateway?.auth?.token;
        console.log(`[onboard] Token in config AFTER onboard: ${tokenAfterOnboard?.slice(0, 16)}... (length: ${tokenAfterOnboard?.length || 0})`);
        console.log(`[onboard] Token match: ${tokenAfterOnboard === OPENCLAW_GATEWAY_TOKEN ? '✓ MATCHES' : '✗ MISMATCH!'}`);
        if (tokenAfterOnboard !== OPENCLAW_GATEWAY_TOKEN) {
          console.log(`[onboard] ⚠️  PROBLEM: onboard command ignored --gateway-token flag and wrote its own token!`);
          extra += `\n[WARNING] onboard wrote different token than expected\n`;
          extra += `  Expected: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
          extra += `  Got:      ${tokenAfterOnboard?.slice(0, 16)}...\n`;
        }
      } catch (err) {
        console.error(`[onboard] Could not check config after onboard: ${err}`);
      }
    }

    // Optional channel setup (only after successful onboarding, and only if the installed CLI supports it).
    if (ok) {
      // Ensure gateway token is written into config so the browser UI can authenticate reliably.
      // (We also enforce loopback bind since the wrapper proxies externally.)
      console.log(`[onboard] Now syncing wrapper token to config (${OPENCLAW_GATEWAY_TOKEN.slice(0, 8)}...)`);

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
        console.log(`[onboard]   Wrapper token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
        console.log(`[onboard]   Config token:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`);

        if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
          console.error(`[onboard] ✗ ERROR: Token mismatch after config set!`);
          console.error(`[onboard]   Full wrapper token: ${OPENCLAW_GATEWAY_TOKEN}`);
          console.error(`[onboard]   Full config token:  ${configToken || 'null'}`);
          extra += `\n[ERROR] Token verification failed! Config has different token than wrapper.\n`;
          extra += `  Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
          extra += `  Config:  ${configToken?.slice(0, 16)}...\n`;
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

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
  const help = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["channels", "add", "--help"]),
  );
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
  });
});

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

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  // Minimal reset: delete the config file so /setup can rerun.
  // Keep credentials/sessions/workspace by default.
  try {
    fs.rmSync(configPath(), { force: true });
    res
      .type("text/plain")
      .send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
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

proxy.on("error", (err, _req, _res) => {
  console.error("[proxy]", err);
});

// Inject auth token into HTTP proxy requests
proxy.on("proxyReq", (proxyReq, req, res) => {
  console.log(`[proxy] HTTP ${req.method} ${req.url} - injecting token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
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
      return res
        .status(503)
        .type("text/plain")
        .send(`Gateway not ready: ${String(err)}`);
    }
  }

  // Proxy to gateway (auth token injected via proxyReq event)
  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

// Start Tailscale before listening
(async () => {
  const ts = await startTailscale();
  if (!ts.ok) {
    console.warn("[wrapper] Tailscale initialization failed, continuing without it");
  }

  // Create HTTP server from Express app
  const server = app.listen(PORT, () => {
    console.log(`[wrapper] listening on port ${PORT}`);
    console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
    console.log(`[wrapper] configured: ${isConfigured()}`);
    
    if (ts.ok) {
      console.log(`[wrapper] ✓ Tailscale is active - Control UI accessible via Tailscale`);
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
    console.log(`[ws-upgrade] Proxying WebSocket upgrade with token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);

    proxy.ws(req, socket, head, {
      target: GATEWAY_TARGET,
      headers: {
        Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      },
    });
  });

  process.on("SIGTERM", () => {
    // Best-effort shutdown
    try {
      if (gatewayProc) gatewayProc.kill("SIGTERM");
    } catch {
      // ignore
    }
    process.exit(0);
  });
})();
