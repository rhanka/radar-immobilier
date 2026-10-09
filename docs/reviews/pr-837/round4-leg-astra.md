status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@0bf90556735e05d503f5c31700c6b61283deb2d9
lens: kustomize-render-prod-invariance-and-deploy-path (round 4)

## Reasoning

Reviewed `origin/main...0bf90556735e05d503f5c31700c6b61283deb2d9` and the round-4 delta from `bc89161a`. Base resolved to `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Worktree HEAD was `2c6655e54ac9d74f4ce037c45a66e6c85223c83e`; its deploy files, workflows, Makefile, API Dockerfile and UI nginx configuration compared identically with the requested target. Execution used an archive of the exact target, not the later HEAD. The only non-dossier round-4 change is `deploy/ci/reconcile-preprod-mcp.test.sh`; reconcile, overlays, base manifests and workflows are unchanged from round 3.

I read my round-1, round-2 and round-3 prompts and reviews, the repository rules and the using-harness/review guidance. No review file with `sol` in its filename was read, and no peer was contacted. This is one independent review leg, not a consensus result. No cluster access, real kubeconfig, Python interpreter, stack, commit, push or GitHub write was used. Real kubectl calls were offline rendering, local patch/image operations, client ConfigMap generation, help and client version inspection with `KUBECONFIG=/dev/null`. Public requests used only the two permitted immo HTTPS hosts, without credentials or redirect following. All throwaway files, including subprocess temporary files through `TMPDIR`, were confined to `.review-tmp-astra-r4/` and removed at completion. This report is the only retained modification.

**Validation boundary.** The committed reconcile test calls the pre-existing Python `kfilter.py`. As in the earlier reviews, a temporary `python3` PATH adapter dispatched only that filter invocation to a Node translation of its document-selection logic, rejecting other Python invocations. No repository script was changed to obtain the baseline result. The Bash test and reconcile script, real offline kustomize, auth gate and header-parity gate ran. Execution of the original Python filter is **not covered**; its unchanged standard-library source was read. This boundary applies to the reconcile suite, mutants and independent API mock. Auth-isolation and `make k8s-validate` ran without the adapter. Execution on the hosted CI runner is **unverified**.

**Unmodified target and round-4 changes.** The submitted suite returns `PASS=8 FAIL=0`, exit 0: no false failure was observed on the unmodified target within that boundary. The exact JSONPath strings at test lines 25–26 agree with the arguments emitted by reconcile. The anchored patch expression at line 49 accepts the target's nested `spec.template.metadata.annotations` JSON; a root-metadata-only patch is rejected. The real kubectl local JSONPath printer independently returns the expected version for that escaped key, and empty output with exit 0 for either a missing key or missing annotations map. Local merge patch preserves unrelated annotations and the image; local set-image preserves the new annotation.

The changed-config case begins with version and annotation both `100`. Its apply now advances the fake version to `101`, and assertions require apply → version read → patch `101` (lines 85–92). The next run retains that state and prohibits a further patch (93–96). A separate present-Deployment/missing-annotation case requires patch `100` (98–102). The failure/retry pair begins at `101/101`, advances the ConfigMap to `102`, rejects the first patch, then requires the retry to patch `102` (114–119). Each independent scenario resets the two state files; only the settled run and retry deliberately retain preceding state. Each invocation starts a fresh reconcile process and call log, with explicit mock settings. The suite's final failure count determines its exit status.

All ten round-3 mutants now fail the committed suite, including the three that previously survived. The latter fail for the intended reasons: reading before apply misses the newly advanced version; the unescaped annotation JSONPath is rejected; requiring a nonempty existing annotation skips the newly covered initial patch. Of five new mutants confined to reconcile's 4b block, three fail and two survive. The remaining demonstrated gap concerns the apply command, not JSON formatting or harmless argument ordering: see ASTRA-837-R4-01.

The fake is still a bounded protocol model. Its GET and merge-patch checks are stricter, but its apply handler accepts a broad command pattern, consumes stdin regardless of `-f`, and changes version solely from the extracted name and mock flag. It does not establish Kubernetes persistence, field ownership, controller behavior or readiness. The lookup-error case does not itself require `clean` or a particular diagnostic, and the retry assertion does not inspect the first run's error source; these are assertion limits, not additional demonstrated defects in the submitted code. The full suite does reject the malformed lookup and patch mutants tested here.

**Earlier runtime findings and independent retry.** A separate fake API checked argument arrays, parsed the merge-patch JSON, consumed the actual rendered ConfigMap, and changed resourceVersion only when its stored ConfigMap text changed. It retained accepted state between processes. The first run persisted ConfigMap version `101` and then failed the patch with exit 23, leaving annotation `100`. The second run observed the same stored ConfigMap and stale annotation, accepted patch `101`, and completed the actual preprod workflow image-step shell body with the same image string. Its image-change count stayed zero. A third run made no annotation patch. Missing-annotation and absent-Deployment paths also behaved as intended. Failed lookup, apply, version GET and annotation GET propagated exits 7, 19, 11 and 12 respectively, stopped later reconciliation, and omitted `reconcile OK`.

Reconcile retains `set -euo pipefail` at line 49. The NotFound-only assignment at line 83 propagates lookup errors. The apply pipeline and subsequent GET assignments at lines 129–134 propagate errors; the nonempty resourceVersion guard prevents patching an empty successful read. An empty annotation is valid and differs from a nonempty ConfigMap version. These facts and the rerun reproduce the resolution of the earlier omission and retry findings; they do not prove actual pod replacement.

The committed Role still grants deployments get/list/watch/patch/update at `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72` and configmaps get/list/create/patch/update at line 110. The new reads, ConfigMap server-side apply and Deployment merge patch fit those grants. No networking grant or Deployment creation is needed. Live RBAC and admission state are **unverified**.

The following set-image still occurs after reconcile (`.github/workflows/build-push-images.yml:800`, `:824`), preserves the annotation, and can make a second pod-template update when the image differs. One replica with `Recreate` (`deploy/k8s/40-immo-mcp-http-deploy.yaml:113`) does not provide uninterrupted availability. The unchanged MCP rollout failure is converted to a warning at workflow lines 826–827; the later mandatory waits concern API/UI. Thus successful CD is not proof of MCP readiness, and accepted API patches are not proof of environment uptake. No new deterministic startup or rollout defect was demonstrated. Live availability and authenticated connector acceptance remain **unverified**.

The precise no-op server-side-apply/resourceVersion guarantee remains **unverified** without an API server or a checked documentation passage. Both fakes model it. Unchanged data alone does not establish unchanged field ownership/metadata. An additional version change would request an additional rollout rather than consume the retry signal. Kubernetes documentation is outside the four allowed HTTPS hosts and was not fetched. The round-4 test improves regression detection; it does not change that verification boundary.

**Prod invariance.** Base and target prod renders compare byte for byte, as do all 25 raw prod apply inputs and their normalized renders, the digest-pinned refresh make target, migration payload, pre-release backup payload and client-generated/labeled daily-backup ConfigMap. The workflow inventory covered prod `deploy` and `promote-prod`, MCP apply, run-job selections, bascule bundle and daily backup, including their referenced scripts/templates. Of existing archived deploy files, 169 are identical and four differ: preprod auth guard, its test, reconcile and preprod kustomization. No `deploy/k8s` file changes; the new deploy files are the reconcile test and two preprod patches. Existing sealed manifests were compared without printing their contents; no sealed file was introduced or changed and no runtime Secret was read.

In `build-push-images.yml`, removing comment-only lines gives identical bytes. The entire prefix before the preprod section and the entire `promote-prod` job compare identically. Inspection places every changed comment in or introducing deploy-preprod. Removing the single new three-line test step from `ci.yml` reproduces base bytes; the other ten workflows are identical. Prod jobs do not call the changed reconcile script. This establishes checked-in input/render invariance, not equality of live objects or runtime inputs.

The preprod render still contains four additions (MCP ConfigMap, Service, Deployment, Ingress), one changed existing object (UI Ingress host/TLS fields), 26 identical objects and no removals. Every namespace is preprod. MCP's five unpatched data keys compare identically with prod. The overlays are unchanged from round 3: `/mcp` Prefix, `http:8848` Service mapping and matching selectors, preprod resource/issuer/public URL, shared preprod TLS Secret and 10m requested CPU remain the reviewed values. Reconcile applies neither Ingress nor the MCP Deployment/Service manifest. The operator Ingress and IdP/authenticated handoff remain necessary. The PR body was not re-fetched in this round, so its current contents are **unverified**. The public probes below still show the routing symptom; they are not acceptance of a deployed target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| ASTRA-837-01 | non-blocking | resolved | `reconcile-preprod.sh:129`–138 reconciles the pod-template annotation independently of image changes. Target suite covers changed config and an existing Deployment with no annotation. The independent same-image retry patches `101` with zero image changes; the settled third run performs no patch. Actual pod readiness remains unverified and is distinct from the omitted-update finding. |
| ASTRA-837-02 | non-blocking | resolved | Line 83 retains `--ignore-not-found -o name` in an errexit-governed assignment. Independent empty lookup exits 0 without MCP apply/patch; failed lookup exits 7 with its diagnostic before any apply. Suppressing lookup failure now gives `PASS=7 FAIL=1`; removing `--ignore-not-found` gives `PASS=1 FAIL=7`. |
| ASTRA-837-R2-01 | non-blocking | resolved | Independent first run persists rv `101`, fails patch with exit 23 and keeps annotation `100`. Retry reapplies without changing the stored ConfigMap, patches annotation `101`, and completes the actual same-image workflow block with exit 0. The committed stateful retry case also passes. Deleting the patch and swallowing its error are both rejected. |
| ASTRA-837-R3-01 | non-blocking | resolved | Test lines 35–38 validate the JSONPath, 44–45 advance the applied version, 87–95 assert the post-apply version and settled run, and 99–101 cover a present Deployment without the annotation. All three former survivors now exit 1: read-before-apply `PASS=5 FAIL=3`; unescaped dot `PASS=3 FAIL=5`; nonempty-annotation prerequisite `PASS=7 FAIL=1`. The new apply-command gap below is separate from those three resolved acceptance cases. |

## New findings

**ASTRA-837-R4-01 — the fake still treats non-persisting or incomplete apply commands as successful writes**

- Severity: **non-blocking**.
- File:line: `deploy/ci/reconcile-preprod-mcp.test.sh:40`–45; mutated production call: `deploy/ci/reconcile-preprod.sh:130`.
- Evidence: on separate exact-target copies, changing only the MCP apply in block 4b to add `--dry-run=server`, or removing only its `-f -`, each leaves the submitted suite at `PASS=8 FAIL=0`, exit 0. The handler matches any `*" apply --server-side "*`, reads stdin regardless of input flags and advances the fake version when it sees the name `immo-mcp-config`. Neither mutation reaches the unexpected-call handler. Real client `kubectl apply --help` states that server dry run submits a request **without persisting the resource** and identifies `-f/--filename` as the configuration input. Thus the first mutation can leave the live ConfigMap unchanged, while the fake invents a successful write/version change; the second removes the declared manifest input, but the fake consumes it anyway. No real apply was executed.
- Impact: the suite can stay green after a regression that prevents the preprod MCP configuration from being persisted, or prevents the real apply from accepting its input. With a same-image redeploy and an already-current annotation for the still-old ConfigMap, dry run supplies no lasting config change or missing-template-update signal. This concerns deployment behavior, not equivalent JSON whitespace or option ordering. The submitted reconcile command contains neither mutation, and its normal/error paths passed the independent checks; this is a regression-coverage finding, not an observed live incident.
- Fix: validate the apply argument list as well as the reads/patch: require the intended server-side apply, field manager, conflict option and `-f -`, and reject unsupported options such as dry run before modeling persistence. Keep the fake offline. Owner: PR author. Acceptance: both named mutants fail while the unmodified target retains `PASS=8 FAIL=0`.

## Commands and outputs

Commands used `rtk`; wrappers are omitted below where they do not affect the result. Offline subprocesses used `TMPDIR=<worktree>/.review-tmp-astra-r4/tmp`, `KUBECONFIG=/dev/null` and `K8S_VALIDATE_WITH_CLUSTER=0`. Local client: kubectl v1.35.3, kustomize v5.7.1. All helpers and fixtures were deleted after recording these results.

**Target and syntax checks:**

```text
git branch --show-current
fix/mcp-preprod-expose
git rev-parse HEAD origin/main
2c6655e54ac9d74f4ce037c45a66e6c85223c83e
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet 0bf90556735e05d503f5c31700c6b61283deb2d9 -- deploy .github/workflows Makefile api/Dockerfile ui/nginx/default.conf
exit 0
git diff --name-only bc89161a 0bf90556735e05d503f5c31700c6b61283deb2d9 -- . ':!docs/reviews/**'
deploy/ci/reconcile-preprod-mcp.test.sh
git diff --quiet bc89161a 0bf90556735e05d503f5c31700c6b61283deb2d9 -- deploy/ci/reconcile-preprod.sh deploy/overlays deploy/k8s .github/workflows
exit 0
bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.test.sh
exit 0
git diff --check
exit 0
```

Archives were created with `git archive <ref> deploy .github/workflows Makefile api/Dockerfile ui/nginx/default.conf | tar -x -C <base-or-target>`, refs origin/main and the full target SHA. Target `api/src` was also archived for the entrypoint existence checks. No review dossier file was archived or scanned.

**Requested checks, executed in the target archive:**

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
ok: unchanged ConfigMap, annotation current: applied, no roll
ok: ConfigMap changed by the apply: version read after it, pod template annotated
ok: settled re-run after a roll: no further patch
ok: present Deployment without the annotation: pod template annotated
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=8 FAIL=0
exit 0

make k8s-validate ENV=review-astra-837-r4
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0
```

