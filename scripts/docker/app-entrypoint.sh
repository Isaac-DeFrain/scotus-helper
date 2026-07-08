#!/bin/sh
set -e

# Docker named volumes mount as root-owned; fix ownership before dropping
# privileges so the app can create /app/chat-data/chat.db.
uid="${APP_UID:-1000}"
gid="${APP_GID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/chat-data
  chown -R "${uid}:${gid}" /app/chat-data
  exec su-exec "${uid}:${gid}" "$@"
fi

exec "$@"
