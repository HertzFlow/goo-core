# Goo Agent Core
# Economic sidecar + autonomous behavior layer
#
# Build:  docker build -t goo-core ./core
# Run:    docker run --env-file .env -v /opt/data:/opt/data goo-core

FROM node:22-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# ─── Production ───────────────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=builder /app/dist dist/

# Data directory for creator uploads (soul.md, agent.md, etc.)
RUN mkdir -p /opt/data
ENV DATA_DIR=/opt/data

# Non-root user for security (agent still has shell_execute with root)
# Keeping root because shell_execute needs it for VPS operations
USER root

ENTRYPOINT ["node", "dist/index.js"]
