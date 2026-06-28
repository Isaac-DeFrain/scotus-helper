#!/usr/bin/env bash
#
# Start a background deployment on the VPS via SSH.
#
# Invoked by: .github/workflows/deploy.yml
#
# Required environment variables:
#   VPS_SSH_USERNAME - SSH user on the VPS
#   VPS_IP           - VPS host address
#
# Optional:
#   VPS_SSH_KEY - Path to the SSH private key (default: vps_key.pem in cwd)

set -euo pipefail

SSH_KEY="${VPS_SSH_KEY:-vps_key.pem}"
VPS_SSH_USERNAME="${VPS_SSH_USERNAME:?VPS_SSH_USERNAME is required}"
VPS_IP="${VPS_IP:?VPS_IP is required}"

DATE=$(date "+%Y%m%d%H%M%S")
SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_DEPLOY_SCRIPT="${SCRIPTS_DIR}/deploy-ssh.sh"

ssh -i "$SSH_KEY" "${VPS_SSH_USERNAME}@${VPS_IP}" env DATE="$DATE" bash -s < "${SSH_DEPLOY_SCRIPT}"
