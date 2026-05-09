export UID := $(shell id -u)
export GID := $(shell id -g)

COMPOSE := docker compose

.PHONY: up down build logs scrape upload inspect

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
