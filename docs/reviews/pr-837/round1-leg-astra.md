status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@ddce2b4fd930b48f3926dc6081e1c9b886c2c73d
lens: kustomize-render-prod-invariance-and-deploy-path

## Reasoning

Reviewed `git diff origin/main...ddce2b4fd930b48f3926dc6081e1c9b886c2c73d` independently. HEAD was the target SHA; origin/main was `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. The worktree's deploy files, workflows and Makefile matched the target. No other review leg was read. Repository rules and the using-harness/review instructions were read; this is one dispatched leg, not a consensus result.

No cluster access, real kubeconfig, Python interpreter, stack, commit, push or GitHub write was used. Real kubectl invocations were offline `kustomize` commands, with `KUBECONFIG=/dev/null`. Temporary files, including test fixtures through `TMPDIR`, were confined to `.review-tmp-astra/` and removed after recording this review. The only review artifact written outside that directory is this file. The PR body was read with the explicitly authorized `gh pr view`; public probes used only the two permitted immo HTTPS hosts, without credentials or redirect following.

**Prod invariance.** Both requested prod renders compare byte for byte between the archived base and target. The wider audit also covered the prod migration render, the digest-pinned refresh render used by `promote-prod`, the four files applied by `k8s-apply-mcp.yaml`, the prod job templates and ConfigMaps selected by `run-job.yaml`, the prod bascule bundle, and the daily-backup manifests/script ConfigMap. All compared inputs and outputs were identical. Existing sealed manifests were compared/rendered without printing their contents; none was introduced or changed by this PR.

All 11 other workflow files were byte-identical. In `build-push-images.yml`, removing comment-only lines yielded identical files; the entire prefix before the preprod section and the entire `promote-prod` job also compared byte-identically. The 10 added/9 removed lines are comments belonging to the preprod section: one hunk is its introductory comment before the `deploy-preprod:` key, and the other two are inside that job. No executable workflow line changes. The prod `deploy` and `promote-prod` jobs do not call the changed reconcile script. Runtime secret values and live prod objects were not read; this proves checked-in inputs/render invariance, not live-state equality.

**Every preprod render change.** Base contains 27 objects, target 31: four additions, one changed existing object, 26 byte-identical objects, no removals. The namespace assertion covered every rendered object; namespaced objects use `radar-immobilier-preprod`, and the Namespace object has that name.

| Object | Rendered change and checks |
| --- | --- |
| ConfigMap `immo-mcp-config` | Added from prod file 40. Eight data keys; exactly the three intended URL/issuer keys differ from the normalized prod ConfigMap. Labels are component `mcp`, name `radar-immobilier`, part-of `sentropic`. |
| Service `radar-immo-mcp` | Added. Selector `app.kubernetes.io/name=radar-immobilier`, `app.kubernetes.io/component=mcp` matches the pod labels. Port name `http`, port 8848, targetPort `http`. Same three MCP labels. |
| Deployment `radar-immo-mcp` | Added to the render, not the CD apply set. One replica, Recreate, same selector/pod labels as the Service, container `mcp`, named container port `http:8848`, `envFrom` ConfigMap `immo-mcp-config`, same readiness/liveness PRM path as prod. The only explicit workload override is requests.cpu 50m to 10m. Other resources/security settings are inherited. Image remains the base `ghcr.io/rhanka/radar-api:latest` in this render; CD only sets its image to the release tag. |
| Ingress `radar-immo-mcp` | Added. Namespace preprod; class `traefik`; host and TLS host `preprod.immo.sent-tech.ca`; TLS Secret `radar-immo-preprod-tls`; `/mcp` with pathType `Prefix` targets Service `radar-immo-mcp`, port name `http`. This includes the nested PRM URL. Annotations are websecure and router.tls=true. No cert-manager issuer annotation, so it reuses the UI's TLS Secret. |
| Ingress `radar` | Only rule host, TLS host and TLS Secret change relative to the base preprod render, from prod values to the same preprod values above. `/` Prefix to `radar-ui:http`, the `letsencrypt-prod` ClusterIssuer annotation, Traefik annotations/class and labels remain unchanged. |

The new MCP objects are direct overlay resources, so they do not acquire the base kustomization's `sentropic.dev/workspace` label. That is also absent from the raw 40/41 files prod applies. Deployment/Service selectors still match. Existing MCP NetworkPolicies are among the unchanged objects and select component `mcp`; actual live enforcement is unverified in this leg.

The three patched ConfigMap values are:

```text
IMMO_MCP_OAUTH_ISSUER=https://preprod.auth.sent-tech.ca
IMMO_MCP_OAUTH_RESOURCE=https://preprod.immo.sent-tech.ca/mcp
RADAR_PUBLIC_BASE_URL=https://preprod.immo.sent-tech.ca
```

The remaining five keys compared identically with prod: `IMMO_MCP_DATA_MODE=http`, `IMMO_MCP_HTTP_PORT=8848`, `IMMO_MCP_OAUTH_SCOPES_SUPPORTED=immo:read immo:search immo:documents:read`, `NODE_OPTIONS=--dns-result-order=ipv4first`, `RADAR_API_BASE_URL=http://radar-api:3000`. The API address is namespace-relative. The preprod API's issuer matches the MCP issuer.

