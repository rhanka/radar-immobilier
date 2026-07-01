# Immo MCP remote deploy — runbook (PREPARED, NOT APPLIED)

Companion to `docs/spec/mcp/immo-mcp-provider-v0.md` (product cadrage, stdio
v0). This document covers the **remote** transport only: exposing
`packages/immo-mcp/src/server-http.ts` (Streamable HTTP + OAuth 2.1 Resource
Server, RFC 9728 PRM + RFC 6750 challenges) at `https://immo.sent-tech.ca/mcp`
so claude.ai (and any RFC-9728-compliant MCP client) can connect it as a
**custom connector**.

> **Scope discipline**: this is an infra-prep task. No tool code, no
> `server.ts` (stdio) change. What's PREPARED here: `deploy/k8s/40-immo-mcp-http-deploy.yaml`
> (Deployment + Service + ConfigMap), `deploy/k8s/41-immo-mcp-ingress.yaml`
> (public Ingress path), an appended NetworkPolicy in
> `deploy/k8s/70-networkpolicy.yaml`, and this runbook. Nothing was applied to
> a live cluster and nothing was wired into `deploy/k8s/kustomization.yaml`
> yet — see "Blockers" below for why.

See also **`docs/spec/mcp/immo-mcp-remote-deploy-BLOCKERS.md`** for the two
concrete gaps found while preparing this (image bundling, PRM URL mismatch)
and the NetworkPolicy gap this branch already closes.

## 1. What was verified locally (this branch, this worktree)

All four commands below were run in a **fresh, isolated worktree** with no
pre-existing `node_modules` (so this is a clean-room repro, not reuse of a
previously-verified state). `npm install --workspace=@radar/immo-mcp
--include-workspace-root` first resolved `@sentropic/mcp-auth@0.1.0` +
`@sentropic/oauth-verify@0.1.0` off the public npm registry (they publish
there — no private registry needed).

### 1.1 Build

```bash
npm run -w packages/immo-mcp build
```

```
> @radar/immo-mcp@0.0.1 build
> tsc -p tsconfig.json
```

Clean exit, no `tsc` errors (only an `EBADENGINE` warning: local node is v22,
`package.json` wants `>=24` — non-blocking for `tsc`, but match node24 in the
image, as `api/Dockerfile` already does).

### 1.2 Local boot

```bash
IMMO_MCP_OAUTH_ISSUER=https://idp.sent-tech.ca \
IMMO_MCP_OAUTH_RESOURCE=https://immo.sent-tech.ca/mcp \
IMMO_MCP_HTTP_PORT=8848 \
IMMO_MCP_DATA_MODE=mock \
node packages/immo-mcp/dist/server-http.js
```

```
[immo-mcp-http] listening port=8848 resource=https://immo.sent-tech.ca/mcp issuer=https://idp.sent-tech.ca dataMode=simulation requiredScopes=immo:read
```

(`dataMode=simulation` is expected: `loadHttpConfig` only maps
`IMMO_MCP_DATA_MODE=http` to `"real"`; any other value, including `"mock"`,
maps to `"simulation"` — the mock/fixture data source.)

### 1.3 `curl` the PRM (RFC 9728, unauthenticated, expect 200)

```bash
curl -s http://127.0.0.1:8848/.well-known/oauth-protected-resource
```

```json
{"resource":"https://immo.sent-tech.ca/mcp","authorization_servers":["https://idp.sent-tech.ca"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA"],"scopes_supported":["immo:read","immo:search","immo:documents:read"]}
```

### 1.4 `curl -i` the MCP endpoint with no bearer token (expect 401 + challenge)

```bash
curl -s -i -X POST http://127.0.0.1:8848/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

```
HTTP/1.1 401 Unauthorized
content-type: application/json
www-authenticate: Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"
content-length: 80

{"error":{"code":"invalid_token","message":"Authorization header is required."}}
```

This is the correct RFC 6750 §3 challenge shape. **However** the
`resource_metadata` URL it advertises 404s — see BLOCKERS.md item 1; verified
by also curling that exact URL against the same local server:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8848/mcp/.well-known/oauth-protected-resource
# -> 404
```

### 1.5 K8s manifests — offline render (no cluster contact)

