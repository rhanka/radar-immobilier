# Production image for the radar UI (Svelte SPA). Multi-stage:
#   1) `build`   — install the npm workspaces and run `vite build` to produce
#                  the static bundle in ui/dist.
#   2) `runtime` — an unprivileged nginx that serves that bundle and (via the
#                  conf shipped here, overridable by the k8s ConfigMap mount at
#                  /etc/nginx/conf.d) reverse-proxies /api -> radar-api:3000 so
#                  the browser stays same-origin (no CORS), incl. the sentropic
#                  OIDC callback /api/v1/auth/oauth/callback handled by the api.
#
# Built from the repo ROOT (context: .) like api/Dockerfile, because the SPA
# imports the @radar/{domain,scoring,sources} workspace packages.
#
# The SPA is built with VITE_API_BASE_URL empty so it calls same-origin /api/*
# (Makefile default), which nginx forwards to the api Service.

FROM node:24-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/radar-domain/package.json packages/radar-domain/
COPY packages/radar-scoring/package.json packages/radar-scoring/
COPY packages/radar-sources/package.json packages/radar-sources/
COPY ui/package.json ui/
RUN npm install --workspaces --include-workspace-root
COPY packages/radar-domain packages/radar-domain
COPY packages/radar-scoring packages/radar-scoring
COPY packages/radar-sources packages/radar-sources
COPY ui ui
RUN npm run build --workspace=ui

# Unprivileged nginx (listens on 8080, matches deploy/k8s/50-ui.yaml). The
# baked conf is a sane default; the K8s Deployment mounts the radar-ui-nginx
# ConfigMap over /etc/nginx/conf.d so ops can tune the proxy without a rebuild.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY --from=build /workspace/ui/dist /usr/share/nginx/html
COPY ui/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