**Deployment path and failure behavior.** Workflow lines 799–800 call reconcile before lines 822–826 set the MCP image and wait for rollout. Reconcile runs with `set -euo pipefail` (line 49), renders and checks auth isolation before any apply (65–72), then evaluates `MCP_PRESENT` (80–85). With a present Deployment it applies the UI/API ConfigMaps, MCP ConfigMap, CronJob, API Deployment and UI Deployment, in that order. It does not apply the MCP Deployment, Service, or either Ingress. With an absent Deployment it omits the MCP ConfigMap and continues; the conditional does not cause an errexit under `set -e`.

`deploy/k8s/11-ci-deployer-preprod-rbac.yaml:110` grants configmaps get/list/create/patch/update, and lines 72–74 grant deployments get/list/watch/patch/update. Thus the added GET and server-side ConfigMap apply, including field ownership through `--force-conflicts`, are within the committed Role. The Role has no Ingress grant, and reconcile introduces no networking apply. The live Role/Binding and admission policies are unverified.

The new ConfigMap apply is a new failure point for preprod CD: an API/admission failure stops the job before set-image, as intended by the script's failure policy. There is no demonstrated missing RBAC grant or shell-error regression on the normal path. Mocked nonzero apply and filter results both stopped the script before the CronJob and Deployment applies. The initial `kubectl diff` is explicitly diagnostic (`|| true`), so failures there do not abort; later applies still decide the outcome. Reconcile is not transactional: earlier ConfigMaps can already have been applied when the MCP ConfigMap fails.

The MCP pod reads `envFrom` at startup (`deploy/k8s/40-immo-mcp-http-deploy.yaml:153`); `packages/immo-mcp/src/server-http.ts:248` loads that process environment when constructing the app. Changing the image string changes the pod template and requests a new rollout, whose started pod reads the new ConfigMap. An unchanged tag does not change that template: see ASTRA-837-01. A successful pod replacement is also not enforced by the current workflow: line 826 converts an MCP rollout timeout into a warning. Actual rollout/readiness and post-deploy config uptake are unverified; the public probes below were before deployment of this PR.

The lookup guard treats any failed GET as absence, not only NotFound: see ASTRA-837-02. This is separate from the demonstrated failure-on-error behavior once the ConfigMap is selected for apply.

**Operator handoff and host ownership.** After removing Markdown indentation, the PR body's Ingress heredoc compares byte-identically with the rendered `Ingress/radar-immo-mcp`. Its name and explicit namespace agree with the command's `-n radar-immobilier-preprod`. No stale prod host, prod Secret name, unintended path or extra annotation was found. The command requests server-side apply without force; live field conflicts/admission outcomes are unverified. Its documented owner step is necessary because CD does not apply the Ingress. Dispatching the prod-only `k8s-apply-mcp.yaml` is explicitly excluded by the PR body.

