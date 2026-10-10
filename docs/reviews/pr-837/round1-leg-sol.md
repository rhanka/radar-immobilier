status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@ddce2b4fd930b48f3926dc6081e1c9b886c2c73d
lens: guard-scripts-and-oauth-semantics

## Reasoning

Reviewed `git diff origin/main...ddce2b4fd930b48f3926dc6081e1c9b886c2c73d`, with `origin/main=641f48c31a89c9d7bc4f1bc06532728c29018cc8`. HEAD matched the requested SHA and the branch was `fix/mcp-preprod-expose`. This is an independent leg; no other review artefact was read. No cluster access, kubeconfig use, Python execution, credentials, commits, pushes, or GitHub writes were used. All throwaway files and the tests' `mktemp` files were placed under `.review-tmp-sol/` using `TMPDIR`; that directory was deleted after recording the evidence. Only this review file was edited outside it.

The new awk uses POSIX features: multidimensional subscripts flatten through `SUBSEP`; `((wc[j], wk[j]) in cm)` and the issuer tuple membership expressions are supported by both tested awk implementations. `split(expected, want, "|")` uses a single-character separator; the successive `sub` calls separate ConfigMap, key, and value without splitting the URL at its colon. `tolower`, `substr`, and `sub` are portable here; there is no `gensub`, `IGNORECASE`, or array-of-arrays usage. Tests ran with mawk 1.3.4 and BusyBox awk. The `/dev/stderr` output path assumes the Linux environment used by these scripts. Other operating systems/awk implementations: not covered.

Buffering each YAML document until its boundary lets `kind` and `metadata.name` identify preceding `data` lines. Reversing data keys, moving ConfigMap kind/metadata before data, and single/double quoting the eight pinned values all preserve acceptance. Missing keys, missing ConfigMaps, mismatched issuers, and matching-but-wrong issuers produce the expected rejection. The script is a checker for canonical kustomize output, rather than a general YAML parser; arbitrary YAML encodings are not covered. The released render has no observed false positive.

Every supplied mutation was re-run in a fresh copied fixture. The suite requires both a nonzero exit and its expected message (`check-preprod-auth-isolation.test.sh:23`). Replaying it with a renderer that always emits the unchanged released render produces `PASS=3 FAIL=20`, exit 1; replaying it with an unrelated renderer failure produces `PASS=2 FAIL=21`, exit 1. Thus accepted mutations and unrelated failures do not satisfy those assertions. The new ingress host tests do mutate the render, but they duplicate the same broad mutation rather than isolating the named Ingress; see SOL-837-01. Extra isolated ingress mutations were rejected independently.

OAuth issuer alignment is correct for the implemented forwarding mechanism. `server-http.ts:173` passes the configured resource and issuer to `createMcpAuth`; `server-http.ts:225` carries the verified bearer into the session auth context; `data-source.ts:301` forwards it to radar-api. The API resolves its issuer from `SENTROPIC_IDP_ISSUER` and its audiences from the callback origin (`api/src/config.ts:350`, `api/src/config.ts:370`). In the released preprod render these become `https://preprod.auth.sent-tech.ca` and `[https://preprod.immo.sent-tech.ca, https://preprod.immo.sent-tech.ca/mcp]`. `verifyAccessToken` checks issuer/signature/expiry/audience (`api/src/services/auth/oidc.ts:272`); `protect` uses those settings (`api/src/routes/auth.ts:631`). The MCP's configured resource therefore matches an accepted API bearer audience. Trusting the prod issuer instead would disagree with the preprod API issuer.

The server mounts public metadata under `/mcp` and protects the exact transport path (`server-http.ts:193`, `server-http.ts:197`). Its current dependency mechanism appends `/.well-known/oauth-protected-resource` to the resource URL. The released preprod Ingress routes `/mcp` with `pathType: Prefix` to Service `radar-immo-mcp`, named port `http`; this covers both the transport and the advertised metadata URL. The prod public challenge and metadata independently exhibit that same path mechanism. Post-deploy preprod challenge/metadata: unverified; current preprod still returns UI HTML.

Both public authorization-server metadata documents return HTTP 200 and advertise their respective canonical issuer/JWKS/authorization/token URLs, `authorization_code`, S256 PKCE, and token endpoint authentication `none`. Their capability fields agree after replacing the issuer origin. Neither advertises a `registration_endpoint`. Both advertise the same generic scopes (`openid`, `profile`, `email`, `mcp:discover`, `mcp:resources:read`, `mcp:tools:invoke`); neither lists the three `immo:*` scopes. This observation alone does not demonstrate that per-client immo scopes are rejected: the referenced local registration builder writes the configured allowed scopes. Actual client registration, granted scopes, and token issuance on either IdP: unverified.

