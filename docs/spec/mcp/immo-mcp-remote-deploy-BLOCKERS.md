# Immo MCP remote deploy — blockers

Companion to `docs/spec/mcp/immo-mcp-remote-deploy.md`. Both items below were
found while preparing the K8s manifests + verifying the server locally in a
fresh worktree; neither blocked that task's deliverable (Deployment + Service
+ Ingress + runbook were still shipped), but both had to be resolved before a
real (non-mock, non-placeholder-issuer) go-live with claude.ai.

**STATUS: both items §1 and §2 are RESOLVED** (follow-up branch, same repo).
What's still NOT done — and is a separate, external, cadrage gap rather than a
code/infra blocker — is wiring the REAL sentropic-operated IdP
issuer/resource/JWKS (runbook §4, "Demandes à architect/sentropic"): the
ConfigMap in `deploy/k8s/40-immo-mcp-http-deploy.yaml` still ships
`IMMO_MCP_OAUTH_ISSUER: https://idp.sent-tech.ca` as a placeholder, so
`40-immo-mcp-http-deploy.yaml` / `41-immo-mcp-ingress.yaml` are still
deliberately NOT folded into `deploy/k8s/kustomization.yaml` (see that file's
own comment) even though both would now boot/route correctly if applied.

## 1. `@sentropic/mcp-auth@0.1.0` PRM `resource_metadata` URL mismatch — RESOLVED

**Fix applied**: `server-http.ts`'s `createImmoHttpApp()` now mounts
`mcpAuthRoutes(mcp)` under the resource's own path instead of the app root:

```diff
- app.route("/", mcpAuthRoutes(mcp));
+ app.route("/mcp", mcpAuthRoutes(mcp));
```

This is the one-line, consumer-side fix this section originally recommended
(no `@sentropic/mcp-auth` release needed). The PRM is now served at exactly
the URL `protectedResourceMetadataUrl()` advertises in the 401 challenge:
`/mcp/.well-known/oauth-protected-resource`. Confirmed `app.use("/mcp",
requireMcpAuth(...))` does NOT shadow this PRM sub-route: Hono only matches a
bare (non-wildcard) `.use()` path exactly, not sub-paths — verified both by
the updated `server-http.test.ts` (test (a) now fetches
`/mcp${PRM_PATH}` instead of the bare path) and by the local curl evidence
below.

**Re-verification evidence** (this branch, local boot, mirrors the original
runbook §1.2–1.4 exactly, same env vars):

```
$ IMMO_MCP_OAUTH_ISSUER=https://idp.sent-tech.ca \
  IMMO_MCP_OAUTH_RESOURCE=https://immo.sent-tech.ca/mcp \
  IMMO_MCP_HTTP_PORT=8848 IMMO_MCP_DATA_MODE=mock \
  node packages/immo-mcp/dist/server-http.js
[immo-mcp-http] listening port=8848 resource=https://immo.sent-tech.ca/mcp issuer=https://idp.sent-tech.ca dataMode=simulation requiredScopes=immo:read

$ curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8848/.well-known/oauth-protected-resource
404   # bare path — correctly no longer served (was the OLD, wrong mount point)

$ curl -s -i http://127.0.0.1:8848/mcp/.well-known/oauth-protected-resource
HTTP/1.1 200 OK
content-type: application/json
{"resource":"https://immo.sent-tech.ca/mcp","authorization_servers":["https://idp.sent-tech.ca"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA"],"scopes_supported":["immo:read","immo:search","immo:documents:read"]}

$ curl -s -i -X POST http://127.0.0.1:8848/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
HTTP/1.1 401 Unauthorized
content-type: application/json
www-authenticate: Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"

{"error":{"code":"invalid_token","message":"Authorization header is required."}}
```

The 401 challenge's `resource_metadata` URL and the URL that actually returns
200 are now the SAME (`https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource`)
— the exact gap this section reported is closed. `packages/immo-mcp`'s own
vitest suite (`npm run -w packages/immo-mcp test`) passes 9/9, including the
updated PRM-path assertion.