For the UI Ingress, the render agrees with the supplied live summary on namespace, host, TLS Secret and `/` route. Full live-object equality is **unverified**: no live YAML was supplied or read, so existing labels, class, annotations and managed fields cannot be compared. In particular the render includes `sentropic.dev/workspace: radar-immobilier` and the cert-manager annotation. Applying it could reconcile metadata not covered by the summary. The PR body only instructs applying the MCP Ingress, so that uncertainty does not prevent its stated operator procedure.

Neither target Ingress claims a prod host, and all new auth/public URLs are preprod. The UI Ingress's previous prod host in the *base preprod render* is removed. The JSON patch acts on index 0; both current Ingresses have exactly one rule and one TLS host. Additional future entries are not rewritten by those three operations; a prod hostname left there would instead be rejected by the rendered auth-isolation gate. The comment saying every future shape change makes rendering fail is broader than these operations guarantee, but no current render defect was demonstrated. An operator applying the raw prod files instead of the documented rendered Ingress would bypass this procedure; the reviewed heredoc does not do so.

The public unauthenticated behavior is independently reproduced below. Authenticated connector authorization, IdP client registration, tool execution and network-policy enforcement are **not covered**. The PR body explicitly leaves the preprod public PKCE client to the IdP operator and calls its current existence unverified.

## Commands and outputs

Commands were run via `rtk`; wrappers are omitted below where they do not affect the command. Temporary helper code used only Bash/Node and offline kubectl. No production/prod-like service was started.

**Target/base and workflow proof:**

```text
git branch --show-current
fix/mcp-preprod-expose
git rev-parse HEAD origin/main
ddce2b4fd930b48f3926dc6081e1c9b886c2c73d
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet ddce2b4fd930b48f3926dc6081e1c9b886c2c73d -- deploy .github/workflows Makefile
exit 0
git archive origin/main deploy .github/workflows | tar -x -C .review-tmp-astra/base
exit 0
git diff --numstat origin/main...ddce2b4fd930b48f3926dc6081e1c9b886c2c73d -- .github/workflows/build-push-images.yml
10  9  .github/workflows/build-push-images.yml
```

An offline Node helper invoked `cmp` on archived/target files and equivalent renders. Its input inventory was obtained by reading all `.github/workflows/*.{yml,yaml}` apply/render paths, including script/template references. Output:

```text
All archived deploy inputs: 169 byte-identical files; changed=deploy/ci/check-preprod-auth-isolation.sh, deploy/ci/check-preprod-auth-isolation.test.sh, deploy/ci/reconcile-preprod.sh, deploy/overlays/preprod/kustomization.yaml
workflow-noncomments: cmp exit 0
workflow-before-preprod: cmp exit 0
workflow-promote-prod: cmp exit 0
Other workflow files: 11 cmp exit 0
```

The two new preprod patch files have no base counterpart. `workflow-noncomments` removes lines matching `^\s*#.*\n`; `workflow-before-preprod` compares the prefix before `  # CD refonte — Lot 2`; `workflow-promote-prod` compares from `  promote-prod:` to EOF. These complement inspection of all three workflow hunks.

**Renders and prod inputs:**

```bash
export KUBECONFIG=/dev/null
kubectl kustomize .review-tmp-astra/base/deploy/k8s > .review-tmp-astra/out/base-prod.yaml
kubectl kustomize deploy/k8s > .review-tmp-astra/out/target-prod.yaml
cmp .review-tmp-astra/out/base-prod.yaml .review-tmp-astra/out/target-prod.yaml
# prod cmp_exit=0
kubectl kustomize --load-restrictor LoadRestrictionsNone .review-tmp-astra/base/deploy/k8s/refresh-cronjobs-prod > .review-tmp-astra/out/base-prod-refresh.yaml
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s/refresh-cronjobs-prod > .review-tmp-astra/out/target-prod-refresh.yaml
cmp .review-tmp-astra/out/base-prod-refresh.yaml .review-tmp-astra/out/target-prod-refresh.yaml
# prod-refresh cmp_exit=0
```