`kubectl kustomize` on a scratch kustomization bundling
`00-namespace.yaml` + `10-rbac.yaml` + the two new files +
`70-networkpolicy.yaml` rendered **11 documents, all with `apiVersion`+`kind`**,
including `ConfigMap/immo-mcp-config`, `Deployment/radar-immo-mcp`,
`Service/radar-immo-mcp`, `Ingress/radar-immo-mcp` (two paths: `/mcp` Prefix,
`/.well-known/oauth-protected-resource` Exact, both → `radar-immo-mcp:http`),
and `NetworkPolicy/allow-traefik-to-immo-mcp`. The existing full bundle (`make
k8s-validate`) still renders clean — the new files are additive and are not
yet in `kustomization.yaml`'s `resources:` list (see §3).

## 2. Prérequis image — le gap trouvé

`api/Dockerfile` builds `rg.fr-par.scw.cloud/radar-immobilier/radar-api:latest`
(also tagged `:latest`, confirmed in `.github/workflows/build-push-images.yml`
line ~91) from **only** `{radar-domain, radar-scoring, radar-sources, api}` —
it never touches `packages/immo-mcp`. Its `esbuild` step's `entryPoints` are
all `api/src/*.ts`. So today, `node packages/immo-mcp/dist/server-http.js`
against `radar-api:latest` fails immediately: neither the compiled JS nor its
extra deps (`@sentropic/mcp-auth`, `@sentropic/oauth-verify`,
`@hono/node-server`, `jose`) are in that image.

`deploy/k8s/40-immo-mcp-http-deploy.yaml` still targets `radar-api:latest` +
overridden `command`, per this task's primary hypothesis — but that
hypothesis needs one of these BEFORE the Deployment can actually start:

- **(A) recommended** — extend `api/Dockerfile`'s build stage:
  1. `COPY packages/immo-mcp/package.json packages/immo-mcp/` next to the
     other workspace `package.json` copies, so the existing `npm install
     --workspaces --include-workspace-root` layer also resolves
     `@sentropic/mcp-auth`/`@sentropic/oauth-verify`/`@hono/node-server`/`jose`
     into the shared `node_modules`.
  2. `COPY packages/immo-mcp packages/immo-mcp` alongside the other package
     copies.
  3. Add a **second** `esbuild` call (the current one's `outbase`/`entryNames`
     assume everything lives under `api/src`, so immo-mcp needs its own
     invocation, not another `entryPoints` row in the same call):
     ```js
     await build({
       entryPoints: ["packages/immo-mcp/src/server-http.ts"],
       bundle: true, platform: "node", format: "esm", target: "node24",
       outdir: "packages/immo-mcp/dist", outbase: "packages/immo-mcp/src",
       plugins: [/* same @radar/* external-marking plugin */],
     });
     ```
  4. The runtime stage already does `COPY --from=build /workspace/node_modules
     ./node_modules` — that's the ONLY reason (A) is cheap: it's the same
     image, same CI matrix row (`build-push-images.yml` `api` entry), just a
     bigger build stage. Then also
     `COPY --from=build /workspace/packages/immo-mcp/dist ./packages/immo-mcp/dist`
     in the runtime stage.
- **(B)** — a dedicated `packages/immo-mcp/Dockerfile` + a new `immo-mcp`
  matrix row in `build-push-images.yml`, image tag
  `rg.fr-par.scw.cloud/radar-immobilier/immo-mcp:latest`. Decouples the MCP
  server's release/rollback from the main api image (arguably cleaner given
  it's a distinct OAuth-facing attack surface) at the cost of a new
  Dockerfile + CI row + a one-line `image:` swap in
  `40-immo-mcp-http-deploy.yaml`.

**Recommendation: (A)**, purely for cost — it reuses the existing CI job,
matches the multi-entrypoint esbuild pattern the Dockerfile already uses for
the Job scripts (migrate, project-graph-from-s3, worker-live, …), and this is
a low-traffic POC server where sharing the image's blast radius is an
acceptable trade for not standing up a second CI pipeline. If/when the MCP
surface gets its own release cadence or security review cycle, revisit (B).
This is a **decision to make before applying `40-immo-mcp-http-deploy.yaml`**,
not something this branch decides unilaterally — flagged in
BLOCKERS.md item 2 pending owner sign-off.

## 3. Manifests prepared (not in the applied bundle yet)

