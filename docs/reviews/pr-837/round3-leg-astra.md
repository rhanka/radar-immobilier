status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@bc89161a8ddd4b49e87b1a05c46c381e52f5de40
lens: kustomize-render-prod-invariance-and-deploy-path (round 3)

## Reasoning

Reviewed `origin/main...bc89161a8ddd4b49e87b1a05c46c381e52f5de40` and the round-3 delta from `220c5c37`. Base resolved to `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Worktree HEAD was `eb35da93a32ccb8607df65122753c7ac037afcba`; the deploy files, workflows, Makefile, API Dockerfile and UI nginx configuration compared identically with the requested target. Base and target archives supplied the render comparisons and mutation fixtures. I read both of my previous prompts and reviews, the repository rules and the using-harness/review guidance. No review file with `sol` in its name was read, and no peer was contacted. This is one independent leg, not a consensus result.

No cluster access, real kubeconfig, Python interpreter, stack, commit, push or GitHub write was used. Real kubectl calls were offline rendering, local patch/image operations, client-only ConfigMap generation and client version inspection, with `KUBECONFIG=/dev/null`. Public probes used only the two authorized immo HTTPS hosts, without credentials or redirect following. Throwaway files were confined to `.review-tmp-astra-r3/`, including subprocess temporary files through `TMPDIR`, and deleted at completion. This review is the only retained modification.

**Test boundary.** The committed reconcile test invokes the existing Python `kfilter.py`. As in round 2, a review-only `python3` PATH adapter dispatched only that filter call to a Node translation of its document-selection logic. No Python ran and no repository script was changed for the successful checks. The reported reconcile suite, independent mocks and mutation results cover the actual Bash scripts, real offline kustomize and auth/header gates, with that filter substitution. Execution of the original Python filter is **not covered**; its unchanged standard-library source was inspected. Auth-isolation and `make k8s-validate` ran without this substitution. Hosted CI execution is **unverified**.

**Retry and annotation correctness.** The new sequence at `deploy/ci/reconcile-preprod.sh:129` is ConfigMap apply → read its live resourceVersion → require a nonempty value → read the pod-template annotation → merge-patch it if unequal. It no longer depends on a pre-apply diff signal. The independent fake API actually changed its stored ConfigMap version during the first successful apply, failed the following patch with exit 23, and retained state. The second run reapplied the already-current ConfigMap, observed the still-stale annotation and successfully patched it. Running the workflow's actual image-step shell body afterward with the same image string exited 0 and left the new annotation intact. A third settled run performed no patch. This resolves the omission demonstrated in round 2; these are command-path/API-effect checks, not observations of real pods.

The exact JSONPath from line 134 was exercised with the real kubectl v1.35.3 JSONPath printer through `patch --local`. Single quotes preserve `\.` for kubectl; the escaped dot belongs to the literal key `sentropic.dev/immo-mcp-config-rv`, while the slash needs no escaping in this expression. The existing annotation returned `101` and exit 0. A missing key and a missing annotations map each returned empty output and exit 0. With a nonempty ConfigMap version, either missing form therefore differs and enters the patch branch. The independent reconcile mock also exercised the existing-Deployment/missing-annotation case and recorded an accepted patch. Local merge-patch and subsequent `set image --local` checks confirmed that unrelated annotations and the container/image survive the first patch, and the config-version annotation survives the image update. The code compares resource versions as strings; it does not order them or perform arithmetic on them.

**No-op server-side apply and documentation.** The specific assertion at `reconcile-preprod.sh:126` that a no-op server-side apply leaves resourceVersion unchanged is **unverified** in this review. No API server was used, and both the committed fake and the independent fake model this behavior rather than prove it. The relevant official references are [Kubernetes resource versions](https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-versions) and [Server-Side Apply / field management](https://kubernetes.io/docs/reference/using-api/server-side-apply/). These are reference links, not fetched evidence: `kubernetes.io` is outside the four permitted HTTPS hosts, so I cannot cite a checked documentation passage establishing this precise guarantee. In particular, unchanged ConfigMap data is insufficient to establish that the *entire object*, including field ownership or other metadata, is unchanged. An extra resourceVersion change would request an extra rollout; it would not recreate the lost-retry-signal defect. No incorrect no-op behavior of the reviewed implementation was demonstrated.

**Bash and RBAC.** The script retains `set -euo pipefail` at line 49. The single-command lookup assignment at line 83 propagates a failed GET; only a successful empty `--ignore-not-found -o name` result skips the MCP branch. The apply pipeline at lines 129–130 propagates filter or kubectl failure. Both new GET assignments propagate nonzero status. `${mcp_cm_rv:?...}` fails for an empty successful read; the possibly empty annotation is assigned before use and is valid under nounset. The ordinary patch command is not inside a status-suppressing condition. Injected lookup, apply, ConfigMap GET, annotation GET, empty-version and patch failures all stopped before later durable-object applies and omitted `reconcile OK`. An injected filter failure propagated exit 17 even when the downstream fake apply returned 0. The earlier aggregate diff remains diagnostic with `|| true`; it is no longer the source of the MCP update decision.

The committed preprod Role grants deployments get/list/watch/patch/update at `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72` and configmaps get/list/create/patch/update at line 110. These cover the initial and annotation Deployment reads, merge patch, ConfigMap server-side apply and subsequent ConfigMap GET. No Deployment creation or Ingress permission is required by the new code. Live Role/Binding and admission configuration are **unverified**. An API/admission failure in a new GET or patch can fail preprod CD; that is visible, fail-closed behavior, not a missing grant demonstrated by this review. Reconcile is not transactional: earlier ConfigMaps, including the MCP ConfigMap, can have been persisted before a later failure.

**Following set-image, Recreate and availability.** Reconcile precedes the image step (`build-push-images.yml:799`, `:824`). Its patch does not write an image; set-image subsequently changes the image without deleting the annotation. With a new image, these are two pod-template updates. Depending on controller timing they can produce two replacements or converge directly on the latest template; there is no wait between them. With one replica and `Recreate` (`40-immo-mcp-http-deploy.yaml:113`–118), uninterrupted MCP availability cannot be claimed. Replacement entails a period without a serving pod, and a replacement that cannot start/become ready can leave the MCP unavailable. An accepted template patch is not evidence of successful environment uptake or readiness.

The new configuration still supplies the same five non-environment keys and the required issuer/resource values. `envFrom` is at line 153 of file 40; the application loads `process.env` at `packages/immo-mcp/src/server-http.ts:248`. No concrete new startup/crash-loop defect was demonstrated. Live image compatibility and controller outcome remain **unverified**.

The workflow's unchanged MCP rollout check at lines 826–827 converts failure after 180 seconds to a warning. Injecting rollout exit 24 into the extracted image-step body yielded exit 0 and the optional-connector warning. The later hard rollout checks name radar-api and radar-ui only (lines 883–884). Consequently CD can succeed while MCP availability is **unverified**, including an unavailable MCP; this limitation was already recorded in rounds 1 and 2. Conversely, a failed set-image call does fail that step: injected exit 25 was preserved after the annotation patch had succeeded. There is no automatic rollback of the first template update in that case. I therefore do not certify that two updates cannot fail CD or leave the MCP down; I found no new deterministic failure in their normal ordering.

**Tests and isolation.** Each top-level case resets both state files, creates/truncates a distinct call log and launches a new reconcile process with explicit lookup/patch settings (`reconcile-preprod-mcp.test.sh:48`–55). Only the patch-failure/retry pair deliberately retains state. The stale case checks apply-before-patch; the current and absent cases prohibit patches; lookup and empty-version cases require failure. The retry pair requires first-run failure and a successful patch on retry. Six targeted regressions and the exact round-2 reconcile were rejected, as detailed below. The final `[ "$FAIL" -eq 0 ]` provides the suite's exit status under its intentional `set -uo pipefail`.

Coverage is **partial** for the new protocol: the fake apply does not change resourceVersion, the GET handlers ignore JSONPath, no present-Deployment case starts with a missing annotation, and the retry test does not execute set-image or any controller. Three corresponding mutations survive the committed suite; see ASTRA-837-R3-01. Independent checks above cover the current implementation for these paths, but do not strengthen the checked-in suite. The CI step remains after `azure/setup-kubectl@v4` in the Ubuntu `quality` job; its dependencies are Bash/core utilities, awk, kubectl's embedded kustomize and Python standard library. Exact hosted-runner execution is **not covered**.

**Prod invariance.** All 25 raw prod apply inputs listed below and their normalized renders compare byte-identically with origin/main. The main prod tree, prod refresh overlay, digest-pinned refresh make target, migration payload, pre-release backup payload and actual client-generated/labeled daily-backup ConfigMap also compare identically. Of existing archived deploy files, 169 are identical and four differ: the preprod auth guard, its test, reconcile and preprod kustomization. Added deploy files are the reconcile test and the two preprod patches. No `deploy/k8s` file changes.

For `build-push-images.yml`, stripping comment-only lines gives identical bytes; the prefix before the preprod section and the entire `promote-prod` job also compare identically. All changed lines are comments in or introducing deploy-preprod. Removing the one new three-line test step from `ci.yml` reproduces base bytes; the other ten workflow files are identical. Prod jobs do not call the changed reconcile script. This establishes checked-in input/render invariance, not live-state or runtime-Secret equality.

The preprod comparison still yields four added objects (MCP ConfigMap, Service, Deployment and Ingress), one changed existing object (UI Ingress host/TLS fields), 26 identical objects and no removals. All namespaces are preprod. The MCP's five unpatched ConfigMap keys compare identically with normalized prod. The overlays and base manifests are unchanged from round 2; the previously reviewed `/mcp` Prefix, `http:8848` service mapping, selectors, preprod issuer/resource/public URL and shared preprod TLS Secret therefore remain the same. Reconcile still applies neither Ingress nor the MCP Deployment/Service manifest. Operator Ingress application and IdP/authenticated acceptance remain necessary; the current PR body was not re-fetched in this round. Public probes below still show the pre-deployment routing symptom, not a deployment validation of this target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| ASTRA-837-01 | non-blocking | resolved | `reconcile-preprod.sh:129`–138 now reconciles a pod-template version independently of the image. The independent same-image retry accepted the missing patch with zero image changes; the missing-annotation case patched successfully. A settled third run omitted the patch. Actual pod readiness remains unverified, distinct from the original omitted-update finding. |
| ASTRA-837-02 | non-blocking | resolved | Line 83 retains the NotFound-only guard. Successful empty lookup exits 0 with no MCP apply/patch; injected failed lookup exits 7 before every apply, with its error visible and no `reconcile OK`. Suppressing lookup errors is rejected by the committed suite. |
| ASTRA-837-R2-01 | non-blocking | resolved | The adapted two-run reproduction applies the new ConfigMap at rv 101, fails patch with exit 23 and retains annotation 100. The same-image retry reads rv 101 after its no-op apply and patches annotation 101, then the actual image-step body exits 0. The change signal is no longer consumed by ConfigMap application. Swallowing patch failure and deleting the patch are both rejected by the committed suite. |

## New findings

**ASTRA-837-R3-01 — the fake API misses three regressions in the annotation protocol**

- Severity: **non-blocking**.
- File:line: `deploy/ci/reconcile-preprod-mcp.test.sh:31`–36 (GET/apply fake), `:64`–72 (version fixtures), `:85`–89 (retry case).
- Evidence: on three separate archived-target copies, (1) moving the ConfigMap version read before its apply, (2) removing `\` before the dot in the annotation JSONPath, and (3) changing the patch condition to require a nonempty existing annotation each produced `PASS=6 FAIL=0`, exit 0. Apply never changes the fake's version, GET ignores the requested JSONPath, and the only empty-annotation fixture also has an absent Deployment. These mutations would respectively miss a config update when pre-apply version equals the annotation, keep reading an empty value and request needless patches on settled runs, or skip the initial same-image rollout on an existing Deployment without the annotation. The submitted reconcile code itself does not contain these mutations; its correct behavior was independently verified above.
- Fix: make a changed ConfigMap apply advance the fake's version and assert the post-apply value; include a present-Deployment/missing-annotation case; verify the exact JSONPath or add a real kubectl local JSONPath fixture. A follow-up settled run should prohibit another patch. Have unexpected fake operations fail instead of silently succeed. Keep these checks offline. Owner: PR author. Acceptance: the three named mutants fail while the submitted script passes.

## Commands and outputs

Commands used `rtk`; wrappers are omitted below. Offline subprocesses used `TMPDIR=$PWD/.review-tmp-astra-r3/tmp`, `KUBECONFIG=/dev/null` and `K8S_VALIDATE_WITH_CLUSTER=0`. Local tools: kubectl v1.35.3, kustomize v5.7.1. Temporary Node/Bash helpers and all fixtures were deleted after recording their results.

**Target and syntax checks:**

```text
git branch --show-current
fix/mcp-preprod-expose
git rev-parse HEAD origin/main
eb35da93a32ccb8607df65122753c7ac037afcba
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet bc89161a8ddd4b49e87b1a05c46c381e52f5de40 -- deploy .github/workflows Makefile api/Dockerfile ui/nginx/default.conf
exit 0
git diff --quiet 220c5c37 bc89161a8ddd4b49e87b1a05c46c381e52f5de40 -- deploy/overlays deploy/k8s
exit 0
bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.test.sh
exit 0
git diff --check
exit 0
```

Archives: `git archive <ref> deploy .github/workflows Makefile api/Dockerfile ui/nginx/default.conf | tar -x -C <review/base-or-target>`, for origin/main and the full target SHA. No review dossier files were archived or scanned.

**Prod comparisons:**

```text
Archived deploy inputs identical=169
changed=deploy/ci/check-preprod-auth-isolation.sh,
        deploy/ci/check-preprod-auth-isolation.test.sh,
        deploy/ci/reconcile-preprod.sh,
        deploy/overlays/preprod/kustomization.yaml
