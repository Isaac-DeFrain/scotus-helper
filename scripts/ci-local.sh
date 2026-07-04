#!/usr/bin/env bash

# Mirrors the quality job in .github/workflows/ci.yml (the gate on push/PR).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run() {
  if [[ -f flake.nix ]] && command -v nix >/dev/null 2>&1; then
    nix develop -c "$@"
  else
    "$@"
  fi
}

step() {
  echo
  echo "==> ci-local: $1"
}

step "install dependencies (npm ci)"
run npm ci

step "audit (npm audit --audit-level=moderate)"
run npm audit --audit-level=moderate

step "lint (npm run lint)"
run npm run lint

step "typecheck (npm run check)"
run npm run check

step "test (npm test)"
run npm test

if [[ "${CI_LOCAL_DOCKER:-}" == "1" ]]; then
  step "docker build (Release workflow on main)"
  docker build \
    --build-arg "GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo unknown)" \
    -t scotus-helper:local \
    .
fi

echo
echo "ci-local: all checks passed"
