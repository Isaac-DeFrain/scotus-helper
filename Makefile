export UID := $(shell id -u)
export GID := $(shell id -g)

COMPOSE := docker compose

.PHONY: prod-up prod-down up down build logs scrape upload inspect help

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  prod-up - Start the full stack (build if needed)"
	@echo "  prod-down - Stop and remove containers"
	@echo "  up - Start the full stack (build if needed)"
	@echo "  down - Stop and remove containers"
	@echo "  build - Build all images"
	@echo "  logs - Tail logs for a service: make logs SERVICE=cron"
	@echo "  scrape - Scrape opinions into SQLite"
	@echo "  upload - Upload opinion chunks to Weaviate"
	@echo "  inspect - Inspect Weaviate health and collection counts"
	@echo "  help - Show this help message"

## Production

## Start the full stack (build if needed) in detached mode
prod-up:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d --build

## Stop and remove containers
prod-down:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml down

## Development

## Start the full stack (build if needed)
up:
	$(COMPOSE) up --build

## Stop and remove containers
down:
	$(COMPOSE) down

## Build all images
build:
	$(COMPOSE) build

## Tail logs for a service: make logs SERVICE=cron
logs:
	$(COMPOSE) logs -f $(SERVICE)

## Scrape opinions into SQLite
scrape:
	$(COMPOSE) run --rm scrape

## Upload opinion chunks to Weaviate
upload:
	$(COMPOSE) run --rm upload

## Inspect Weaviate health and collection counts
inspect:
	$(COMPOSE) run --rm upload npm run inspect-weaviate