workflow-noncomments: cmp exit 0
workflow-before-preprod: cmp exit 0
workflow-promote-prod: cmp exit 0
ci-minus-new-step: cmp exit 0
Other workflows byte-identical=10
prod: cmp exit 0
prod-refresh: cmp exit 0
Prod raw and normalized files=25 (every cmp exit 0)
refresh-fixed: cmp exit 0
migration-render: cmp exit 0
backup-release-render: cmp exit 0
backup-daily-configmap: cmp exit 0
PREPROD base=27 target=31 unchanged=26 additions=4 changes=1 removed=0; namespaces preprod
mcp-other-five-keys: cmp exit 0
```

Executed for each archive:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s/refresh-cronjobs-prod
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/overlays/preprod
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute-review-output-file> ENV=review-astra-837-r3
```

The 25 raw and normalized prod input comparisons were:

| Workflow path | Compared files |
| --- | --- |
| MCP apply; file 40 also used by prod deploy/promote | `deploy/k8s/{30-api,40-immo-mcp-http-deploy,41-immo-mcp-ingress,70-networkpolicy}.yaml` |
| run-job prod selections | `deploy/k8s/35-run-geo-mapper-job.yaml`, `42-graph-city-key-repair-job.yaml`, `35-consistency-snapshot-job.yaml`, `32-graph-projection-only-job.yaml`, `37-graphify34-apply-job.yaml`, `37-graphify34-slugs-configmap.yaml`, `38-graphify34-emit-candidates-job.yaml`, `38-graphify34-set167-configmap.yaml`, `33b-scrape-cities-job.yaml`, `33-scrape-chunk-loop-configmap.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml`, `41-document-date-recovery-job.yaml` |
| bascule prod bundle | `deploy/ci/bascule-preprod/{radar-db-ro-prod-sealed,radar-pra-admin-prod-sealed,db-ro-role-provision,cronjob-db-backup-prod,vap-ci-trigger-suspend-only,rbac-ci-trigger-prod}.yaml` |
| daily backup | `deploy/ci/backup/{cronjob-backup-daily,cronjob-backup-freshness}.yaml` |

