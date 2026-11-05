FROM node:22-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292

WORKDIR /app

ENV NODE_ENV=production \
    REDIS_REQUIRED=true \
    FAKE_AUTH_ENABLED=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8000
STOPSIGNAL SIGTERM
CMD ["node", "src/server.js"]
