#!/bin/sh
set -e

# Source Docker environment variables dumped by cron-entrypoint.sh
set -a
. /etc/environment
set +a

cd /app
npm run scrape-opinions && npm run upload-opinions