The PR's public-PKCE registration settings match the referenced registration builder: `none` stores no secret, uses `authorization_code`, requires PKCE, and records the callback, scopes, and resource allowlist (`/home/antoinefa/src/sentropic/api/src/scripts/oauth-register-client.ts:109`, `:130`, `:143`). The local source was read at sentropic HEAD `97fe9f53e8079694e35771227c11544ce8658316`, with no working diff for that file; the live IdP's deployed revision is unknown. A suitable existing registration would satisfy that prerequisite; a new registration is necessary only if it is absent or incompatible. Registration alone is insufficient for a working `search_signals` call: the connector must use its client ID, obtain/consent to the required scopes and resource, and the user's subject must have an approved account in the preprod radar database (`api/src/routes/auth.ts:644`). The PR's remaining steps and two unauthenticated curls do not cover that authenticated acceptance; see SOL-837-02.

`reconcile-preprod.sh` uses `set -euo pipefail` (`:49`), checks the rendered manifest before any apply (`:72`), quotes namespace/render arguments, and applies the MCP ConfigMap before the workflow's image rollout (`:120`, `.github/workflows/build-push-images.yml:823`). Apply pipelines preserve failures through `pipefail`; only the logging diff is deliberately ignored (`:105`). The deployment presence check suppresses errors as well as absence (`:81`), following the existing workflow pattern; cluster/RBAC execution is not covered. The existing preprod Role grants ConfigMap create/patch/update and Deployment get; it does not grant Ingress operations. The PR explicitly leaves Ingress installation to the operator. Reconcile runtime execution is not covered because it accesses the cluster and invokes the pre-existing Python filter; syntax was checked only.

The workflow diff contains comment changes only. Base and refresh prod renders, plus raw files 30/40/41/70, compared byte-identically against origin/main. No base k8s manifest or prod MCP workflow was changed. Actual deployment/operator execution and authenticated client operation remain unverified.

## Commands and outputs

Commands were run through `rtk`; below, shell bodies are shown where that makes their purpose clearer. `ROOT` denotes this worktree and `SCRATCH` denotes `$ROOT/.review-tmp-sol`. `TMPDIR` was set to `SCRATCH` for every test/guard execution. No make target or stack was needed; the author's `make k8s-validate` claim was not repeated by this leg.

Requested checks:

```text
$ bash deploy/ci/check-preprod-auth-isolation.sh
preprod auth isolation: ok (/home/antoinefa/src/radar-immobilier/tmp/mcp-preprod-expose/deploy/overlays/preprod — no PROD auth value or routing host; 8 preprod keys pinned in radar-api + immo-mcp-config)
exit=0

$ bash deploy/ci/check-preprod-auth-isolation.test.sh
ok: accepts the released preprod overlay (preprod routing host only)
ok: accepts an unmodified fixture copy
ok: rejects the #738 state (radar-api auth keys inherited from PROD)
ok: rejects a single auth key falling back to the PROD base
ok: rejects the PROD callback base (AUTH_CALLBACK_BASE_URL)
ok: rejects PROD values in ConfigMap radar-sentropic-auth
ok: rejects the PROD client id in any ConfigMap
ok: rejects a PROD IdP host regardless of case
ok: rejects a new base auth key left at its PROD value
ok: rejects a PROD app host as a workload env literal
ok: rejects the PROD client id as a workload env literal
ok: rejects a radar-api redirect_uri that differs from the registered one
ok: rejects the PROD MCP resource (IMMO_MCP_OAUTH_RESOURCE)
ok: rejects the PROD MCP issuer (IMMO_MCP_OAUTH_ISSUER)
ok: rejects the PROD MCP public base URL (RADAR_PUBLIC_BASE_URL)
ok: rejects an MCP resource other than the preprod /mcp path
ok: rejects an MCP issuer that differs from the radar-api issuer
ok: rejects a render without ConfigMap immo-mcp-config (no vacuous pass)
ok: rejects a PROD host on the preprod MCP Ingress
ok: rejects a PROD host on the preprod UI Ingress
ok: rejects the PROD TLS Secret on a preprod Ingress
ok: rejects a render without ConfigMap radar-api (no vacuous pass)
ok: rejects an overlay that does not render
PASS=23 FAIL=0
exit=0

$ bash -n deploy/ci/reconcile-preprod.sh
(no stdout/stderr)
exit=0
```

