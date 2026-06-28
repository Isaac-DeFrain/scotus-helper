#!/usr/bin/env bash
#
# Validate nginx configuration syntax and run runtime behavioural checks.
#
# Invoked by: make test-nginx [CONFIG=dev|prod]
#
# Syntax checks run offline via a throwaway nginx container. Behavioural checks
# curl the live stack on localhost, so the matching compose profile must already
# be running (make up for dev, make up-prod for prod).

set -euo pipefail

NGINX_IMAGE="nginx:1.31-alpine"

# dev  -> nginx/dev.conf  (plain HTTP on port 80)
# prod -> nginx/prod.conf (TLS termination, security headers, HTTP redirect)
CONFIG="${CONFIG:-dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCALHOST="http://localhost/"

# Print a labelled PASS/FAIL line for an arbitrary shell command.
check() {
  local label="$1"

  shift
  printf "  %s: " "$label"

  if "$@"; then
    echo "PASS"
    return 0
  fi

  echo "FAIL"
  return 1
}

# Assert curl returns an exact HTTP status code (e.g. 301 for HTTP->HTTPS redirect).
check_status() {
  local label="$1"
  local expected="$2"

  shift 2
  printf "  %s: " "$label"

  local status
  status="$("$@" -sIo /dev/null -w "%{http_code}")"

  if [ "$status" = "$expected" ]; then
    echo "PASS ($status)"
    return 0
  fi

  echo "FAIL ($status)"
  return 1
}

# Assert curl returns any 2xx status (proxy successfully reached the app).
check_status_2xx() {
  local label="$1"

  shift
  printf "  %s: " "$label"

  local status
  status="$("$@" -sIo /dev/null -w "%{http_code}")"

  if echo "$status" | grep -qE "^2"; then
    echo "PASS ($status)"
    return 0
  fi

  echo "FAIL ($status)"
  return 1
}

# Assert a response header is present (case-insensitive match on header name/value).
check_header() {
  local label="$1"
  local header="$2"

  shift 2
  printf "  %s: " "$label"

  if "$@" | grep -qi "$header"; then
    echo "PASS"
    return 0
  fi

  echo "FAIL"
  return 1
}

# Run `nginx -t` inside the official nginx image with the selected config mounted.
check_syntax() {
  echo "==> Checking nginx/${CONFIG}.conf syntax..."

  if [ "$CONFIG" = "prod" ]; then
    # prod.conf references TLS cert paths under /etc/nginx/certs. Mount ephemeral
    # self-signed certs so syntax validation succeeds without real Cloudflare keys.

    local tmpdir
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' EXIT

    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
      -keyout "$tmpdir/cloudflare.key.pem" \
      -out "$tmpdir/cloudflare.cert.pem" \
      -subj "/CN=localhost" -quiet 2>/dev/null

    docker run --rm \
      -v "$ROOT/nginx/${CONFIG}.conf:/etc/nginx/nginx.conf:ro" \
      -v "$tmpdir:/etc/nginx/certs:ro" \
      "$NGINX_IMAGE" nginx -t
  else
    docker run --rm \
      -v "$ROOT/nginx/${CONFIG}.conf:/etc/nginx/nginx.conf:ro" \
      "$NGINX_IMAGE" nginx -t
  fi
}

# Prod stack checks: TLS redirect, reverse proxy, security headers, and gzip.
run_prod_checks() {
  echo "==> Running prod behavioral checks (config must be up: make up-prod)..."
  local failed=0

  check_status "HTTP->HTTPS redirect (301)" "301" curl "$LOCALHOST" || failed=1
  check_status_2xx "HTTPS proxy pass to app (2xx)" curl -sk "$LOCALHOST" || failed=1
  check_header "HSTS header" "strict-transport-security" curl -skI "$LOCALHOST" || failed=1
  check_header "X-Frame-Options header" "x-frame-options" curl -skI "$LOCALHOST" || failed=1
  check_header "X-Content-Type-Options header" "x-content-type-options" curl -skI "$LOCALHOST" || failed=1
  check_header "X-Request-Id header" "x-request-id" curl -skI "$LOCALHOST" || failed=1
  check_header "Gzip encoding" "content-encoding: gzip" \
    curl -skH "Accept-Encoding: gzip" -I "$LOCALHOST" || failed=1

  return "$failed"
}

# Dev stack checks: plain HTTP proxy, request id propagation, and gzip.
run_dev_checks() {
  echo "==> Running dev behavioral checks (config must be up: make up)..."
  local failed=0

  check_status_2xx "HTTP proxy pass to app (2xx)" curl "$LOCALHOST" || failed=1
  check_header "X-Request-Id header" "x-request-id" curl -sI "$LOCALHOST" || failed=1
  check_header "Gzip encoding" "content-encoding: gzip" \
    curl -sH "Accept-Encoding: gzip" -I "$LOCALHOST" || failed=1

  return "$failed"
}

main() {
  if [ "$CONFIG" != "dev" ] && [ "$CONFIG" != "prod" ]; then
    echo "CONFIG must be dev or prod (got: $CONFIG)" >&2
    exit 1
  fi

  check_syntax
  echo ""

  if [ "$CONFIG" = "prod" ]; then
    run_prod_checks
  else
    run_dev_checks
  fi
}

main "$@"
