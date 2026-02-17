#!/usr/bin/env node
/**
 * Smoke test for the dedicated health check endpoint
 * Tests that the healthcheck server starts and responds correctly
 */

import http from 'http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Configuration
const HEALTH_CHECK_PORT = process.env.HEALTH_CHECK_PORT || 8888;
const HEALTH_CHECK_PATH = process.env.HEALTH_CHECK_PATH || '/health';
const TIMEOUT = 10000; // 10 seconds to start up
const RETRY_INTERVAL = 200; // 200ms between retries

/**
 * Make HTTP request
 */
function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: HEALTH_CHECK_PORT,
        path,
        method: 'GET',
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            body: data,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Wait for server to be ready
 */
async function waitForServer(maxWait = TIMEOUT) {
  const startTime = Date.now();
  let lastError;

  while (Date.now() - startTime < maxWait) {
    try {
      const response = await makeRequest('/ping');
      if (response.status === 200) {
        return true;
      }
    } catch (err) {
      lastError = err;
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL));
  }

  throw new Error(`Server did not become ready within ${maxWait}ms: ${lastError?.message}`);
}

/**
 * Test the health check endpoint
 */
async function testHealthEndpoint() {
  console.log('Testing /health endpoint...');

  const response = await makeRequest(HEALTH_CHECK_PATH);

  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Expected status 200 or 503, got ${response.status}`);
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch (err) {
    throw new Error(`Invalid JSON response: ${response.body}`);
  }

  // Verify required fields
  const requiredFields = ['timestamp', 'status', 'version', 'checks'];
  for (const field of requiredFields) {
    if (!(field in body)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Verify version fields
  const versionFields = ['git_sha', 'git_sha_short', 'build_date', 'deployment_time'];
  for (const field of versionFields) {
    if (!(field in body.version)) {
      throw new Error(`Missing version field: ${field}`);
    }
  }

  // Verify checks
  if (!('gateway' in body.checks)) {
    throw new Error('Missing gateway health check');
  }

  console.log('✓ /health endpoint OK');
  console.log(`  Status: ${body.status}`);
  console.log(`  Git SHA: ${body.version.git_sha_short}`);
  console.log(`  Deployed: ${body.version.deployment_time}`);

  return body;
}

/**
 * Test the version endpoint
 */
async function testVersionEndpoint() {
  console.log('Testing /version endpoint...');

  const response = await makeRequest('/version');

  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch (err) {
    throw new Error(`Invalid JSON response: ${response.body}`);
  }

  const requiredFields = ['git_sha', 'git_sha_short', 'build_date', 'deployment_time'];
  for (const field of requiredFields) {
    if (!(field in body)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  console.log('✓ /version endpoint OK');

  return body;
}

/**
 * Test the ping endpoint
 */
async function testPingEndpoint() {
  console.log('Testing /ping endpoint...');

  const response = await makeRequest('/ping');

  if (response.status !== 200) {
    throw new Error(`Expected status 200, got ${response.status}`);
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch (err) {
    throw new Error(`Invalid JSON response: ${response.body}`);
  }

  if (body.status !== 'ok') {
    throw new Error(`Expected status 'ok', got ${body.status}`);
  }

  console.log('✓ /ping endpoint OK');

  return body;
}

/**
 * Test HEAD request
 */
async function testHeadRequest() {
  console.log('Testing HEAD request...');

  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: HEALTH_CHECK_PORT,
        path: HEALTH_CHECK_PATH,
        method: 'HEAD',
        timeout: 5000,
      },
      (res) => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.end();
  });

  if (response.status !== 200 && response.status !== 503) {
    throw new Error(`Expected status 200 or 503, got ${response.status}`);
  }

  console.log('✓ HEAD request OK');

  return response;
}

/**
 * Main test runner
 */
async function runTests() {
  console.log('🚀 Starting health check server...');

  // Start the health check server
  const server = spawn('node', ['src/healthcheck-server.js'], {
    cwd: __dirname + '/..',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      HEALTH_CHECK_PORT,
      HEALTH_CHECK_PATH,
    },
  });

  let serverError = '';
  server.stderr.on('data', (data) => {
    serverError += data.toString();
  });

  try {
    // Wait for server to be ready
    console.log(`Waiting for server on port ${HEALTH_CHECK_PORT}...`);
    await waitForServer();
    console.log('✓ Server is ready\n');

    // Run tests
    await testHealthEndpoint();
    await testVersionEndpoint();
    await testPingEndpoint();
    await testHeadRequest();

    console.log('\n✅ All health check smoke tests passed!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Smoke test failed:');
    console.error(`${err.message}`);

    if (serverError) {
      console.error('\nServer error output:');
      console.error(serverError);
    }

    process.exit(1);
  } finally {
    server.kill();
  }
}

// Run tests
runTests().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
