#!/bin/sh
set -e

# Start the Hocuspocus collab + API server in background
PORT=1234 npx tsx server/index.ts &

# Start Next.js on the Cloud Run port (8080)
PORT=8080 node server.js &

# Wait for either process to exit
wait -n
exit $?
