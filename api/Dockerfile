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
#
# This image ALSO bundles packages/immo-mcp's remote (Streamable HTTP) MCP
# entrypoint (`server-http.ts`), reusing this same build (recommendation A in
# docs/spec/mcp/immo-mcp-remote-deploy-BLOCKERS.md item 2): the
# `radar-immo-mcp` K8s Deployment (deploy/k8s/40-immo-mcp-http-deploy.yaml)
# runs `node packages/immo-mcp/dist/server-http.js` against THIS image with an
# overridden `command`, so its deps (`@sentropic/mcp-auth`,
# `@sentropic/oauth-verify`, `@hono/node-server`, `jose`) must be installed and
# its dist/ must exist here — sharing the CI job/matrix row rather than
# standing up a dedicated Dockerfile+pipeline for a low-traffic POC surface.

FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/radar-domain/package.json packages/radar-domain/
COPY packages/radar-scoring/package.json packages/radar-scoring/
COPY packages/radar-sources/package.json packages/radar-sources/
COPY packages/immo-mcp/package.json packages/immo-mcp/
COPY api/package.json api/
RUN npm install --workspaces --include-workspace-root
COPY packages/radar-domain packages/radar-domain
COPY packages/radar-scoring packages/radar-scoring
COPY packages/radar-sources packages/radar-sources
COPY packages/immo-mcp packages/immo-mcp
COPY api api
# Typecheck (fail fast on type errors), then bundle the API entrypoint with
# esbuild. A tiny esbuild plugin marks any bare specifier that is NOT @radar/*
# as external (resolved from node_modules at runtime) so only the @radar/*
# workspace TS sources get inlined — robust to transitive deps, small bundle.
RUN npm run typecheck --workspace=api
# Also fail fast on packages/immo-mcp type errors (own tsconfig, own dist —
# see the second esbuild call below); not part of the api workspace's own
# typecheck.
RUN npm run typecheck --workspace=packages/immo-mcp
# Bundle ALL runtime entrypoints, not just the API server. K8s Jobs/CronJobs
# (deploy/k8s/3x-*.yaml) invoke the DB migrator, the SCW→PG graph projector, the
# 0004 tracking backfill, the live scraper, populate-geo and pull-geo-ogc as
# standalone `node` processes.
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
  "    'api/src/scripts/purge-avis-bylaws.ts'," \
  "    'api/src/scripts/worker-live.ts'," \
  "    'api/src/scripts/populate-geo.ts'," \
  "    'api/src/scripts/pull-geo-ogc.ts'," \
  "    'api/src/scripts/graphify-34-enrich.ts'," \
  "    'api/src/scripts/emit-graphify34-candidates.ts'," \
  "    'api/src/services/geo/run-geo-mapper.ts'," \
  "    'api/src/services/consistency/run-consistency-snapshot.ts'," \
  "  ]," \
  "  bundle: true, platform: 'node', format: 'esm', target: 'node24'," \
  "  outdir: 'api/dist', outbase: 'api/src', entryNames: '[dir]/[name]'," \
  "  logLevel: 'info'," \
  "  plugins: [{ name: 'ext', setup(b){ b.onResolve({ filter: /^[^.\/]/ }, a => a.path.startsWith('@radar/') ? null : ({ path: a.path, external: true })); } }]," \
  "});" \
  "// SECOND, separate build call for packages/immo-mcp: its outbase ('src')" \
  "// is NOT under api/src, so it cannot share the entryPoints array above" \
  "// (outbase/entryNames there assume everything lives under api/src)." \
  "// UNLIKE the api build, this bundles EVERY dependency INTO the output" \
  "// (only node: builtins stay external via platform:'node'). Rationale: the" \
  "// previous external-everything variant crash-looped in prod with" \
  "// ERR_MODULE_NOT_FOUND @sentropic/mcp-auth — the runtime stage's hoisted" \
  "// node_modules did not carry immo-mcp's deps. A self-contained bundle" \
  "// removes the runtime node_modules dependency entirely (and the boot" \
  "// smoke below fails the IMAGE BUILD, not prod, if resolution regresses)." \
  "await build({" \
  "  entryPoints: ['packages/immo-mcp/src/server-http.ts']," \
  "  bundle: true, platform: 'node', format: 'esm', target: 'node24'," \
  "  outdir: 'packages/immo-mcp/dist', outbase: 'packages/immo-mcp/src'," \
  "  logLevel: 'info'," \
  "  banner: { js: 'import { createRequire as __cr } from \"node:module\"; const require = __cr(import.meta.url);' }," \
  "});" > /workspace/esbuild.mjs \
 && node /workspace/esbuild.mjs
# Fail-fast boot smoke for the immo-mcp bundle: run it with mock env; exit 124
# (killed by timeout ⇒ the server booted and stayed listening) is SUCCESS, any
# early exit (e.g. ERR_MODULE_NOT_FOUND at import time) fails the image build.
RUN IMMO_MCP_OAUTH_ISSUER=https://idp.example IMMO_MCP_OAUTH_RESOURCE=https://immo.example/mcp \
    IMMO_MCP_HTTP_PORT=18848 IMMO_MCP_DATA_MODE=mock \
    timeout 5 node packages/immo-mcp/dist/server-http.js; test $? -eq 124

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
# packages/immo-mcp/dist/server-http.js — the `radar-immo-mcp` K8s Deployment
# runs this against THIS image with an overridden `command` (see the header
# comment above + deploy/k8s/40-immo-mcp-http-deploy.yaml). Its deps are
# already in ./node_modules (installed alongside api/'s in the build stage).
COPY --from=build /workspace/packages/immo-mcp/dist ./packages/immo-mcp/dist
# Drizzle SQL migrations + journal. The migrate entrypoint (api/dist/db/migrate.js)
# reads `migrationsFolder: "drizzle"` RELATIVE to its CWD, so the db-migrate Job
# runs with workingDir /workspace/api and finds these files. Without this COPY
# the migrator would find an empty folder and apply nothing.
COPY --from=build /workspace/api/drizzle ./api/drizzle
# Fixtures simulation CS-L6 (JSON lus depuis le disque à la première requête)
COPY --from=build /workspace/api/src/services/geo/fixtures ./api/fixtures
# Deployed build identity (short git sha). The CI build passes it
# (`--build-arg GIT_SHA=<sha>`, see build-push-images.yml) and the running
# process surfaces it on /livez and /health (the latter is the only API route
# the UI nginx proxies publicly), so the CD deploy job can PROVE the rolled-out
# sha is actually SERVED — `kubectl rollout status` alone goes green even
# against a stale/wrong cluster (see the pre-flight rationale below). Defaults
# to "unknown" for local builds without the arg. Placed LAST in the stage so a
# new sha only rebuilds this tiny ENV layer, never the cached COPY layers above.
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
USER radar
EXPOSE 3000
CMD ["node", "api/dist/index.js"]
