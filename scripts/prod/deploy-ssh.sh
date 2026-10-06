set -eo pipefail

cd scotus-helper
git fetch origin main
git reset --hard origin/main

DEPLOY_LOG_DIR="${DEPLOY_LOG_DIR:-deploy-logs}"
mkdir -p "$DEPLOY_LOG_DIR"

nohup ./scripts/prod/prod.sh > "$DEPLOY_LOG_DIR/deploy-${DATE}.log" 2>&1 &
