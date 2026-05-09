#!/bin/sh
set -e

# crond does not inherit Docker env vars; dump them so run-sync.sh can source them
printenv > /etc/environment

exec crond -f -L /dev/stdout