The first validation attempt in my incomplete target archive returned make exit 2: all 17 API entrypoints were reported missing, for example `FAIL: api/Dockerfile entrypoint api/src/db/migrate.ts does not exist`, followed by `image entrypoint check: 17 failure(s)` and `make: *** [Makefile:388: k8s-validate] Error 1`. The archive initially contained the Dockerfile but not `api/src`. Adding that directory from the exact target, without changing any repository code, produced the successful result above. This was a review-fixture failure.

**Mutation results against the target test:** each mutant had its own target-derived fixture; only reconcile was changed, and `bash -n` passed before execution. “Fail” below means the committed suite rejected the mutant, not that the unmodified target failed.

| Mutant | Origin | Suite exit | Output | Detecting evidence |
| --- | --- | --- | --- | --- |
| Delete template patch | Round 3 | 1 | `PASS=5 FAIL=3` | Changed apply, missing annotation, retry |
| Patch unconditionally | Round 3 | 1 | `PASS=6 FAIL=2` | Current annotation, settled rerun |
| Suppress lookup failure with `\|\| true` | Round 3 | 1 | `PASS=7 FAIL=1` | Lookup failure incorrectly succeeds |
| Remove `--ignore-not-found` | Round 3 | 1 | `PASS=1 FAIL=7` | Fake exit 98 for unexpected lookup; every case except negative lookup fails |
| Remove empty-version guard | Round 3 | 1 | `PASS=7 FAIL=1` | Empty-version case: `bad patch` detected by `clean` |
| Suppress patch failure with `\|\| true` | Round 3 | 1 | `PASS=7 FAIL=1` | Retry pair's first run incorrectly succeeds |
| Read ConfigMap version before apply | Round 3, former survivor | 1 | `PASS=5 FAIL=3` | Changed apply misses patch, settled run patches late, failure/retry first run incorrectly succeeds |
| Remove escaped dot from annotation JSONPath | Round 3, former survivor | 1 | `PASS=3 FAIL=5` | Exact GET shape rejected with exit 98 |
| Require nonempty existing annotation before patch | Round 3, former survivor | 1 | `PASS=7 FAIL=1` | Present Deployment without annotation skips patch |
| Exact round-2 reconcile (`220c5c37`) | Round 3 | 1 | `PASS=2 FAIL=6` | Old `rollout restart` protocol rejected |
| Patch top-level `metadata.annotations` instead of pod-template metadata | New, 4b | 1 | `PASS=4 FAIL=4` | Root annotation JSON rejected as `bad patch`, exit 97 |
| Read `.metadata.generation` instead of `.metadata.resourceVersion` | New, 4b | 1 | `PASS=2 FAIL=6` | Wrong ConfigMap JSONPath rejected with exit 98 |
| Add `--dry-run=server` to MCP apply | New, 4b | 0 | `PASS=8 FAIL=0` | **Survives**; fake invents persisted version change |
| Remove `-f -` from MCP apply | New, 4b | 0 | `PASS=8 FAIL=0` | **Survives**; fake still consumes stdin |
| Patch in namespace `radar-immobilier` instead of `$NAMESPACE` | New, 4b | 1 | `PASS=4 FAIL=4` | Wrong patch namespace rejected with exit 98 |

