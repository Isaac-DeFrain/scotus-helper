#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_PATH="$(git -C "$ROOT" config --get core.hooksPath 2>/dev/null || true)"

if [[ "$HOOKS_PATH" != ".githooks" ]]; then
  if [[ -z "$HOOKS_PATH" ]]; then
    echo "Git hooks are not installed (core.hooksPath is unset)."
  else
    echo "core.hooksPath is set to $HOOKS_PATH, not .githooks; leaving it unchanged."
  fi
  exit 0
fi

git -C "$ROOT" config --unset core.hooksPath
echo "Uninstalled git hooks (removed core.hooksPath=.githooks)"