Each file in the table below was raw-compared with `cmp` and normalized offline with `kubectl kustomize` in a temporary wrapper containing `resources: [object.yaml]`. The two normalized outputs also compared with exit 0. For run-job templates, both sides received identical concrete substitutions: image `ghcr.io/rhanka/radar-api@sha256:` followed by 64 zeroes, city `brossard`, chunk size `10`, backup id `review-astra-837`, recovery args `--apply --heal brossard`, repair args `--apply brossard`, mapper reset `1`. This was rendering only; those Jobs were not run.

| Prod apply path | Files with raw and normalized `cmp` exit 0 |
| --- | --- |
| `k8s-apply-mcp.yaml`; file 40 also in prod deploy/promote | `deploy/k8s/30-api.yaml`, `40-immo-mcp-http-deploy.yaml`, `41-immo-mcp-ingress.yaml`, `70-networkpolicy.yaml` |
| `run-job.yaml` prod selections | `deploy/k8s/35-run-geo-mapper-job.yaml`, `42-graph-city-key-repair-job.yaml`, `35-consistency-snapshot-job.yaml`, `32-graph-projection-only-job.yaml`, `37-graphify34-apply-job.yaml`, `37-graphify34-slugs-configmap.yaml`, `38-graphify34-emit-candidates-job.yaml`, `38-graphify34-set167-configmap.yaml`, `33b-scrape-cities-job.yaml`, `33-scrape-chunk-loop-configmap.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml`, `41-document-date-recovery-job.yaml` |
| `bascule-bundle-cd.yml` prod bundle | `deploy/ci/bascule-preprod/radar-db-ro-prod-sealed.yaml`, `radar-pra-admin-prod-sealed.yaml`, `db-ro-role-provision.yaml`, `cronjob-db-backup-prod.yaml`, `vap-ci-trigger-suspend-only.yaml`, `rbac-ci-trigger-prod.yaml` |
| `bascule-bundle-cd.yml` prod backup | `deploy/ci/backup/cronjob-backup-daily.yaml`, `cronjob-backup-freshness.yaml` |

Additional generated prod payload comparisons:

```text
prod-migration: cmp exit 0
prod-backup-before-release: cmp exit 0
prod refresh render-prod (fixed digest): cmp exit 0
backup ConfigMap (including db-backup component label): cmp exit 0
```

Migration: `36-db-migrate-job.yaml` with the workflow's namespace/nameSuffix/image transform, namespace `radar-immobilier`, suffix `-ddce2b4`, and the same dummy digest. Backup-before-release: `deploy/ci/db-backup-job.tmpl.yaml` with identical nonsecret fixture substitutions for its declared envsubst variables; raw template and generating script also compare identically. Daily backup ConfigMap: offline kustomize generator from the identical `backup-daily.cjs` bytes, fixed name/no suffix, prod namespace and all three workflow labels (name, part-of, component `db-backup`). This checks the equivalent payload, not a live `kubectl create/apply` execution. Runtime-sourced backup Secrets were not read or rendered.

The actual digest-pin render target was executed for each checkout:

```bash
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute path under .review-tmp-astra/out> ENV=review-astra-837
# both exit 0; cmp exit 0
```

**Preprod and operator comparison:**

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone .review-tmp-astra/base/deploy/overlays/preprod > .review-tmp-astra/out/base-preprod.yaml
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod > .review-tmp-astra/out/target-preprod.yaml
diff -u .review-tmp-astra/out/base-preprod.yaml .review-tmp-astra/out/target-preprod.yaml
# exit 1: the four additions and the three UI Ingress field replacements described above
gh pr view 837 -R rhanka/radar-immobilier --json body --jq .body
# body read; MCP heredoc extracted and dedented for cmp
```

Document comparison used the rendered top-level kind, metadata.name and metadata.namespace; nonmodified documents were compared as text. ConfigMap comparison selected its data block and excluded only the three named patched keys. Output:

```text
PREPROD ADDED ConfigMap/radar-immobilier-preprod/immo-mcp-config
PREPROD ADDED Service/radar-immobilier-preprod/radar-immo-mcp
PREPROD ADDED Deployment/radar-immobilier-preprod/radar-immo-mcp
PREPROD CHANGED Ingress/radar-immobilier-preprod/radar
PREPROD ADDED Ingress/radar-immobilier-preprod/radar-immo-mcp
PREPROD objects base=27 target=31 unchanged=26 removed=0
PREPROD namespace assertions: all objects preprod (Namespace name included)
mcp-unpatched-keys: cmp exit 0
MCP keys base=8 target=8; only 3 environment keys differ
operator-ingress: cmp exit 0
```

**Requested checks:** `TMPDIR=$PWD/.review-tmp-astra/tmp`, `KUBECONFIG=/dev/null`, `K8S_VALIDATE_WITH_CLUSTER=0` were exported before execution.

```text
make k8s-validate ENV=review-astra-837
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
make_exit=0