| File | What | Applied? |
| --- | --- | --- |
| `deploy/k8s/40-immo-mcp-http-deploy.yaml` | `immo-mcp-config` ConfigMap + `radar-immo-mcp` Deployment (1 replica, `radar-app` SA, `radar-api:latest` image + overridden command, resources `req 50m/128Mi` `lim 150m/256Mi`, readiness/liveness on the PRM path) + `radar-immo-mcp` Service (port 8848) | No — not in `kustomization.yaml` |
| `deploy/k8s/41-immo-mcp-ingress.yaml` | `radar-immo-mcp` Ingress on the existing `immo.sent-tech.ca` host, paths `/mcp` (Prefix) and `/.well-known/oauth-protected-resource` (Exact), both → the mcp Service; reuses the `radar-immo-tls` Secret (no `cert-manager.io/cluster-issuer` annotation, to avoid a duplicate Certificate race with `60-ingress.yaml`) | No — not in `kustomization.yaml` |
| `deploy/k8s/70-networkpolicy.yaml` (appended) | `allow-traefik-to-immo-mcp`: Traefik/kube-system → `{component: mcp}:8848`, mirrors `allow-traefik-to-ui` | **Yes** — appended to the file already IN `kustomization.yaml`; harmless no-op today (no `component: mcp` pod exists yet) |
| `deploy/k8s/kustomization.yaml` | comment recording the above + the "fold in once ready" instruction | n/a |

Why the Deployment/Ingress aren't in the bundle yet: `make deploy-k8s` /
`kubectl apply -k deploy/k8s` is meant to be safely re-runnable by an operator
at any time; folding in a Deployment whose image doesn't contain the
entrypoint (§2) and whose ConfigMap ships a placeholder IdP issuer (§4) would
either CrashLoop or silently reject every real token. Same discipline the
repo already uses for the one-shot Jobs (`kustomization.yaml`'s own comment on
31/32/33).

### Ingress routing rationale (why a second Ingress object, why two paths)

See the header comments in `41-immo-mcp-ingress.yaml` for the full reasoning;
summary:
- `60-ingress.yaml` already owns `immo.sent-tech.ca` with a catch-all `/` →
  `radar-ui`. Kubernetes Ingress controllers (Traefik included) merge all
  Ingress objects sharing a host and dispatch by most-specific path, so a
  second Ingress object is the standard, non-invasive way to add `/mcp`.
- Two paths route to the mcp Service because `@sentropic/mcp-auth`'s
  `mcpAuthRoutes()` mounts the PRM well-known at the Hono app's **own root**
  (`/.well-known/oauth-protected-resource`), not under `/mcp` — confirmed by
  reading `node_modules/@sentropic/mcp-auth/dist/hono.js` +`core.js`. Without
  the second (`Exact`) rule, a PRM fetch at the public host would fall
  through to the UI's SPA catch-all instead of reaching the mcp pod.
- The `WWW-Authenticate` header's own `resource_metadata` value
  (`.../mcp/.well-known/oauth-protected-resource`) is a **third, still
  different** URL that 404s even directly on the pod — no Ingress rule can
  fix that; it needs a code-level fix (BLOCKERS.md item 1).

### NetworkPolicy dependency