For reproduction, the two surviving mutants change only this block-4b line:

```bash
# Original
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
# Mutant 1
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts --dry-run=server -f -
# Mutant 2
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts
```

`KUBECONFIG=/dev/null kubectl apply --help` exited 0 and returned:

```text
    --dry-run='none':
        Must be "none", "server", or "client". If client strategy, only print the object that would be sent, without sending it. If server strategy, submit server-side request without persisting the resource.
    -f, --filename=[]:
        The files that contain the configurations to apply.
```

**Independent retained-state reproduction:** the fake delegated only offline kustomize, checked argument arrays, parsed the patch, and persisted ConfigMap text/version and annotation separately. The workflow image-step body was extracted without alteration from the target's preprod step. Selected output, omitting unchanged API/UI calls:

```text
independent-patch-failure: reconcile_exit=23 workflow_exit=not-run reconcile_OK=false
APPLY ConfigMap/immo-mcp-config
CM persisted rv=101
GET rv=101
GET annotation="100"
PATCH attempt rv=101
injected patch
state={"rv":"101","ann":"100","patches":0,"image":"ghcr.io/rhanka/radar-api:same","imageChanges":0}

independent-same-image-retry: reconcile_exit=0 workflow_exit=0 reconcile_OK=true
APPLY ConfigMap/immo-mcp-config
CM persisted rv=101
GET rv=101
GET annotation="100"
PATCH attempt rv=101
PATCH accepted
SET-IMAGE deploy/radar-immo-mcp mcp=ghcr.io/rhanka/radar-api:same
ROLLOUT-STATUS
state={"rv":"101","ann":"101","patches":1,"image":"ghcr.io/rhanka/radar-api:same","imageChanges":0}

independent-settled: reconcile_exit=0 workflow_exit=0 reconcile_OK=true
CM persisted rv=101
GET rv=101
GET annotation="101"
# No patch call; patches stays 1 and imageChanges stays 0.
```