bash deploy/ci/check-preprod-auth-isolation.test.sh
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
test_exit=0
```

**Shell control-flow checks:** `bash .review-tmp-astra/mock-reconcile.sh` ran the unchanged `deploy/ci/reconcile-preprod.sh` with exported Bash functions. `kubectl` was completely mocked: render returned the already captured offline target render, diff returned 1, apply consumed/logged stdin, and GET returned the selected result. A Bash function named `python3` dispatched a small Node text filter instead of any Python executable. Therefore the original Python filter's execution is **not covered** by this check; its source was read. The actual reconcile branches, ordering, errexit and pipefail behavior were exercised. Outputs:

```text
present exit=0
APPLY ConfigMap/radar-ui-nginx-2mbb7bh924
APPLY ConfigMap/radar-api
APPLY ConfigMap/immo-mcp-config
APPLY CronJob/radar-consistency-snapshot
APPLY Deployment/radar-api
APPLY Deployment/radar-ui

absent exit=0
radar-immo-mcp Deployment absent in radar-immobilier-preprod — skipping ConfigMap immo-mcp-config
APPLY ConfigMap/radar-ui-nginx-2mbb7bh924
APPLY ConfigMap/radar-api
APPLY CronJob/radar-consistency-snapshot
APPLY Deployment/radar-api
APPLY Deployment/radar-ui

forbidden exit=0
radar-immo-mcp Deployment absent in radar-immobilier-preprod — skipping ConfigMap immo-mcp-config
APPLY ConfigMap/radar-ui-nginx-2mbb7bh924
APPLY ConfigMap/radar-api
APPLY CronJob/radar-consistency-snapshot
APPLY Deployment/radar-api
APPLY Deployment/radar-ui

apply-failure exit=19
mock ConfigMap apply failure
APPLY ConfigMap/radar-ui-nginx-2mbb7bh924
APPLY ConfigMap/radar-api
APPLY ConfigMap/immo-mcp-config

filter-failure exit=17
APPLY ConfigMap/radar-ui-nginx-2mbb7bh924
APPLY ConfigMap/radar-api
APPLY /
```

`APPLY /` is the mock consuming empty stdin after the injected filter failure; the mock returned 0, but pipefail still propagated filter exit 17. Present, absent and forbidden scenarios printed `reconcile OK`; the two error scenarios did not and did not reach later applies. No actual lookup/apply/diff was sent to a cluster.

**Public probes, 2026-10-09 10:00:13–14 UTC:**

```bash
curl --silent --show-error --max-time 25 --include --request POST \
  --header 'Content-Type: application/json' --data '{}' https://immo.sent-tech.ca/mcp
curl --silent --show-error --max-time 25 --include \
  https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource
curl --silent --show-error --max-time 25 --include --request POST \
  --header 'Content-Type: application/json' --data '{}' https://preprod.immo.sent-tech.ca/mcp
curl --silent --show-error --max-time 25 --include \
  https://preprod.immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource
```

All four curl commands exited 0. Relevant response output (header names preserved; unrelated headers omitted):

```text
immo.sent-tech.ca POST /mcp
HTTP/2 401
content-type: application/json
www-authenticate: Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"
{"error":{"code":"invalid_token","message":"Authorization header is required."}}