Same class of gap as documented in `deploy/k8s/README.md` ("Ingress reaches
the UI pod, not the api"): the poc-k8s operator baseline only opens
Traefik → `{component: api}:3000`; this repo's own `70-networkpolicy.yaml`
only additionally opened Traefik → `{component: ui}:8080`. Neither one opens
Traefik → `{component: mcp}:8848`. **This branch already appends
`allow-traefik-to-immo-mcp`** (same additive pattern as `allow-traefik-to-ui`)
so this is a closed gap, not an open blocker — it just needs to ship together
with the Deployment/Ingress once those are folded into the kustomization.

## 4. Demandes précises à architect/sentropic (IdP)

Before `IMMO_MCP_OAUTH_ISSUER`/`IMMO_MCP_OAUTH_RESOURCE` can move from
placeholder to real, request from architect/sentropic:

1. **Issuer URL** — the exact `https://idp.sent-tech.ca` (or whatever host)
   OAuth 2.1 Authorization Server issuer to put in `IMMO_MCP_OAUTH_ISSUER`.
   Note this is presumably a **different** IdP surface than
   `auth.sent-tech.ca` (the OIDC IdP radar's own `api` already federates with
   for human login, `30-api.yaml`/`80-auth.yaml`) — confirm whether it's the
   same server wearing a second hat (OAuth AS for machine/MCP clients) or a
   genuinely separate deployment, since the trust/claims model differs
   (`sub`/`tid`/`scope` access-token claims vs. the OIDC `id_token` claims).
2. **Resource / audience** — confirm `https://immo.sent-tech.ca/mcp` as the
   canonical `resource` (token audience) the IdP should mint access tokens
   for. Deliberately the `/mcp` path, not the bare origin, so a token minted
   for this resource cannot be replayed against the unrelated
   `radar-api`/`radar-ui` surface sharing the host.
3. **JWKS URI** — either confirm the IdP publishes its JWKS at the
   `@sentropic/mcp-auth` default (`${issuer}/.well-known/jwks.json`, see
   `core.js` `getKeySource()`), or hand over the real path to set in
   `IMMO_MCP_OAUTH_JWKS_URI`.
4. **Scopes** — confirm the IdP can mint/consent `immo:read`, `immo:search`,
   `immo:documents:read` (the three v0 scopes `registerTools`/`tools.ts` gate
   on) as first-class scopes a client can request, and that its consent UI
   can present them meaningfully to a human.
5. **Dynamic Client Registration (RFC 7591)** — claude.ai's "Add custom
   connector" flow expects to self-register an OAuth client against the
   issuer (it does not have a pre-provisioned `client_id`/`client_secret` like
   radar's own OIDC RP does for `auth.sent-tech.ca`). Confirm the IdP exposes
   a `registration_endpoint` and accepts unauthenticated/open DCR (or a
   documented registration-access-token flow) — without this, claude.ai
   cannot complete the connector setup at all.
6. **Authorization Server Metadata (RFC 8414)** — confirm
   `${issuer}/.well-known/oauth-authorization-server` (or
   `/.well-known/openid-configuration` if the IdP is OIDC-flavoured) is
   served and lists `registration_endpoint`, `authorization_endpoint`,
   `token_endpoint`, `scopes_supported`, `code_challenge_methods_supported`
   (PKCE) — the MCP client resolves the AS's endpoints from here after
   reading `authorization_servers[0]` out of the PRM.

## 5. claude.ai connector registration flow (once the IdP items above land)

1. Deploy the Deployment/Service/Ingress (after resolving §2 and folding the
   files into `kustomization.yaml`), confirm DNS + Ingress
   (`curl -i https://immo.sent-tech.ca/.well-known/oauth-protected-resource`
   → 200 PRM JSON; `curl -i -X POST https://immo.sent-tech.ca/mcp` → 401 +
   `WWW-Authenticate`).
2. In claude.ai: **Settings → Connectors → Add custom connector** →
   URL `https://immo.sent-tech.ca/mcp`.
3. claude.ai fetches `/mcp`, gets the 401 challenge, follows
   `resource_metadata` to the PRM (⚠ blocked today by BLOCKERS.md item 1 —
   fix that first), reads `authorization_servers[0]`, fetches that AS's RFC
   8414 metadata, and either uses a pre-registered client or performs RFC
   7591 DCR to obtain its own `client_id`.
4. claude.ai runs the standard authorization-code + PKCE flow against the IdP
   (human consents, scoped to `immo:read immo:search
   immo:documents:read` or a subset), receives an access token with
   `aud=https://immo.sent-tech.ca/mcp`.
5. claude.ai calls `POST /mcp` with `Authorization: Bearer <token>` →
   `requireMcpAuth` verifies issuer/audience/scope via the JWKS → the
   Streamable HTTP transport takes over (`initialize`, `tools/list`, tool
   calls). All 6 tools currently run against **mock** data
   (`IMMO_MCP_DATA_MODE=mock`); switching to `real` data is a separate,
   later cadrage step (see `immo-mcp-provider-v0.md`), not part of this task.

## 6. Manual apply (human, with cluster creds) — once §2 is resolved

```bash
# 1. Build/push (after api/Dockerfile is extended per §2A, or a new immo-mcp
#    image per §2B) — CI does this on push to main, same as api/ui today.

# 2. Set the real ConfigMap values (issuer/resource/scopes) once §4 is answered,
#    either editing 40-immo-mcp-http-deploy.yaml or via a kustomize overlay —
#    do NOT commit a fake issuer as if it were real.

# 3. Fold the two files into deploy/k8s/kustomization.yaml `resources:`.

# 4. Validate offline, then apply — same gate as every other change here:
make k8s-validate
KUBECONFIG=<path> make deploy-k8s K8S_DEPLOY_CONFIRM=1 ENV=poc

# 5. Smoke:
kubectl -n radar-immobilier get pods -l app.kubernetes.io/component=mcp
curl -i https://immo.sent-tech.ca/.well-known/oauth-protected-resource
curl -s -i -X POST https://immo.sent-tech.ca/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# expect 401 + WWW-Authenticate, same shape as §1.4
```
