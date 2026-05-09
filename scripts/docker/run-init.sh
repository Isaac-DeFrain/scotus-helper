#!/bin/sh
set -e

# Source Docker environment variables when invoked from crond
if [ -f /etc/environment ]; then
  set -a
  . /etc/environment
  set +a
fi

cd /app
npm run scrape-opinions -- --all && npm run upload-opinions