| Independent case | Reconcile exit | Image-step exit | Result |
| --- | --- | --- | --- |
| Present Deployment, missing annotation | 0 | 0 | Annotation empty → `101`; unchanged image |
| Deployment absent | 0 | not run | No MCP apply/read/patch; other durables applied |
| Lookup error | 7 | not run | Stops before every apply |
| MCP apply error | 19 | not run | Stops before version GET/patch |
| ConfigMap version GET error | 11 | not run | ConfigMap persisted, no annotation GET/patch |
| Annotation GET error | 12 | not run | ConfigMap persisted, no patch |

Every failed reconcile omitted `reconcile OK`. These state records describe modeled API effects, not real pod readiness.

**Real client JSONPath/patch checks:** the annotation expression and patch JSON were extracted from the actual target script, replacing only the version variable with `102` for the patch fixture.

```bash
kubectl patch --local -f <deployment.json> --type merge -p '{}' \
  -o 'jsonpath={.spec.template.metadata.annotations.sentropic\.dev/immo-mcp-config-rv}'
kubectl patch --local -f <deployment.json> --type merge -p <target-patch-with-rv-102> -o json
kubectl set image --local -f - mcp=ghcr.io/rhanka/radar-api:new -o json
```

```text
present: exit=0 stdout="101"
missing-key: exit=0 stdout=""
missing-map: exit=0 stdout=""
merge-patch: rv=102 keep=yes image=ghcr.io/rhanka/radar-api:same
set-image-local: rv=102 image=ghcr.io/rhanka/radar-api:new
```

