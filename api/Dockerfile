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
RUN npm install --no-save esbuild@0.24.0 \
 && printf '%s\n' \
  "import { build } from 'esbuild';" \
  "await build({" \
  "  entryPoints: ['api/src/index.ts']," \
  "  bundle: true, platform: 'node', format: 'esm', target: 'node24'," \
  "  outfile: 'api/dist/index.js', logLevel: 'info'," \
  "  plugins: [{ name: 'ext', setup(b){ b.onResolve({ filter: /^[^.\/]/ }, a => a.path.startsWith('@radar/') ? null : ({ path: a.path, external: true })); } }]," \
  "});" > /workspace/esbuild.mjs \
 && node /workspace/esbuild.mjs

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /workspace
RUN groupadd --system --gid 1001 radar \
 && useradd --system --uid 1001 --gid radar radar
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/package.json ./package.json
COPY --from=build /workspace/api/dist ./api/dist
COPY --from=build /workspace/api/package.json ./api/package.json
USER radar
EXPOSE 3000
CMD ["node", "api/dist/index.js"]
