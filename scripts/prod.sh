#!/usr/bin/env bash

set -exo pipefail

# Build and run the latest version of the app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build nginx

# Remove the unused containers
docker system prune --force
