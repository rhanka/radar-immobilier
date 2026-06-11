# Production image for the radar API. Dev/test run node:24 with the repo
# mounted (see docker-compose.dev/test); this image is for e2e and K8s.

FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/radar-domain/package.json packages/radar-domain/
COPY api/package.json api/
RUN npm install --workspaces --include-workspace-root
COPY packages/radar-domain packages/radar-domain
COPY api api
RUN npm run build --workspace=api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
# poppler-utils ships `pdftotext`, which the live-scrape worker shells out to in
# order to extract the text layer of every PV PDF (see
# packages/radar-sources/.../reglements-urbanisme-valleyfield.ts `pdfToTextViaPoppler`).
# Without it the worker silently yields empty text → 0 signal on real PDFs.
# ~2 MB; keep the image slim by clearing the apt lists afterwards.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils \
 && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 1001 radar \
 && useradd --system --uid 1001 --gid radar radar
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/packages/radar-domain ./packages/radar-domain
COPY --from=build /workspace/api/dist ./api/dist
COPY --from=build /workspace/api/package.json ./api/package.json
USER radar
EXPOSE 3000
CMD ["node", "api/dist/index.js"]
