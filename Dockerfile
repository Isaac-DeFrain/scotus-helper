FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

# ---- builder ----
FROM node:22-alpine AS builder

ARG GIT_COMMIT=unknown

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT=$GIT_COMMIT

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ---- runner ----
FROM node:22-alpine AS runner

ARG GIT_COMMIT=unknown
# Match host UID/GID (see docker-compose.yml / Makefile) so the app can write
# to the bind-mounted ./data volume.
ARG UID=1000
ARG GID=1000

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV GIT_COMMIT=$GIT_COMMIT

RUN apk add --no-cache su-exec

RUN set -eux; \
    existing_group="$(getent group "${GID}" | cut -d: -f1 || true)"; \
    if [ -n "${existing_group}" ]; then \
      group_name="${existing_group}"; \
    else \
      addgroup -g "${GID}" appgroup; \
      group_name=appgroup; \
    fi; \
    if ! getent passwd "${UID}" >/dev/null; then \
      adduser -D -u "${UID}" -G "${group_name}" appuser; \
    fi

COPY --from=builder --chown=${UID}:${GID} /app/.next/standalone ./
COPY --from=builder --chown=${UID}:${GID} /app/.next/static ./.next/static
COPY --from=builder --chown=${UID}:${GID} /app/public ./public

COPY scripts/docker/app-entrypoint.sh /app/scripts/docker/app-entrypoint.sh
RUN chmod +x /app/scripts/docker/app-entrypoint.sh

ENV APP_UID=${UID}
ENV APP_GID=${GID}

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["/app/scripts/docker/app-entrypoint.sh"]
CMD ["node", "server.js"]
