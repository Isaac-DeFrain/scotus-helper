# Host user/group for cron container file ownership (see docker-compose.yml).
export UID := $(shell id -u)
export GID := $(shell id -g)

# Baked into the app image at build time (shown in the UI footer).
export GIT_COMMIT := $(shell git rev-parse HEAD 2>/dev/null || echo unknown)

COMPOSE := docker compose

# STACK_* selects dev vs prod from the first goal after up/down/test-nginx/inspect
# (e.g. make up dev). Defaults to prod when omitted.
STACK_TARGETS := up down test-nginx inspect
STACK_GOALS := $(filter dev prod,$(filter-out $(STACK_TARGETS),$(MAKECMDGOALS)))
STACK_CONFIG := $(if $(firstword $(STACK_GOALS)),$(firstword $(STACK_GOALS)),dev)
STACK_COMPOSE_FILES := $(if $(filter prod,$(STACK_CONFIG)),-f docker-compose.yml -f docker-compose.prod.yml,)

.PHONY: up down build logs deploy-log scrape upload inspect test-nginx ci install-githooks uninstall-githooks prune help

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  up - Start the stack (build if needed): make up [dev|prod] (default: prod)"
	@echo "  down - Stop and remove containers: make down [dev|prod] (default: prod)"
	@echo "  prune - Remove unused Docker resources (stopped containers, networks, dangling images)"
	@echo "  build - Build all images"
	@echo "  logs - Print logs (nginx excluded): make logs [follow] [service...] [not service...]"
	@echo "  deploy-log - Print the latest deploy-*.log in DEPLOY_LOG_DIR (currently: $(DEPLOY_LOG_DIR))"
	@echo "  scrape - Scrape opinions into SQLite"
	@echo "  upload - Upload opinion chunks to Weaviate"
	@echo "  inspect - Inspect Weaviate health: make inspect [dev|prod] (default: dev)"
	@echo "  test-nginx - Validate nginx config: make test-nginx [dev|prod] (default: prod)"
	@echo "  ci - Run the same checks as GitHub Actions CI locally"
	@echo "  install-githooks - Enable the pre-commit hook (runs ci before each commit)"
	@echo "  uninstall-githooks - Disable the pre-commit hook"
	@echo "  help - Show this help message"

## Start the stack (build if needed); prod runs detached
up:
	$(COMPOSE) $(STACK_COMPOSE_FILES) up $(if $(filter prod,$(STACK_CONFIG)),-d,) --build

## Stop and remove containers
down:
	$(COMPOSE) $(STACK_COMPOSE_FILES) down

## Remove unused Docker resources (stopped containers, unused networks, dangling images)
prune:
	docker system prune --force

## Print the latest deploy log (deploy-YYYYMMDDHHMMSS.log) in DEPLOY_LOG_DIR
deploy-log:
	@DEPLOY_LOG_DIR=$(DEPLOY_LOG_DIR) $(PWD)/scripts/prod/deploy-log.sh

#
# General
#

COMPOSE_SERVICES := $(shell $(COMPOSE) config --services 2>/dev/null)
LOG_SERVICES := $(filter-out nginx,$(COMPOSE_SERVICES))
LOG_FOLLOW := $(if $(filter 1 true yes,$(FOLLOW)),1,$(filter follow --follow,$(MAKECMDGOALS)))
LOG_GOALS := $(filter-out logs follow --follow,$(MAKECMDGOALS))
LOG_EXCLUDE := $(shell set -- $(LOG_GOALS); while [ $$# -gt 0 ]; do if [ "$$1" = not ]; then shift; [ $$# -gt 0 ] && echo "$$1"; fi; shift; done)
LOG_INCLUDE := $(shell set -- $(LOG_GOALS); while [ $$# -gt 0 ]; do if [ "$$1" = not ]; then shift; shift; else echo "$$1"; shift; fi; done)
LOG_BASE := $(if $(LOG_INCLUDE),$(LOG_INCLUDE),$(LOG_SERVICES))
LOG_FINAL := $(filter-out $(LOG_EXCLUDE),$(LOG_BASE))

## Print logs (nginx excluded by default): make logs [follow] [service...] [not service...]
logs:
	$(COMPOSE) logs $(if $(LOG_FOLLOW),-f,) $(LOG_FINAL)

## Scrape opinions into SQLite
scrape:
	$(COMPOSE) run --rm scrape

## Upload opinion chunks to Weaviate
upload:
	$(COMPOSE) run --rm upload

## Inspect Weaviate health and collection counts
inspect:
	$(COMPOSE) $(STACK_COMPOSE_FILES) run --rm $(if $(filter prod,$(STACK_CONFIG)),--no-deps,) --entrypoint npm upload run inspect-weaviate

#
# Test
#

## Run the same checks as GitHub Actions CI locally
ci:
	@$(PWD)/scripts/ci-local.sh

## Validate nginx config syntax and assert runtime behaviours
test-nginx:
	@CONFIG=$(STACK_CONFIG) $(PWD)/scripts/test-nginx.sh

## Enable the pre-commit hook that runs ci before each commit
install-githooks:
	@$(PWD)/scripts/install-githooks.sh

## Disable the pre-commit hook
uninstall-githooks:
	@$(PWD)/scripts/uninstall-githooks.sh

#
# Stub targets
#

# When `make up dev`, `make inspect prod`, etc. is used, extra goals must not
# run their own recipes or match existing paths.
ifneq ($(filter $(STACK_TARGETS),$(MAKECMDGOALS)),)
.PHONY: dev prod $(filter-out $(STACK_TARGETS) dev prod,$(MAKECMDGOALS))
dev prod:
	@:
$(filter-out $(STACK_TARGETS) dev prod,$(MAKECMDGOALS)):
	@:
endif

# When `make logs follow cron` is used, extra goals must not run their real
# recipes (e.g. `scrape`) or match existing paths (e.g. `app/`).
ifeq ($(filter logs,$(MAKECMDGOALS)),logs)
.PHONY: follow --follow not $(filter-out logs follow --follow not,$(MAKECMDGOALS))
follow --follow not:
	@:
$(filter-out logs follow --follow not,$(MAKECMDGOALS)):
	@:
endif
