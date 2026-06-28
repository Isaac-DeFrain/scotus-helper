#!/usr/bin/env bash

set -exo pipefail

# Pull the app image published by the Release workflow, then start nginx
docker compose -f docker-compose.yml -f docker-compose.prod.yml pull app
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d nginx

# Remove the unused containers
docker system prune --force
