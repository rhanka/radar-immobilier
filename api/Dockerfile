# Production image for the radar API. Dev/test run node:24 with the repo
# mounted (see docker-compose.dev/test); this image is for e2e and K8s.
#
# The API and the @radar/* workspace packages are authored as ESM TypeScript
# with `moduleResolution: bundler` and entrypoints that point at raw
# `./src/*.ts` (packages/*/package.json `main: ./src/index.ts`). A plain
# `tsc` build only emits api/dist and leaves the bare `@radar/*` imports
# resolving to those `.ts` sources at runtime, which `node` cannot execute;
# running under `tsx` works but transpiles everything at boot and OOMs in the
# tenant's memory budget. We therefore BUNDLE the API with esbuild into a
# single self-contained JS file (npm dependencies kept external, resolved from
# node_modules at runtime), which inlines the workspace TS sources and lets
# plain `node` run it with a small, predictable memory footprint.
#
# Boot-safety: the bundle inlines @radar/sources, whose fixtures used to
# readFileSync committed `_spikes/**​/samples/` bytes at import time and crashed
# the prod boot (those dev fixtures are NOT shipped here). Those reads are now
# LAZY (deferred to first use), so the runtime no longer depends on any dev
# fixture to boot — nothing under `_spikes/samples` needs to ship in this image.

FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/radar-domain/package.json packages/radar-domain/
COPY packages/radar-scoring/package.json packages/radar-scoring/
COPY packages/radar-sources/package.json packages/radar-sources/
COPY api/package.json api/
RUN npm install --workspaces --include-workspace-root
COPY packages/radar-domain packages/radar-domain
COPY packages/radar-scoring packages/radar-scoring
COPY packages/radar-sources packages/radar-sources
COPY api api
# Typecheck (fail fast on type errors), then bundle the API entrypoint with
# esbuild. A tiny esbuild plugin marks any bare specifier that is NOT @radar/*
# as external (resolved from node_modules at runtime) so only the @radar/*
# workspace TS sources get inlined — robust to transitive deps, small bundle.
RUN npm run typecheck --workspace=api
# Bundle ALL runtime entrypoints, not just the API server. K8s Jobs/CronJobs
# (deploy/k8s/3x-*.yaml) invoke the DB migrator, the SCW→PG graph projector, the
# 0004 tracking backfill and the live scraper as standalone `node` processes.
# esbuild with `outdir` + multiple `entryPoints` mirrors the source tree under
# `api/dist/` (entryNames=[dir]/[name]) so each Job's `node api/dist/<path>.js`
# resolves to a real file — the previous single-entry build only emitted
# `api/dist/index.js`, so `dist/scripts/project-graph-from-s3.js` was MISSING
# and the projection Job died with MODULE_NOT_FOUND (douleur D1).
RUN npm install --no-save esbuild@0.24.0 \
 && printf '%s\n' \
  "import { build } from 'esbuild';" \
  "await build({" \
  "  entryPoints: [" \
  "    'api/src/index.ts'," \
  "    'api/src/db/migrate.ts'," \
  "    'api/src/db/scripts/backfill-0004-tracking.ts'," \
  "    'api/src/scripts/project-graph-from-s3.ts'," \
  "    'api/src/scripts/worker-live.ts'," \
  "  ]," \
  "  bundle: true, platform: 'node', format: 'esm', target: 'node24'," \
  "  outdir: 'api/dist', outbase: 'api/src', entryNames: '[dir]/[name]'," \
  "  logLevel: 'info'," \
  "  plugins: [{ name: 'ext', setup(b){ b.onResolve({ filter: /^[^.\/]/ }, a => a.path.startsWith('@radar/') ? null : ({ path: a.path, external: true })); } }]," \
  "});" > /workspace/esbuild.mjs \
 && node /workspace/esbuild.mjs

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
COPY --from=build /workspace/api/dist ./api/dist
COPY --from=build /workspace/api/package.json ./api/package.json
# Drizzle SQL migrations + journal. The migrate entrypoint (api/dist/db/migrate.js)
# reads `migrationsFolder: "drizzle"` RELATIVE to its CWD, so the db-migrate Job
# runs with workingDir /workspace/api and finds these files. Without this COPY
# the migrator would find an empty folder and apply nothing.
COPY --from=build /workspace/api/drizzle ./api/drizzle
# Fixtures simulation CS-L6 (JSON lus depuis le disque à la première requête)
COPY --from=build /workspace/api/src/services/geo/fixtures ./api/fixtures
USER radar
EXPOSE 3000
CMD ["node", "api/dist/index.js"]