**Prod/preprod comparison commands:** each render ran for both archived base and target, and each pair was compared with `cmp`.

```bash
kubectl kustomize <checkout>/deploy/k8s
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s/refresh-cronjobs-prod
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/overlays/preprod
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute-review-output-file> ENV=review-astra-837-r4
```

Comparison output (25 individual raw-render success lines consolidated):

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
Other workflows identical=10
prod: cmp exit 0
prod-refresh: cmp exit 0
Prod raw and normalized files=25; every cmp exit 0
refresh-fixed: cmp exit 0
migration-render: cmp exit 0
backup-release-render: cmp exit 0
backup-daily-configmap: cmp exit 0
PREPROD ADDED ConfigMap/immo-mcp-config
PREPROD ADDED Service/radar-immo-mcp
PREPROD ADDED Deployment/radar-immo-mcp
PREPROD CHANGED Ingress/radar
PREPROD ADDED Ingress/radar-immo-mcp
PREPROD base=27 target=31 unchanged=26 removed=0; namespaces preprod
mcp-other-five-keys: cmp exit 0
```

The 25 raw and normalized prod comparisons were:

| Workflow path | Compared files |
| --- | --- |
| MCP apply; file 40 also used by prod deploy/promote | `deploy/k8s/{30-api,40-immo-mcp-http-deploy,41-immo-mcp-ingress,70-networkpolicy}.yaml` |
| run-job prod selections | `deploy/k8s/35-run-geo-mapper-job.yaml`, `42-graph-city-key-repair-job.yaml`, `35-consistency-snapshot-job.yaml`, `32-graph-projection-only-job.yaml`, `37-graphify34-apply-job.yaml`, `37-graphify34-slugs-configmap.yaml`, `38-graphify34-emit-candidates-job.yaml`, `38-graphify34-set167-configmap.yaml`, `33b-scrape-cities-job.yaml`, `33-scrape-chunk-loop-configmap.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml`, `41-document-date-recovery-job.yaml` |
| Bascule prod bundle | `deploy/ci/bascule-preprod/{radar-db-ro-prod-sealed,radar-pra-admin-prod-sealed,db-ro-role-provision,cronjob-db-backup-prod,vap-ci-trigger-suspend-only,rbac-ci-trigger-prod}.yaml` |
| Daily backup | `deploy/ci/backup/{cronjob-backup-daily,cronjob-backup-freshness}.yaml` |

Normalization used offline kustomize wrappers with `resources: [object.yaml]`. Both sides received the same run-job fixture substitutions: zero digest above, city `brossard`, chunk size `10`, backup ID `review-astra-837-r4`, mapper reset `1`, recovery args `--apply --heal brossard`, repair args `--run-id graph-city-key-prod-review --apply brossard`. Migration used prod namespace, suffix `-0bf9055` and the same digest. The backup template received nonsecret fixture values for precisely its declared substitution variables; runtime shell variables were preserved. Daily-backup ConfigMap generation ran the actual `kubectl create configmap --dry-run=client` and `kubectl label --local` operations with all three workflow labels. No resulting payload was applied.

**Public probes:** initiated at `2026-10-09T15:06:44Z`; all four commands exited 0, with response Date headers at 15:06:50–51 UTC. Options were `--silent --show-error --max-time 25 --include`, plus `--request POST --header 'Content-Type: application/json' --data '{}'` for POSTs; no credentials or redirects.

| URL / method | Response |
| --- | --- |
| `https://immo.sent-tech.ca/mcp` POST | HTTP/2 401, `application/json`, `invalid_token`; challenge points to prod `/mcp/.well-known/oauth-protected-resource` |
| `https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `application/json`; resource `https://immo.sent-tech.ca/mcp`, authorization server `https://auth.sent-tech.ca`, three expected immo scopes |
| `https://preprod.immo.sent-tech.ca/mcp` POST | HTTP/2 405, `text/html`, nginx, `405 Not Allowed` |
| `https://preprod.immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `text/html`, SPA body containing `<div id="app"></div>` |

These reproduce the routing symptom; deployment of this target, IdP registration/account approval and authenticated tool calls are **not covered**.

## Verdict

**GO-with-nits.** All four earlier findings are resolved in the demonstrated command paths and regression cases. All ten round-3 mutants are rejected. Five new mutants were tested; two expose one non-blocking apply-command coverage gap. No false failure was observed on the unmodified target and no new blocking runtime defect was demonstrated. Auth isolation, the eight-case reconcile suite within the stated filter-substitution boundary, and offline Kubernetes validation pass. Prod inputs/renders are byte-identical. Live availability, authenticated acceptance, hosted CI and the exact no-op SSA persistence guarantee remain unverified as described above.
