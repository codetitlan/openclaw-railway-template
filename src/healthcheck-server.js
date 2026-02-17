/**
 * Dedicated Health Check Server
 * 
 * Runs on a separate port to provide deployment-time verification
 * without depending on the main application server.
 */

import http from 'http';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const HEALTH_CHECK_PORT = process.env.HEALTH_CHECK_PORT || 8888;
const HEALTH_CHECK_PATH = process.env.HEALTH_CHECK_PATH || '/health';

// Build metadata (injected at container build time)
const BUILD_DATE = process.env.BUILD_DATE || 'unknown';
const GIT_SHA = process.env.GIT_SHA || 'unknown';
const DEPLOYMENT_TIME = process.env.DEPLOYMENT_TIME || new Date().toISOString();

// Gateway configuration (from main app)
const GATEWAY_HOST = process.env.OPENCLAW_GATEWAY_HOST || 'localhost';
const GATEWAY_PORT = process.env.OPENCLAW_GATEWAY_PORT || 18789;

/**
 * Test connectivity to Gateway
 */
async function testGatewayHealth() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const req = http.request(
      {
        hostname: GATEWAY_HOST,
        port: GATEWAY_PORT,
        path: '/',
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        const latency = Date.now() - startTime;
        resolve({
          status: 'healthy',
          latency_ms: latency,
          status_code: res.statusCode,
        });
      }
    );

    req.on('error', (err) => {
      const latency = Date.now() - startTime;
      resolve({
        status: 'unreachable',
        latency_ms: latency,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Date.now() - startTime;
      resolve({
        status: 'timeout',
        latency_ms: latency,
        error: 'Gateway health check timed out',
      });
    });

    req.end();
  });
}

/**
 * Perform basic health checks
 */
async function performHealthChecks() {
  const checks = {
    gateway: await testGatewayHealth(),
  };

  return checks;
}

/**
 * Build health response
 */
async function buildHealthResponse() {
  const checks = await performHealthChecks();
  const gatewayHealthy = checks.gateway.status === 'healthy';
  const overallHealthy = gatewayHealthy;

  return {
    timestamp: new Date().toISOString(),
    status: overallHealthy ? 'healthy' : 'degraded',
    version: {
      git_sha: GIT_SHA,
      git_sha_short: GIT_SHA.substring(0, 7),
      build_date: BUILD_DATE,
      deployment_time: DEPLOYMENT_TIME,
    },
    environment: {
      node_env: process.env.NODE_ENV || 'development',
      gateway_host: GATEWAY_HOST,
      gateway_port: GATEWAY_PORT,
    },
    checks,
    uptime_seconds: process.uptime(),
    memory_usage_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

/**
 * Create and start health check server
 */
function startHealthCheckServer() {
  const server = http.createServer(async (req, res) => {
    // Log request
    console.log(`[HEALTH] ${req.method} ${req.url} from ${req.socket.remoteAddress}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    // Handle OPTIONS
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Handle HEAD
    if (req.method === 'HEAD') {
      if (req.url === HEALTH_CHECK_PATH || req.url === '/') {
        const health = await buildHealthResponse();
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.writeHead(statusCode);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }

    // Handle GET
    if (req.method === 'GET') {
      if (req.url === HEALTH_CHECK_PATH || req.url === '/') {
        const health = await buildHealthResponse();
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.writeHead(statusCode);
        res.end(JSON.stringify(health, null, 2));
      } else if (req.url === '/version') {
        // Simple version endpoint
        const response = {
          git_sha: GIT_SHA,
          git_sha_short: GIT_SHA.substring(0, 7),
          build_date: BUILD_DATE,
          deployment_time: DEPLOYMENT_TIME,
        };
        res.writeHead(200);
        res.end(JSON.stringify(response, null, 2));
      } else if (req.url === '/ping') {
        // Simple ping
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
      return;
    }

    // Method not allowed
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  });

  server.on('error', (err) => {
    console.error(`[HEALTH] Server error: ${err.message}`);
    process.exit(1);
  });

  server.listen(HEALTH_CHECK_PORT, '0.0.0.0', () => {
    console.log(`[HEALTH] Server listening on 0.0.0.0:${HEALTH_CHECK_PORT}`);
    console.log(`[HEALTH] Health check endpoint: http://0.0.0.0:${HEALTH_CHECK_PORT}${HEALTH_CHECK_PATH}`);
  });

  return server;
}

// Only start if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  startHealthCheckServer();
}

export { startHealthCheckServer, buildHealthResponse };