The guard and both other scripts also passed `bash -n`. For BusyBox, a scratch-only `awk` wrapper executed `/usr/bin/busybox awk "$@"`, and its directory was prepended to PATH. Running the same released-overlay guard and supplied suite with that wrapper produced guard exit 0 and `PASS=23 FAIL=0`, suite exit 0. `awk -W version` identified the default implementation as `mawk 1.3.4 20260129`.

The supplied suite was copied into scratch, its `HERE` was set to the original `deploy/ci`, and `printf 'DIAGNOSTIC: %s\n%s\n' "$2" "$out"` was inserted before the existing message assertion. This second run again produced `PASS=23 FAIL=0`. Complete diagnostics were inspected; new-case outputs were:

| Supplied new mutation | Specific rejection(s), excluding the common failure footer |
| --- | --- |
| Delete MCP resource override | `PROD auth host -> IMMO_MCP_OAUTH_RESOURCE: https://immo.sent-tech.ca/mcp`; resource differs from pinned preprod URL |
| Delete MCP issuer override | `PROD auth host -> IMMO_MCP_OAUTH_ISSUER: https://auth.sent-tech.ca`; wrong pinned issuer; issuer differs from radar-api |
| Delete MCP public URL override | `PROD auth host -> RADAR_PUBLIC_BASE_URL: https://immo.sent-tech.ca`; wrong pinned public URL |
| Set MCP resource to preprod `/api/mcp` | `IMMO_MCP_OAUTH_RESOURCE=https://preprod.immo.sent-tech.ca/api/mcp (expected https://preprod.immo.sent-tech.ca/mcp)` |
| Set only MCP issuer to a third issuer | Wrong pinned MCP issuer; `IMMO_MCP_OAUTH_ISSUER differs from ConfigMap/radar-api SENTROPIC_IDP_ISSUER` |
| Remove resource file 40 | `ConfigMap/immo-mcp-config not found in the render (nothing checked)`; no render error |
| PROD MCP Ingress host test | Four routing-host failures: rule and TLS host for each of `radar` and `radar-immo-mcp` |
| PROD UI Ingress host test | The same four routing-host failures as the preceding case |
| PROD TLS Secret test | `PROD TLS secret -> secretName: radar-immo-tls` for both Ingresses |

