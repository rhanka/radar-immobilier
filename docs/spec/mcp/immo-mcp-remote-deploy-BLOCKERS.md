# Immo MCP remote deploy — blockers

Companion to `docs/spec/mcp/immo-mcp-remote-deploy.md`. Both items below were
found while preparing the K8s manifests + verifying the server locally in a
fresh worktree; neither blocks THIS task's deliverable (Deployment + Service +
Ingress + runbook are still shipped), but both must be resolved before a real
(non-mock, non-placeholder-issuer) go-live with claude.ai.

## 1. `@sentropic/mcp-auth@0.1.0` PRM `resource_metadata` URL mismatch

**Owner: sentropic (package `@sentropic/mcp-auth`), or a one-line mount-point
change in radar's own `server-http.ts`.** Not fixed here — out of this task's
mandate (infra prep, no server code changes) and the fix should be made once,
upstream, rather than patched per-consumer.

**Evidence** (this branch, local boot, see runbook §1.4):

```
$ curl -s -i -X POST http://127.0.0.1:8848/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer error="invalid_token", ..., resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"

$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8848/mcp/.well-known/oauth-protected-resource
404
```

The 401 challenge advertises a `resource_metadata` URL that **the server
itself does not serve** — confirmed by curling that exact path directly
against the same local process (no network/ingress involved, so this is not a
routing artefact).

**Root cause** (read from
`packages/immo-mcp/node_modules/@sentropic/mcp-auth/dist/{prm,core,hono}.js`):

- `prm.js#protectedResourceMetadataUrl(resource)` computes the advertised URL
  as `${resource}${PROTECTED_RESOURCE_METADATA_PATH}` — i.e. it **appends**
  `/.well-known/oauth-protected-resource` after the full resource URL
  (`https://immo.sent-tech.ca/mcp` → `.../mcp/.well-known/oauth-protected-resource`).
- `core.js#handle()` and `hono.js#mcpAuthRoutes()` both check/register the PRM
  route at the **bare, literal** `PROTECTED_RESOURCE_METADATA_PATH`
  (`/.well-known/oauth-protected-resource`), with no resource-path prefix at
  all.
- These two disagree **whenever `resource` has a non-empty path** — which is
  exactly radar's case (`resource = https://immo.sent-tech.ca/mcp`, chosen
  deliberately to scope the token audience to the MCP endpoint rather than
  the whole host, since the UI/api share the same origin). If `resource` were
  bare (`https://immo.sent-tech.ca`, no path), both would coincidentally agree
  on the same bare path — which is likely why this shipped un-caught: it only
  breaks resource URIs with a path component. Note also that RFC 9728 §3.1's
  own canonical construction (insert the well-known suffix *between* the host
  and the resource's path) is a **third** answer,
  `https://immo.sent-tech.ca/.well-known/oauth-protected-resource/mcp`, that
  neither the header value nor the actual mount point matches — so this is
  not just an internal inconsistency but also a deviation from the RFC's own
  algorithm.

**Impact if unresolved**: any RFC-9728-compliant client (expected to include
claude.ai, since PRM discovery via the 401 challenge is the primary
documented mechanism in the MCP authorization spec) that follows
`resource_metadata` literally will 404 on the very first discovery step and
fail to complete "Add custom connector" — even once the IdP items in the
runbook §4 are all answered and the image/deploy gaps below are resolved.

**Recommendation**: mount `mcpAuthRoutes(mcp)` in `server-http.ts` under the
resource's own path (`app.route("/mcp", mcpAuthRoutes(mcp))` instead of
`app.route("/", mcpAuthRoutes(mcp))`) so the PRM is actually served at
`/mcp/.well-known/oauth-protected-resource`, matching what `protectedResourceMetadataUrl()`
already advertises — a one-line, consumer-side fix that doesn't require
waiting on a `@sentropic/mcp-auth` release. In parallel, flag the RFC 9728
construction deviation to sentropic for a package-level fix (their
`protectedResourceMetadataUrl()` should follow §3.1's "insert before path"
rule, not "append after"), since other `@sentropic/mcp-auth` consumers with a
non-empty resource path will hit the same bug. If `server-http.ts` is
adjusted, `41-immo-mcp-ingress.yaml`'s second (`Exact`,
`/.well-known/oauth-protected-resource`) path rule becomes a harmless no-op
that can be dropped — see that file's header comment.

## 2. `radar-api:latest` image does not bundle `packages/immo-mcp`

**Owner: whoever owns `api/Dockerfile` / `build-push-images.yml` next.**

`deploy/k8s/40-immo-mcp-http-deploy.yaml` targets
`rg.fr-par.scw.cloud/radar-immobilier/radar-api:latest` with
`command: ["node", "packages/immo-mcp/dist/server-http.js"]`, per this task's
primary hypothesis. Confirmed (this branch, reading `api/Dockerfile`) that
this image is built from `{radar-domain, radar-scoring, radar-sources, api}`
only — `packages/immo-mcp`'s deps are never `npm install`ed into it and its
`server-http.ts` is never bundled. Applying the Deployment as-is today would
CrashLoop on `MODULE_NOT_FOUND` at the very first `node` invocation.

Two remediation options are spelled out with an exact diff sketch in the
runbook §2 (extend `api/Dockerfile`'s build stage vs. ship a dedicated
`packages/immo-mcp/Dockerfile` + CI matrix row). **Recommendation: extend
`api/Dockerfile`** (cheaper — same CI job, same multi-entrypoint esbuild
pattern already used for the Job scripts) unless/until the MCP surface needs
an independent release cadence.

This is why `40-immo-mcp-http-deploy.yaml` / `41-immo-mcp-ingress.yaml` are
NOT yet folded into `deploy/k8s/kustomization.yaml` — see that file's own
comment and the runbook §3.

## Not a blocker (already fixed in this branch)

The public `/mcp` Ingress path would additionally have been silently dropped
by the namespace's default-deny NetworkPolicy baseline (same class of gap
`deploy/k8s/README.md` already documents for the UI: "Ingress reaches the UI
pod, not the api"). This branch closes it by appending
`allow-traefik-to-immo-mcp` to `deploy/k8s/70-networkpolicy.yaml` (mirrors the
existing `allow-traefik-to-ui`) — no further action needed here, just ship it
together with the Deployment/Ingress once folded into the kustomization.