Normalization used `kubectl kustomize` on a temporary `resources: [object.yaml]` wrapper. Run-job placeholders received identical concrete values on both sides: the zero digest above, city `brossard`, chunk size `10`, backup ID `review-astra-837-r3`, mapper reset `1`, recovery args `--apply --heal brossard`, repair args `--run-id graph-city-key-prod-review --apply brossard`. Migration used prod namespace, suffix `-bc89161` and the same digest. Pre-release backup used identical nonsecret substitutions for its declared template variables. Daily-backup ConfigMap generation used the actual `kubectl create configmap --dry-run=client` and `kubectl label --local` commands, including all three workflow labels. Existing sealed-file contents were not printed; no runtime Secret was read.

The first comparison-helper attempt failed while rendering the backup fixture because its review-only substitution regex omitted digits in variable names such as `S3_SECRET`. Expanding that regex to include digits corrected the fixture; the complete comparison rerun exited 0. No repository file was changed to obtain this result.

**Required checks:**

```text
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
ok: rejects a PROD rule host on the preprod MCP Ingress only
ok: rejects a PROD rule host on the preprod UI Ingress only
ok: rejects a PROD TLS host on the preprod MCP Ingress only
ok: rejects the PROD TLS Secret on the preprod MCP Ingress only
ok: rejects the shared Ingress host patch reverted to PROD
ok: rejects a render without ConfigMap radar-api (no vacuous pass)
ok: rejects an overlay that does not render
PASS=25 FAIL=0
exit 0

bash deploy/ci/reconcile-preprod-mcp.test.sh
# Review-only Node kfilter adapter on PATH; no Python executed.
ok: Deployment absent: no immo-mcp-config apply, no roll, rest reconciled
ok: annotation == ConfigMap resourceVersion: applied, no roll
ok: annotation stale: applied, then pod template annotated with the new resourceVersion
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=6 FAIL=0
exit 0

make k8s-validate ENV=review-astra-837-r3
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0
```