The additional scratch helper rendered a baseline with:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod > "$SCRATCH/released.yaml"
```

Each case below started from that baseline, except the reordered/missing case, which started from the accepted reordered baseline. Each mutated file was checked with `bash deploy/ci/check-preprod-auth-isolation.sh "$file"`; the helper asserted exit 1 plus the named diagnostic for negatives, and exit 0 for positives. It printed `EXTRA PASS=22 FAIL=0`, helper exit 0. Of these, 15 were manifest regressions, four were acceptance controls, and three were process/input failure controls.

| Additional case / exact change | Exit | Output evidence |
| --- | --- | --- |
| Append `- immo.sent-tech.ca` only to MCP Ingress `tls.hosts` | 1 | `Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca` |
| Same TLS-only mutation using `IMMO.SENT-TECH.CA` | 1 | `Ingress/radar-immo-mcp: PROD routing host -> - IMMO.SENT-TECH.CA` |
| Add a second MCP Ingress rule with `host: immo.sent-tech.ca` and the existing `/mcp` backend | 1 | `Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca` |
| Change only MCP Ingress `secretName` to `radar-immo-tls` | 1 | `Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls` |
| Change only MCP Ingress rule host to prod; retain preprod TLS | 1 | Only `Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca` |
| Change only UI Ingress rule host to prod; retain preprod TLS | 1 | Only `Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca` |
| Delete rendered `IMMO_MCP_OAUTH_ISSUER` | 1 | `ConfigMap/immo-mcp-config: IMMO_MCP_OAUTH_ISSUER missing (expected https://preprod.auth.sent-tech.ca)` |
| Delete rendered `IMMO_MCP_OAUTH_RESOURCE` | 1 | `ConfigMap/immo-mcp-config: IMMO_MCP_OAUTH_RESOURCE missing (expected https://preprod.immo.sent-tech.ca/mcp)` |
| Delete rendered `RADAR_PUBLIC_BASE_URL` | 1 | `ConfigMap/immo-mcp-config: RADAR_PUBLIC_BASE_URL missing (expected https://preprod.immo.sent-tech.ca)` |
| Set API and MCP issuer keys to `https://idp.preprod.sent-tech.ca` | 1 | Both pinned-issuer failures; no issuer-mismatch diagnostic |
| Double-quote wrong MCP resource `https://preprod.immo.sent-tech.ca/api/mcp` | 1 | Wrong-resource expected-value diagnostic |
| Double-quote all eight valid pinned values | 0 | `preprod auth isolation: ok ... 8 preprod keys pinned ...` |
| Single-quote the same wrong MCP resource | 1 | The same wrong-resource expected-value diagnostic |
| Single-quote all eight valid pinned values | 0 | `preprod auth isolation: ok ...` |
| Reverse ConfigMap uppercase data-key order | 0 | `preprod auth isolation: ok ...` |
| Move ConfigMap kind/metadata before its apiVersion/data section | 0 | `preprod auth isolation: ok ...` |
| Delete MCP resource from that reordered render | 1 | `ConfigMap/immo-mcp-config: IMMO_MCP_OAUTH_RESOURCE missing ...` |
| Append a Deployment with `EXTRA_CLIENT_ID` env value `"radar-immobilier"` | 1 | `Deployment/extra-client-id: PROD client id (env) -> - name: EXTRA_CLIENT_ID` |
| Same env case with value `'radar-immobilier'` | 1 | The same env/client-ID rejection |
| Inject an awk executable that prints `injected awk failure` and exits 7 | 1 | Injected error plus guard failure footer; success message absent |
| Set KUBECTL to a stub that prints `injected renderer failure` and exits 17 | 1 | `FAIL: cannot render .../deploy/overlays/preprod` |
| Use a nonexistent input path | 1 | `FAIL: ... is neither a render file nor a repo root` |

Representative mutation commands from the helper, with `R` denoting the baseline file:

```bash
# Remove each MCP key from the rendered data (not just its overlay override).
awk -v key="$key" '$0 !~ "^  " key ":" { print }' "$R" > "$mutated"

# Same third issuer on both pinned ConfigMaps still fails their expected values.
sed -e 's#IMMO_MCP_OAUTH_ISSUER: https://preprod.auth.sent-tech.ca#IMMO_MCP_OAUTH_ISSUER: https://idp.preprod.sent-tech.ca#' \
    -e 's#SENTROPIC_IDP_ISSUER: https://preprod.auth.sent-tech.ca#SENTROPIC_IDP_ISSUER: https://idp.preprod.sent-tech.ca#' "$R" > "$mutated"

# An isolated Ingress rule-host mutation, leaving its TLS host untouched.
awk -v target="$target" '/^---$/ { name="" } /^  name:/ { name=$2 }
  name == target { sub(/host: preprod.immo.sent-tech.ca/, "host: immo.sent-tech.ca") }
  { print }' "$R" > "$mutated"
```

Public HTTPS checks ran on 2026-10-09, with response `Date` headers around 10:09:58–10:10:26 GMT. No redirects were followed; no authorization header was sent:

```bash
curl --max-time 25 -sS -D "$headers" "https://$host/.well-known/oauth-authorization-server" -o "$body"
curl --max-time 25 -sS -D "$headers" -X POST -H 'content-type: application/json' -d '{}' "https://$host/mcp" -o "$body"
curl --max-time 25 -sS -D "$headers" "https://$host/mcp/.well-known/oauth-protected-resource" -o "$body"
```

| Endpoint | Observed response; each curl exit 0 |
| --- | --- |
| Prod IdP authorization-server metadata | HTTP/2 200, JSON; issuer `https://auth.sent-tech.ca`; `code_challenge_methods_supported=["S256"]`; `token_endpoint_auth_methods_supported=["client_secret_basic","client_secret_post","none"]` |
| Preprod IdP authorization-server metadata | HTTP/2 200, JSON; issuer `https://preprod.auth.sent-tech.ca`; same PKCE/auth-method arrays |
| Prod POST `/mcp` | HTTP/2 401, `application/json`; `WWW-Authenticate: Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"` |
| Prod GET PRM | HTTP/2 200, JSON: `resource=https://immo.sent-tech.ca/mcp`, `authorization_servers=["https://auth.sent-tech.ca"]`, scopes `["immo:read","immo:search","immo:documents:read"]` |
| Preprod POST `/mcp` | HTTP/2 405, `text/html`, `server: nginx`; body contains `<h1>405 Not Allowed</h1>` |
| Preprod GET PRM | HTTP/2 200, `text/html`, `server: nginx`; body begins `<!doctype html>` and contains `<title>Radar immobilier</title>` |

`gh pr view 837 -R rhanka/radar-immobilier` was attempted but returned the GitHub GraphQL classic-projects deprecation error. The read-only fallback `gh pr view 837 -R rhanka/radar-immobilier --json title,body,url,headRefOid` succeeded and returned the requested head SHA and the PR body used for this review.

For production comparisons, tracked `deploy/k8s` files were materialized under scratch using `git ls-tree -r --name-only origin/main deploy/k8s` and `git show "origin/main:$file"`. Both trees were rendered using `kubectl kustomize deploy/k8s` and `kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs-prod`. Comparisons returned:

```text
prod base render cmp exit=0
prod refresh render cmp exit=0
deploy/k8s/30-api.yaml cmp exit=0
deploy/k8s/40-immo-mcp-http-deploy.yaml cmp exit=0
deploy/k8s/41-immo-mcp-ingress.yaml cmp exit=0
deploy/k8s/70-networkpolicy.yaml cmp exit=0
```

`git diff --numstat origin/main...ddce2b4fd930b48f3926dc6081e1c9b886c2c73d -- deploy/k8s .github/workflows/k8s-apply-mcp.yaml` and `git diff --check origin/main...ddce2b4fd930b48f3926dc6081e1c9b886c2c73d` both produced no output, exit 0.

## Findings

### SOL-837-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/check-preprod-auth-isolation.test.sh:96` and `:99`.
- **Evidence:** Both named Ingress tests execute the identical unrestricted substitution in the shared patch. The instrumented rerun printed four failures for each case: UI rule, UI TLS host, MCP rule, MCP TLS host. Therefore these two tests do not isolate their named Ingress or distinguish rule hosts from TLS hosts. They are not no-ops, and their assertions do require the named object's message. My isolated UI-rule-only, MCP-rule-only, and MCP-TLS-only mutations each returned exit 1 with only the intended diagnostic, so no current guard defect was demonstrated.
- **Fix:** Make each test change only its named rendered object/rule, and add a separate TLS-host-only case. An isolated render mutation is sufficient; retain the existing expected-message assertions. This would make a future context-specific guard regression observable without counting the same broad mutation twice.

### SOL-837-02

- **Severity:** non-blocking.
- **File:line:** `/home/antoinefa/src/sentropic/api/src/scripts/oauth-register-client.ts:89`, referenced by PR #837 body, “Remaining after merge” step 3; supporting locations `docs/spec/mcp/claude-ai-connector-setup.md:24` and `api/src/routes/auth.ts:649`.
- **Evidence:** The handoff names token-auth, callback, scopes, and resource variables but omits `OAUTH_CLIENT_ID`. With only those variables, the referenced builder selects `design-system` at line 89, and its DB operation upserts on client ID at line 189. The public metadata has no registration endpoint; the existing connector guide requires explicitly entering the provided client ID. Separately, the forwarded bearer is rejected with `account_not_approved` unless its subject has an approved preprod radar account. The PR's two “End-to-end” curl checks use no token and cannot exercise either connector setup or this approval gate. Existing registrations, accounts, and deployed IdP script revision are unverified. This is a partial operational handoff, not a demonstrated manifest/runtime regression in the PR.
- **Fix:** Specify an explicit dedicated preprod MCP `OAUTH_CLIENT_ID` in the registration recipe; supply that ID to Claude advanced settings with an empty secret and the preprod MCP URL. State that the test user's preprod radar account must be approved. Add post-deploy authenticated acceptance for MCP initialize/tools discovery and a `search_signals` call using the granted immo scopes and preprod resource. Owners: IdP operator for registration, radar operator for account approval, connector operator/user for setup and authenticated acceptance. Keep the existing unauthenticated challenge/PRM probes as routing/discovery checks.

## Verdict

**GO-with-nits.** No blocking finding was demonstrated for this lens at the requested commit. The requested checks, supplied mutations, additional isolated mutations, awk portability checks, and prod-input comparisons produced the outputs above. Operator Ingress installation, IdP/client/account state, and authenticated end-to-end operation remain unverified; they are necessary remaining acceptance work, not outcomes established by this code review.
