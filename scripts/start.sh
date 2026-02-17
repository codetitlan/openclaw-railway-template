#!/bin/bash
# Start both main application and health check server in parallel

set -e

echo "🚀 Starting OpenClaw Railway Template"
echo "   Build: $GIT_SHA (built: $BUILD_DATE)"
echo "   Deployment: $DEPLOYMENT_TIME"
echo ""

# Start health check server in background
echo "📊 Starting health check server on port ${HEALTH_CHECK_PORT:-8888}..."
node src/healthcheck-server.js &
HEALTH_PID=$!

# Start main application server
echo "🌐 Starting main application server on port ${PORT:-8080}..."
node src/server.js &
MAIN_PID=$!

# Handle signals and cleanup
cleanup() {
  echo ""
  echo "⏹️  Shutting down servers..."
  kill $HEALTH_PID $MAIN_PID 2>/dev/null || true
  wait $HEALTH_PID $MAIN_PID 2>/dev/null || true
  echo "✓ Servers stopped"
  exit 0
}

trap cleanup SIGTERM SIGINT

# Wait for both processes
wait $HEALTH_PID $MAIN_PID