**Real client JSONPath and merge behavior:** the exact annotation expression was extracted from the target script and passed as an argv value, not reconstructed by the fake.

```bash
kubectl patch --local -f <deployment-fixture.json> --type merge -p '{}' \
  -o 'jsonpath={.spec.template.metadata.annotations.sentropic\.dev/immo-mcp-config-rv}'
```

```text
annotation-present: exit=0 stdout="101" stderr=""
annotation-absent: exit=0 stdout="" stderr=""
annotations-map-absent: exit=0 stdout="" stderr=""
merge-patch: exit=0; rv=102; unrelated annotation keep=yes; image remains :same
set-image-local: exit=0 annotation=102 image=ghcr.io/rhanka/radar-api:new
```

**Committed-suite mutation results:** each mutant ran in a separate target-archive copy.

| Mutation | Exit | Output / detecting case |
| --- | --- | --- |
| Delete template patch | 1 | `PASS=4 FAIL=2`; stale and retry |
| Patch unconditionally | 1 | `PASS=5 FAIL=1`; current annotation |
| Suppress lookup failure with `|| true` | 1 | `PASS=5 FAIL=1`; lookup failure |
| Remove `--ignore-not-found` | 1 | `PASS=5 FAIL=1`; lookup failure (the fake's absent case alone does not reject this) |
| Remove empty-version guard | 1 | `PASS=5 FAIL=1`; empty version |
| Suppress patch failure with `|| true` | 1 | `PASS=5 FAIL=1`; first retry-pair run unexpectedly succeeds |
| Move ConfigMap version read before apply | 0 | `PASS=6 FAIL=0`; not detected |
| Remove the escaped dot from JSONPath | 0 | `PASS=6 FAIL=0`; not detected |
| Require a nonempty existing annotation before patch | 0 | `PASS=6 FAIL=0`; not detected |
| Exact round-2 reconcile script | 1 | `PASS=3 FAIL=3`; stale, empty version, retry |

**Independent stateful reproduction:** a separate fake kubectl recorded arguments, consumed apply input, changed version 100 → 101 on the first actual ConfigMap change, retained successful writes between runs, validated the new GET/patch argument shapes and rejected unexpected calls. Only offline kustomize was delegated. The actual preprod image-step body was extracted from `build-push-images.yml` without modifying its shell content.

```text
patch-error: reconcile_exit=23 workflow_exit=not-run reconcile_OK=false
APPLY ConfigMap/immo-mcp-config
CM persisted rv=101
GET rv=101
GET annotation="100"
PATCH attempt rv=101
injected patch-error
state={"desired":true,"rv":"101","annotation":"100","patches":0,
       "image":"ghcr.io/rhanka/radar-api:same","imageChanges":0}

same-image-retry: reconcile_exit=0 workflow_exit=0 reconcile_OK=true
APPLY ConfigMap/immo-mcp-config
CM persisted rv=101
GET rv=101
GET annotation="100"
PATCH attempt rv=101
PATCH accepted
APPLY CronJob/radar-consistency-snapshot
APPLY Deployment/radar-api
APPLY Deployment/radar-ui
SET-IMAGE deploy/radar-immo-mcp mcp=ghcr.io/rhanka/radar-api:same
ROLLOUT-STATUS deploy/radar-immo-mcp
state={"desired":true,"rv":"101","annotation":"101","patches":1,
       "image":"ghcr.io/rhanka/radar-api:same","imageChanges":0}

settled-noop: reconcile_exit=0 workflow_exit=0 reconcile_OK=true
CM persisted rv=101
GET rv=101
GET annotation="101"
# No patch call; state remains patches=1, imageChanges=0.
```

The trace excerpts omit unchanged UI/API ConfigMap calls and API/UI set-image calls; those ran in their normal positions. Additional results:

| Case | Reconcile exit | Workflow image-step exit | Evidence |
| --- | --- | --- | --- |
| Present Deployment, annotation missing | 0 | 0 | Patch accepted; annotation empty → 100; unchanged image |
| New image and changed config | 0 | 0 | Apply → rv 101 → patch accepted → image `:new`; one config patch, one image change |
| Deployment absent | 0 | not run | No MCP apply/patch; other durables applied |
| Lookup failure | 7 | not run | No apply; diagnostic preserved |
| MCP apply failure | 19 | not run | No version GET/patch/later applies |
| ConfigMap GET failure | 11 | not run | ConfigMap already persisted; no annotation GET/patch |
| Annotation GET failure | 12 | not run | No patch/later applies |
| Empty successful ConfigMap version read | 1 | not run | `mcp_cm_rv: immo-mcp-config has no resourceVersion after apply`; no patch |
| MCP filter failure | 17 | not run | Pipefail aborts despite downstream fake apply exit 0; no GET/patch |
| Patch failure | 23 | not run | ConfigMap persisted, annotation unchanged; repaired by next run above |
| MCP rollout-status failure | 0 | 0 | Exit 24 becomes `::warning::radar-immo-mcp rollout not complete within 180s (optional connector, deploy continues)` |
| MCP set-image failure | 0 | 25 | Annotation patch already accepted; image step fails before its rollout wait |

Every failed reconcile omitted `reconcile OK`. Mock state records accepted operations, not pod readiness or real Kubernetes no-op persistence behavior.

**Public probes:** at `2026-10-09T12:23:59Z`, all four curl commands exited 0. Requests used `--silent --show-error --max-time 25 --include`, with `--request POST --header 'Content-Type: application/json' --data '{}'` for the two POSTs, no credentials and no redirects.

| URL / method | Response |
| --- | --- |
| `https://immo.sent-tech.ca/mcp` POST | HTTP/2 401, `application/json`, `invalid_token`; challenge points to prod `/mcp/.well-known/oauth-protected-resource` |
| `https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `application/json`; resource `https://immo.sent-tech.ca/mcp`, authorization server `https://auth.sent-tech.ca`, expected three immo scopes |
| `https://preprod.immo.sent-tech.ca/mcp` POST | HTTP/2 405, `text/html`, nginx, `405 Not Allowed` |
| `https://preprod.immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `text/html`, SPA body containing `<div id="app"></div>` |

These reproduce the routing symptom. They do not validate this target after deployment, IdP registration, account approval or authenticated tool calls.

## Verdict

**GO-with-nits.** All three earlier findings are resolved in the demonstrated command paths. No new blocking defect was demonstrated. One non-blocking finding remains in the committed test's regression coverage. Prod inputs and renders are byte-identical; auth isolation, the six-case reconcile suite within its stated filter-substitution boundary, and offline Kubernetes validation pass. The precise no-op SSA resourceVersion guarantee, live rollout/availability, hosted CI and authenticated acceptance remain unverified or not covered as specified above.
