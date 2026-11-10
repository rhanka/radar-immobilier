# UIDFIX-EX1: e2e runner image. Stock node:24-bookworm-slim plus the
# Chromium system libraries Playwright needs, baked at build time
# because the runner container now runs as the host user (no root, so
# `playwright install --with-deps` can no longer apt-get at runtime).
# The browser itself is still downloaded by the runner into
# PLAYWRIGHT_BROWSERS_PATH (/tmp/ms-playwright, see
# docker-compose.e2e.yml).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libdbus-1-3 libxkbcommon0 libatspi2.0-0 libxcomposite1 libxdamage1 \
      libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*
