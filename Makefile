export UID := $(shell id -u)
export GID := $(shell id -g)
export GIT_COMMIT := $(shell git rev-parse HEAD 2>/dev/null || echo unknown)

COMPOSE := docker compose

.PHONY: up-prod down-prod up down build logs deploy-log scrape upload inspect test-nginx ci install-githooks uninstall-githooks help

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  up-prod - Start the full stack (build if needed)"
	@echo "  down-prod - Stop and remove containers"
	@echo "  up - Start the full stack (build if needed)"
	@echo "  down - Stop and remove containers"
	@echo "  build - Build all images"
	@echo "  logs - Print logs (nginx excluded): make logs [service...] | make -- logs --follow [service...]"
	@echo "  deploy-log - Print the latest deploy-*.log in DEPLOY_LOG_DIR (default: deploy-logs)"
	@echo "  scrape - Scrape opinions into SQLite"
	@echo "  upload - Upload opinion chunks to Weaviate"
	@echo "  inspect - Inspect Weaviate health and collection counts"
	@echo "  test-nginx - Validate nginx config syntax and assert runtime behaviours (CONFIG=dev|prod)"
	@echo "  ci - Run the same checks as GitHub Actions CI locally"
	@echo "  install-githooks - Enable the pre-commit hook (runs ci before each commit)"
	@echo "  uninstall-githooks - Disable the pre-commit hook"
	@echo "  help - Show this help message"

#
# Prod
#

## Start the full prod stack (build if needed) in detached mode
up-prod:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d --build

## Stop and remove prod containers
down-prod:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml down

DEPLOY_LOG_DIR ?= deploy-logs

## Print the latest deploy log (deploy-YYYYMMDDHHMMSS.log) in DEPLOY_LOG_DIR
deploy-log:
	@DEPLOY_LOG_DIR=$(DEPLOY_LOG_DIR) $(PWD)/scripts/prod/deploy-log.sh

#
# Dev
#

## Start the full dev stack (build if needed)
up:
	$(COMPOSE) up --build

## Stop and remove dev containers
down:
	$(COMPOSE) down

#
# General
#

COMPOSE_SERVICES := $(shell $(COMPOSE) config --services 2>/dev/null)
LOG_SERVICES := $(filter-out nginx,$(COMPOSE_SERVICES))
LOG_FOLLOW := $(filter follow --follow,$(MAKECMDGOALS))
LOG_TARGETS := $(filter-out logs follow --follow,$(MAKECMDGOALS))

## Print logs (nginx excluded by default): make logs [service...]; add --follow to tail
logs:
	$(COMPOSE) logs $(if $(LOG_FOLLOW),-f,) $(if $(LOG_TARGETS),$(LOG_TARGETS),$(LOG_SERVICES))

## Scrape opinions into SQLite
scrape:
	$(COMPOSE) run --rm scrape

## Upload opinion chunks to Weaviate
upload:
	$(COMPOSE) run --rm upload

CONFIG ?= prod
COMPOSE_FILES := $(if $(filter prod,$(CONFIG)),-f docker-compose.yml -f docker-compose.prod.yml,)

## Inspect Weaviate health and collection counts
inspect:
	$(COMPOSE) $(COMPOSE_FILES) run --rm $(if $(filter prod,$(CONFIG)),--no-deps,) --entrypoint npm upload run inspect-weaviate

#
# Test
#

## Run the same checks as GitHub Actions CI locally
ci:
	@$(PWD)/scripts/ci-local.sh

## Enable the pre-commit hook that runs ci before each commit
install-githooks:
	@$(PWD)/scripts/install-githooks.sh

## Disable the pre-commit hook
uninstall-githooks:
	@$(PWD)/scripts/uninstall-githooks.sh

## Validate nginx config syntax and assert runtime behaviours (CONFIG=dev|prod)
test-nginx:
	@CONFIG=$(CONFIG) $(PWD)/scripts/test-nginx.sh

# When `make logs cron app` is used, extra goals must not run their real recipes
# (e.g. `scrape`) or match existing paths (e.g. `app/`). Stubs are appended last.
ifeq ($(filter logs,$(MAKECMDGOALS)),logs)
.PHONY: follow --follow $(filter-out logs follow --follow,$(MAKECMDGOALS))
follow --follow:
	@:
$(filter-out logs follow --follow,$(MAKECMDGOALS)):
	@:
endif