immo.sent-tech.ca GET /mcp/.well-known/oauth-protected-resource
HTTP/2 200
cache-control: public, max-age=300
content-type: application/json
{"resource":"https://immo.sent-tech.ca/mcp","authorization_servers":["https://auth.sent-tech.ca"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA"],"scopes_supported":["immo:read","immo:search","immo:documents:read"]}

preprod.immo.sent-tech.ca POST /mcp
HTTP/2 405
content-type: text/html
server: nginx
content-length: 150
<html>
<head><title>405 Not Allowed</title></head>
<body>
<center><h1>405 Not Allowed</h1></center>
<hr><center>nginx</center>
</body>
</html>

preprod.immo.sent-tech.ca GET /mcp/.well-known/oauth-protected-resource
HTTP/2 200
content-type: text/html
server: nginx
content-length: 673
```

The last response's body was the HTML SPA, including `<title>Radar immobilier</title>`, `<div id="app"></div>`, script `/assets/index-Bmjq7Adf.js` and stylesheet `/assets/index-BQdUqYKP.css`; it was not PRM JSON. These probes corroborate the reported symptom and prod reference behavior. They do not validate a deployment of this unmerged change.

## Findings

**ASTRA-837-01 — unchanged-image retries do not ensure the MCP reads the reconciled environment**

- Severity: **non-blocking**.
- File:line: `deploy/ci/reconcile-preprod.sh:117` (apply at 120–122); `.github/workflows/build-push-images.yml:822` (image/rollout step).
- Evidence: reconcile writes the fixed-name ConfigMap but never changes the MCP Deployment. The workflow only sets `mcp=${IMAGE_PREFIX}/radar-api:${SHA}`. The Deployment consumes that ConfigMap through `envFrom` (`deploy/k8s/40-immo-mcp-http-deploy.yaml:153`); the server reads the process environment once at startup (`packages/immo-mcp/src/server-http.ts:248`). If that image string is already current, set-image does not change the pod template, so the ConfigMap can be corrected while the existing process continues using its previous issuer/resource/public URL. `rollout status` can refer to the already completed rollout. This conclusion follows from the declared update path; a live same-SHA retry was not run.
- Impact and scope: relevant to a same-SHA redeploy after ConfigMap drift, or retry after an earlier release already set the image. It does not invalidate the expected first deployment with a different merged SHA and a completed rollout. No current occurrence is claimed.
- Fix: explicitly restart or change a preprod MCP pod-template config checksum when reconciliation changes its environment, including when the image is unchanged; alternatively document the required same-SHA operator restart and narrow the comments' unconditional rollout claim. Verify both changed-image and unchanged-image cases using the advertised PRM resource/issuer after pod replacement. Keep prod untouched.

**ASTRA-837-02 — a failed Deployment lookup is reported as absence and skips reconciliation**

- Severity: **non-blocking**.
- File:line: `deploy/ci/reconcile-preprod.sh:81`.
- Evidence: the guard discards all stderr and treats every nonzero `kubectl get` result as absence. The unchanged script, run with a mocked GET returning `Error from server (Forbidden)` and exit 1, printed `Deployment absent`, omitted `ConfigMap/immo-mcp-config`, continued all other applies, printed `reconcile OK`, and exited 0. A NotFound response took the same path. The mock output is recorded above.
- Impact and scope: an authorization/transport error is not evidence that the Deployment is absent. The config correction is skipped in that branch. If a subsequent independent lookup in the workflow succeeds, it can roll the MCP with its unreconciled ConfigMap. This is an error-path limit, not a demonstrated live failure; the committed Role grants the normal GET, and the existing image step uses the same broad guard.
- Fix: distinguish NotFound from a failed read, for example `get --ignore-not-found -o name`, skip only a successful empty result, and propagate other lookup failures with their diagnostic. Keep the absent-Deployment skip, and test present, absent and failed-read branches without cluster access.

## Verdict

**GO-with-nits.** No blocking defect was demonstrated in the reviewed render/deploy path. Prod inputs and renders are byte-identical; preprod routing/configuration and the operator heredoc match the intended change; both requested checks pass. The two findings concern retry and lookup-error behavior. Deployment outcome, full live UI Ingress equality, and authenticated end-to-end use remain unverified or not covered as specified above. The documented post-merge MCP Ingress apply and IdP operator work remain necessary.
