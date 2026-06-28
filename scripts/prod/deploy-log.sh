#!/usr/bin/env bash
#
# Print the latest deploy-*.log in DEPLOY_LOG_DIR.
#
# Invoked by: make deploy-log [DEPLOY_LOG_DIR=deploy-logs]

set -euo pipefail

DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-deploy-logs}"

latest="$(ls -1 "${DEPLOY_LOG_DIR}"/deploy-*.log 2>/dev/null | sort | tail -1)"
if [ -z "$latest" ]; then
  echo "No deploy-*.log files found in ${DEPLOY_LOG_DIR}" >&2
  exit 1
fi

echo "--------------------------------"
echo "Latest deploy log: $latest"
echo "--------------------------------"
echo ""
cat "$latest"
