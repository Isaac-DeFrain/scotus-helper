export UID := $(shell id -u)
export GID := $(shell id -g)
export GIT_COMMIT := $(shell git rev-parse HEAD 2>/dev/null || echo dev)

COMPOSE := docker compose

.PHONY: up-prod down-prod up down build logs scrape upload inspect test-nginx help

help:
	@echo "Usage: make <target>"
	@echo "Targets:"
	@echo "  up-prod - Start the full stack (build if needed)"
	@echo "  down-prod - Stop and remove containers"
	@echo "  up - Start the full stack (build if needed)"
	@echo "  down - Stop and remove containers"
	@echo "  build - Build all images"
	@echo "  logs - Tail logs for a service: make logs SERVICE=cron"
	@echo "  scrape - Scrape opinions into SQLite"
	@echo "  upload - Upload opinion chunks to Weaviate"
	@echo "  inspect - Inspect Weaviate health and collection counts"
	@echo "  test-nginx - Validate nginx config syntax and assert runtime behaviours (CONFIG=dev|prod)"
	@echo "  help - Show this help message"

## Production

## Start the full prod stack (build if needed) in detached mode
up-prod:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml up -d --build

## Stop and remove prod containers
down-prod:
	$(COMPOSE) -f docker-compose.yml -f docker-compose.prod.yml down

## Development

## Start the full dev stack (build if needed)
up:
	$(COMPOSE) up --build

## Stop and remove dev containers
down:
	$(COMPOSE) down

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

## Validate nginx config syntax and assert runtime behaviours
## CONFIG selects the config to check and the checks to run: dev (default) or prod
CONFIG ?= dev
test-nginx:
	@echo "==> Checking nginx/$(CONFIG).conf syntax..."
ifeq ($(CONFIG),prod)
	@TMPDIR=$$(mktemp -d) && \
		trap "rm -rf $$TMPDIR" EXIT && \
		openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
			-keyout $$TMPDIR/cloudflare.key.pem \
			-out    $$TMPDIR/cloudflare.cert.pem \
			-subj "/CN=localhost" -quiet 2>/dev/null && \
		docker run --rm \
			-v $(PWD)/nginx/$(CONFIG).conf:/etc/nginx/nginx.conf:ro \
			-v $$TMPDIR:/etc/nginx/certs:ro \
			nginx:1.31-alpine nginx -t
else
	@docker run --rm \
		-v $(PWD)/nginx/$(CONFIG).conf:/etc/nginx/nginx.conf:ro \
		nginx:1.31-alpine nginx -t
endif
	@echo ""
ifeq ($(CONFIG),prod)
	@echo "==> Running prod behavioural checks (config must be up: make prod-up)..."
	@echo -n "  HTTP->HTTPS redirect (301): " && \
		STATUS=$$(curl -sIo /dev/null -w "%{http_code}" http://localhost/) && \
		[ "$$STATUS" = "301" ] && echo "PASS ($$STATUS)" || echo "FAIL ($$STATUS)"
	@echo -n "  HTTPS proxy pass to app (2xx): " && \
		STATUS=$$(curl -skIo /dev/null -w "%{http_code}" https://localhost/) && \
		echo "$$STATUS" | grep -qE "^2" && echo "PASS ($$STATUS)" || echo "FAIL ($$STATUS)"
	@echo -n "  HSTS header: " && \
		curl -skI https://localhost/ | grep -qi "strict-transport-security" && echo "PASS" || echo "FAIL"
	@echo -n "  X-Frame-Options header: " && \
		curl -skI https://localhost/ | grep -qi "x-frame-options" && echo "PASS" || echo "FAIL"
	@echo -n "  X-Content-Type-Options header: " && \
		curl -skI https://localhost/ | grep -qi "x-content-type-options" && echo "PASS" || echo "FAIL"
	@echo -n "  X-Request-Id header: " && \
		curl -skI https://localhost/ | grep -qi "x-request-id" && echo "PASS" || echo "FAIL"
	@echo -n "  Gzip encoding: " && \
		curl -skH "Accept-Encoding: gzip" -I https://localhost/ | grep -qi "content-encoding: gzip" && echo "PASS" || echo "FAIL"
else
	@echo "==> Running dev behavioural checks (config must be up: make up)..."
	@echo -n "  HTTP proxy pass to app (2xx): " && \
		STATUS=$$(curl -sIo /dev/null -w "%{http_code}" http://localhost/) && \
		echo "$$STATUS" | grep -qE "^2" && echo "PASS ($$STATUS)" || echo "FAIL ($$STATUS)"
	@echo -n "  X-Request-Id header: " && \
		curl -sI http://localhost/ | grep -qi "x-request-id" && echo "PASS" || echo "FAIL"
	@echo -n "  Gzip encoding: " && \
		curl -sH "Accept-Encoding: gzip" -I http://localhost/ | grep -qi "content-encoding: gzip" && echo "PASS" || echo "FAIL"
endif