**Manifest follow-through**: `deploy/k8s/41-immo-mcp-ingress.yaml`'s second
(`Exact`, bare `/.well-known/oauth-protected-resource`) path rule — kept
before as a routing workaround for the OLD (root-mounted) PRM — is now dead
weight (the app doesn't serve anything at that bare path anymore either) and
has been REMOVED; the existing `/mcp` (Prefix) rule already covers the PRM's
new location. `deploy/k8s/40-immo-mcp-http-deploy.yaml`'s
`readinessProbe`/`livenessProbe` `httpGet.path` were ALSO updated from the
bare path to `/mcp/.well-known/oauth-protected-resource` — they would
otherwise have 404'd against the fixed server and the Deployment would never
have gone Ready, a new, self-inflicted gap this same fix would have created if
missed.

**Side-effect fix found while re-verifying**: `server-http.ts` imported
`IMMO_MCP_NAME`/`IMMO_MCP_VERSION` from `./server.js` (the stdio entrypoint).
Harmless when running under plain `tsc` (two separate output files, two
separate `import.meta.url`s), but once `packages/immo-mcp/src/server-http.ts`
is esbuild-bundled into a single self-contained file (§2 below), `server.ts`'s
module body — including its `if (import.meta.url matches process.argv[1])
main()` stdio-only guard — gets INLINED into that same bundle, where a
unified `import.meta.url` post-bundling makes the guard spuriously fire: the
HTTP process silently ALSO started an idle stdio `McpServer` on boot
(observed firsthand: an extra `[immo-mcp] ready name=immo version=0.0.1
mode=mock` stderr line before the intended `[immo-mcp-http] listening ...`
one). Fixed by extracting the two constants into a new, side-effect-free
`packages/immo-mcp/src/meta.ts`, imported by both `server.ts` and
`server-http.ts` — neither transport's bundle needs the OTHER transport's
entrypoint module anymore. Re-verified: rebuilding the esbuild bundle (see §2
below) and re-running the boot+curl sequence above now prints ONLY the
`[immo-mcp-http] listening ...` line, no stray stdio "ready" line.

## 2. `radar-api:latest` image does not bundle `packages/immo-mcp` — RESOLVED

**Fix applied** (option A from the runbook §2, as recommended): `api/Dockerfile`
now:
1. `COPY packages/immo-mcp/package.json packages/immo-mcp/` alongside the
   other workspace `package.json` copies, so the existing `npm install
   --workspaces --include-workspace-root` layer resolves
   `@sentropic/mcp-auth`/`@sentropic/oauth-verify`/`@hono/node-server`/`jose`
   into the shared `node_modules`.
2. `COPY packages/immo-mcp packages/immo-mcp` alongside the other full
   package copies.
3. `RUN npm run typecheck --workspace=packages/immo-mcp` (fail-fast, mirrors
   the existing `api` typecheck step).
4. A SECOND `esbuild` `build()` call (own `outbase`/`outdir`, since
   `packages/immo-mcp/src` isn't under `api/src`), with the same
   external-bare-specifier plugin — `packages/immo-mcp` has no `@radar/*`
   workspace deps of its own, so every bare specifier is marked external.
5. Runtime stage: `COPY --from=build /workspace/packages/immo-mcp/dist
   ./packages/immo-mcp/dist` (its deps are already carried by the existing
   `COPY --from=build /workspace/node_modules ./node_modules`).

No new CI job/matrix row — reuses the existing `build-push-images.yml` `api`
entry, exactly as recommended.

**Verification** (this branch; did NOT build the full Docker image — heavy —
but ran the EXACT script the Dockerfile's `RUN` block generates, from the repo
root, which is what actually executes at Docker build time):

```
$ node esbuild-check.mjs   # ad hoc copy of the Dockerfile's generated esbuild.mjs
  api/dist/index.js                                1.0mb ⚠️
  api/dist/scripts/worker-live.js                384.3kb
  ...
  packages/immo-mcp/dist/server-http.js  20.5kb

$ IMMO_MCP_OAUTH_ISSUER=https://idp.sent-tech.ca IMMO_MCP_OAUTH_RESOURCE=https://immo.sent-tech.ca/mcp \
  IMMO_MCP_HTTP_PORT=8850 IMMO_MCP_DATA_MODE=mock node packages/immo-mcp/dist/server-http.js
[immo-mcp-http] listening port=8850 resource=https://immo.sent-tech.ca/mcp issuer=https://idp.sent-tech.ca dataMode=simulation requiredScopes=immo:read
# (no stray stdio "ready" line — meta.ts fix confirmed under the SAME bundling this Dockerfile does)

$ curl -s -i http://127.0.0.1:8850/mcp/.well-known/oauth-protected-resource
HTTP/1.1 200 OK
{"resource":"https://immo.sent-tech.ca/mcp", ...}

$ curl -s -i -X POST http://127.0.0.1:8850/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer error="invalid_token", ..., resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"
```

The esbuild-bundled `packages/immo-mcp/dist/server-http.js` (produced the
SAME way the Dockerfile's `RUN` block would produce it) boots and serves
identically to the plain `tsc` build used in §1's evidence — confirming the
Dockerfile's bundling approach is sound, without paying for a full image
build. `make k8s-validate` (offline kustomize render + structural check) still
passes on the untouched, applied bundle; a scratch kustomization including
the modified `40-immo-mcp-http-deploy.yaml` + `41-immo-mcp-ingress.yaml` +
`70-networkpolicy.yaml` also rendered clean (11 documents, all with
`apiVersion`+`kind`, `Ingress/radar-immo-mcp` now with a SINGLE `/mcp` path
rule, probes pointing at the new PRM path).

**Manifest follow-through**: `deploy/k8s/40-immo-mcp-http-deploy.yaml`'s
`command`/`workingDir` (`node packages/immo-mcp/dist/server-http.js` /
`/workspace`) already matched the Dockerfile's runtime `WORKDIR /workspace`
and the new `COPY .../dist ./packages/immo-mcp/dist` — no manifest change
needed there. Its header comment (previously "NOT YET DEPLOYABLE") was
updated to record the fix.

## Remaining gap before a REAL go-live (not a blocker tracked here — see runbook §4)

The ConfigMap's `IMMO_MCP_OAUTH_ISSUER`/`IMMO_MCP_OAUTH_RESOURCE` are still
placeholders (`https://idp.sent-tech.ca`) pending the real sentropic-operated
IdP handover (issuer, JWKS URI, scopes, Dynamic Client Registration, RFC 8414
metadata — runbook §4). Booting the Deployment today would NOT crash (issuer
is just a config string; JWKS is fetched lazily per-request), but every real
bearer token would fail verification against an unreachable placeholder
issuer. `deploy/k8s/40-immo-mcp-http-deploy.yaml` / `41-immo-mcp-ingress.yaml`
are therefore still deliberately NOT folded into
`deploy/k8s/kustomization.yaml`'s `resources:` — apply by hand once the IdP
values are real, then fold both in (see `kustomization.yaml`'s own comment).

## Not a blocker (already fixed in the original branch)

The public `/mcp` Ingress path would additionally have been silently dropped
by the namespace's default-deny NetworkPolicy baseline (same class of gap
`deploy/k8s/README.md` already documents for the UI: "Ingress reaches the UI
pod, not the api"). This branch closes it by appending
`allow-traefik-to-immo-mcp` to `deploy/k8s/70-networkpolicy.yaml` (mirrors the
existing `allow-traefik-to-ui`) — no further action needed here, just ship it
together with the Deployment/Ingress once folded into the kustomization.
