status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@a6732b7b29f4cb52c439bcf9c84643bcdca222f9
lens: kustomize-render-prod-invariance-and-deploy-path (round 5)

## Reasoning

Reviewed `origin/main...a6732b7b29f4cb52c439bcf9c84643bcdca222f9` and the round-5 delta from `2c6655e5`. Base resolved to `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Worktree HEAD was `dcd795a07df508901a79173a4e906852faf6803e`; deploy files, workflows, Makefile, API Dockerfile/source and UI nginx configuration matched the requested target. Checks and mutation fixtures used archives of the exact base and target. The later HEAD also changes the branch plan; that was not substituted for the target under review.

I read my round-1 through round-4 prompts and reviews, repository rules, and the using-harness/review instructions. No review file with `sol` in its name was read and no peer was contacted. This is one independent review leg. No cluster access, real kubeconfig, Python interpreter, stack, commit, push or GitHub write was used. Real kubectl operations were offline rendering, client-only ConfigMap generation, local JSONPath/patch/image checks and client version inspection, with `KUBECONFIG=/dev/null`. Public probes used only the two permitted immo HTTPS hosts, without credentials or redirect following. All throwaway files, including subprocess temporary files through `TMPDIR`, were confined to `.review-tmp-astra-r5/` and removed at completion. This review is the only retained modification.

**Execution boundary.** The reconcile suite invokes the existing Python `kfilter.py`. As in the earlier rounds, a temporary `python3` PATH adapter accepted only that filter invocation and dispatched a Node translation of its document-selection logic; other Python invocations were rejected. The original filter source was inspected and is unchanged. The unmodified target Bash suite/reconcile, real offline kustomize, auth-isolation gate and header-parity gate ran. Original Python execution is **not covered**. This boundary applies to the reconcile suite, mutants and trace run. Auth-isolation and `make k8s-validate` ran without the adapter. Hosted CI execution is **unverified**.

**Round-5 delta and false failures.** The only code delta is `deploy/ci/reconcile-preprod-mcp.test.sh`: 39 added and 10 removed lines. The shipped reconcile script, overlays, base manifests and workflows are unchanged from round 4. The unmodified target returns `PASS=11 FAIL=0`, exit 0, within the execution boundary above. No false failure was observed.

At test line 44, the fake accepts the persisting apply command emitted by reconcile, including server-side apply, field manager `cd-preprod`, force-conflicts and stdin input. Both round-4 survivors now reach the unexpected-command handler and stop with fake exit 98; the suite exits 1 with `PASS=2 FAIL=9`. Removing server-side apply or force-conflicts, or changing the field manager, also fails. This resolves the demonstrated apply-command gap.

At test lines 47–55 the fake retains the actual MCP input document before advancing its modeled resourceVersion. Lines 117–121 check kind, namespace, issuer, resource, public URL and scopes. Six separate mutations deleting those respective lines **after** the render/auth gate each fail specifically at the new content assertion, with `PASS=10 FAIL=1`. Thus the assertion checks what reaches apply, rather than only a pre-apply source or an unrelated render. It is a check of those fields, not a general Kubernetes schema validator or proof of persistence.

Both version reads now print their fixture value and can then fail (test lines 36–42). The unmodified reconcile preserves exits 18 and 19 respectively and stops before the patch and every later durable-object apply. Adding `|| true` inside either corresponding command substitution makes the suite fail its respective read-error case: the mutation otherwise patches and continues. The per-run environment explicitly resets `MOCK_FAIL_READ`; each invocation gets a fresh call log and reconcile process. The changed/settled and patch-failure/retry sequences intentionally share version/annotation state. The content check follows a successful present-Deployment run, which writes the captured document. These changes introduced no demonstrated production-behavior defect.

**Earlier runtime findings.** Reconcile retains `set -euo pipefail` at line 49. The NotFound-only assignment at line 83 propagates lookup errors; only a successful empty result skips the MCP. Lines 129–138 apply the ConfigMap, read and require its live version, read the pod-template annotation and patch it if unequal. The annotation may be empty on an existing Deployment. The patch is independent of both an image change and the old pre-apply diff signal.

The target suite's retained-state retry was traced without changing reconcile or the test assertions: first apply advances version `101` to `102`; the patch fails with exit 23 and annotation remains `101`. Retry reapplies, reads version `102`, patches annotation `102` and exits 0. No image update is needed to request that missing template update. Changed-config, missing-annotation, settled and absent-Deployment cases also behave as intended. The trace verifies modeled command paths, not actual pod replacement. The previous rounds' actual workflow-block checks concern the same unchanged script/workflow bytes; they were not rerun as a separate API mock here.

The real kubectl JSONPath printer accepts the exact escaped annotation expression extracted from reconcile. It returns `101` for a present key and empty output with exit 0 for a missing key or annotations map. The extracted nested merge patch preserves an unrelated annotation and the image. A subsequent local image change preserves the config-version annotation. All three round-3 surviving mutants are still rejected by the target suite.

The committed preprod Role still grants Deployment get/patch/update and ConfigMap get/create/patch/update (`deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72`, `:110`), covering these operations. Live RBAC/admission state is **unverified**. Reconcile still precedes set-image (`.github/workflows/build-push-images.yml:800`, `:824`) and applies neither Ingress nor the MCP Deployment/Service manifest. The one-replica `Recreate` strategy does not establish uninterrupted availability; the unchanged workflow converts MCP rollout failure into a warning at lines 826–827. CD success therefore does not establish MCP readiness. Operator Ingress application, IdP registration/account approval and authenticated acceptance remain necessary and are **not covered** by these offline checks. The current PR body was not fetched in this round.

The exact no-op server-side-apply/resourceVersion guarantee remains **unverified**: the fake models it, and neither an API server nor a checked documentation passage was used. Kubernetes documentation is outside the permitted HTTPS hosts. Metadata/field-ownership changes can also change resourceVersion; an extra version change would request another template update rather than recreate the lost-retry-signal defect. No incorrect behavior of the submitted implementation was demonstrated on that basis.

**Prod invariance.** The prod base render, refresh overlay, digest-pinned refresh make target, 25 raw prod apply inputs and their normalized renders, migration payload, pre-release backup payload and client-generated/labeled daily-backup ConfigMap compare byte-identically with origin/main. Of existing archived deploy files, 169 are identical and four differ: the preprod auth guard, its test, reconcile and preprod kustomization. No `deploy/k8s` file changes. Added deploy files are the reconcile test and two preprod patches. Existing sealed manifests were compared without printing their contents; none was introduced or changed, and no runtime Secret was read.

In `build-push-images.yml`, removing comment-only lines gives identical bytes; the prefix before the preprod section and the entire `promote-prod` job also compare identically. All changed comments are in or introduce deploy-preprod. Removing the single three-line reconcile-test step from `ci.yml` reproduces base bytes; the other ten workflows are identical. Prod jobs do not invoke the changed reconcile script. This establishes checked-in input/render invariance, not live-object or runtime-input equality.

The preprod render still has four additions (MCP ConfigMap, Service, Deployment and Ingress), one changed existing object (UI Ingress host/TLS fields), 26 identical objects and no removals. All namespaces are preprod. The MCP's other five data keys compare identically with prod. The unchanged overlays retain `/mcp` Prefix, the matching Service/Deployment selectors and `http:8848` port mapping, preprod issuer/resource/public URL, shared preprod TLS Secret and 10m requested CPU. Public probes below still reproduce the pre-deployment routing symptom; they do not validate this target after deployment.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| ASTRA-837-01 | non-blocking | resolved | `reconcile-preprod.sh:129`–138 requests a template update independently of image changes. Target changed-config case patches `101`, present-Deployment/missing-annotation case patches `100`, and settled run performs no patch. Deleting the patch fails three suite cases (`PASS=8 FAIL=3`). Actual pod readiness remains unverified, separate from the original omitted-update finding. |
| ASTRA-837-02 | non-blocking | resolved | Line 83 retains `--ignore-not-found -o name` in an errexit-governed assignment. Trace: absent lookup exits 0 without MCP operations; failed lookup exits 1 before any apply, preserves the Forbidden diagnostic and omits `reconcile OK`. Suppressing the lookup error produces `PASS=10 FAIL=1`. |
| ASTRA-837-R2-01 | non-blocking | resolved | Trace: first apply advances ConfigMap version to `102`; patch exits 23, leaving annotation `101`. Retry reads persisted version `102`, patches annotation `102` and completes without depending on an image update. Swallowing patch failure fails the first-run failure assertion (`PASS=10 FAIL=1`). |
| ASTRA-837-R3-01 | non-blocking | resolved | The changed apply advances the fake version; exact JSONPath is checked; missing annotation and settled rerun are covered. Former survivors all fail: read-before-apply `PASS=8 FAIL=3`, unescaped dot `PASS=5 FAIL=6`, nonempty-annotation prerequisite `PASS=10 FAIL=1`. Real client JSONPath checks also pass. |
| ASTRA-837-R4-01 | non-blocking | resolved | `reconcile-preprod-mcp.test.sh:44` accepts the intended persisting apply command. Both requested survivor reruns—add `--dry-run=server`, remove `-f -` from block 4b—are rejected with fake exit 98 and suite exit 1, `PASS=2 FAIL=9`. Unmodified target remains `PASS=11 FAIL=0`. |

## New findings

none

No demonstrated finding remains from rounds 1–4. No new production-behavior defect or false failure of the unmodified target was demonstrated. The bounded offline coverage and unverified live behavior are stated above; passing mutation checks is not a claim of exhaustive coverage.

## Commands and outputs

Commands used `rtk`; wrappers are omitted below for readability. Subprocesses used `TMPDIR=<worktree>/.review-tmp-astra-r5/tmp`, `KUBECONFIG=/dev/null` and `K8S_VALIDATE_WITH_CLUSTER=0`. Local versions: kubectl v1.35.3, kustomize v5.7.1. The Node filter adapter was on PATH only for reconcile checks and mutants.

Target and syntax checks:

```text
git branch --show-current
fix/mcp-preprod-expose
git rev-parse HEAD origin/main
dcd795a07df508901a79173a4e906852faf6803e
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet a6732b7b29f4cb52c439bcf9c84643bcdca222f9 -- deploy .github/workflows Makefile api/Dockerfile api/src ui/nginx/default.conf
exit 0
git diff --quiet 0bf90556735e05d503f5c31700c6b61283deb2d9 a6732b7b29f4cb52c439bcf9c84643bcdca222f9 -- deploy/ci/reconcile-preprod.sh deploy/k8s deploy/overlays .github/workflows
exit 0
bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.test.sh
exit 0
git diff --check
exit 0
```

Archives: `git archive <ref> deploy .github/workflows Makefile api/Dockerfile api/src ui/nginx/default.conf | tar -x -C <review/base-or-target>`, for origin/main and the full target SHA. No review dossier was archived or scanned.

Required checks, executed in the exact-target archive:

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
# Review-only Node filter adapter; no Python executed.
ok: Deployment absent: no immo-mcp-config apply, no roll, rest reconciled
ok: unchanged ConfigMap, annotation current: applied, no roll
ok: ConfigMap changed by the apply: version read after it, pod template annotated
ok: settled re-run after a roll: no further patch
ok: present Deployment without the annotation: pod template annotated
ok: applied immo-mcp-config = preprod namespace, issuer, resource, public URL, prod scopes
ok: failed rv read: script stops before the patch and the later applies
ok: failed ann read: script stops before the patch and the later applies
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=11 FAIL=0
exit 0

make k8s-validate ENV=review-astra-837-r5
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0
```

Mutation checks: each mutant used a separate exact-target-derived fixture; only reconcile was mutated and `bash -n` passed before the committed suite ran. Every listed suite exited 1. Twenty-one mutants were rejected, none survived.

| Mutation | Output | Detecting evidence |
| --- | --- | --- |
| Round-4 survivor: add `--dry-run=server` to MCP apply | `PASS=2 FAIL=9` | Unexpected apply, fake exit 98; no modeled MCP persistence |
| Round-4 survivor: remove `-f -` from MCP apply | `PASS=2 FAIL=9` | Unexpected apply, fake exit 98 |
| Round-3 survivor: read ConfigMap version before apply | `PASS=8 FAIL=3` | Changed-config misses patch; settled run patches late; first retry-pair run incorrectly succeeds |
| Round-3 survivor: remove escaped dot in annotation JSONPath | `PASS=5 FAIL=6` | Exact GET rejects unescaped key, fake exit 98 |
| Round-3 survivor: require existing nonempty annotation | `PASS=10 FAIL=1` | First-run case skips required patch |
| Delete template patch | `PASS=8 FAIL=3` | Changed config, missing annotation and retry |
| Patch unconditionally | `PASS=9 FAIL=2` | Current annotation and settled run |
| Suppress initial lookup error with `\|\| true` | `PASS=10 FAIL=1` | Lookup case incorrectly succeeds and applies later objects |
| Suppress patch failure with `\|\| true` | `PASS=10 FAIL=1` | Failed-patch run incorrectly succeeds |
| Suppress ConfigMap version-read error inside substitution | `PASS=10 FAIL=1` | `readfail-rv` incorrectly patches and continues |
| Suppress annotation-read error inside substitution | `PASS=10 FAIL=1` | `readfail-ann` incorrectly patches and continues |
| Remove empty-resourceVersion guard | `PASS=10 FAIL=1` | Empty patch value reaches `bad patch`, failing `clean` |
| Change field manager, remove force-conflicts, remove server-side apply (three separate mutants) | Each `PASS=2 FAIL=9` | Exact apply command rejected with fake exit 98 |
| Delete applied kind, namespace, issuer, resource, public URL, scopes (six separate mutants) | Each `PASS=10 FAIL=1` | New applied-document content assertion |

Exact surviving-mutant reruns changed only this block-4b command:

```bash
# Target
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
# Mutant 1
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts --dry-run=server -f -
# Mutant 2
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts
```

The six payload mutants insert `sed '/^<field>:/d'` between the block-4b filter and apply, with the actual two-space indentation for namespace/data keys. The already-guarded render itself is unchanged. The error-suppression mutants add `|| true` inside the relevant command substitution, after kubectl, preserving its printed value while swallowing failure.

Additional trace run: a disposable copy of the test added logging/copying immediately after `RC=$?`; reconcile and every test assertion remained unchanged. Its result was again `PASS=11 FAIL=0`. Selected modeled state and calls:

```text
changed: rc=0 rv=101 ann=101
apply immo-mcp-config -> read rv -> read ann -> patch rv=101 -> later applies
settled: rc=0 rv=101 ann=101
apply immo-mcp-config -> read rv -> read ann -> later applies (no patch)
first: rc=0 rv=100 ann=100
apply immo-mcp-config -> read rv -> read ann -> patch rv=100 -> later applies

readfail-rv: rc=18 rv=101 ann=100
apply immo-mcp-config -> read rv (stop)
readfail-ann: rc=19 rv=101 ann=100
apply immo-mcp-config -> read rv -> read ann (stop)
lookup: rc=1 rv=100 ann=100
get radar-immo-mcp (stop, no apply)
norv: rc=1 rv=<empty> ann=100
apply immo-mcp-config -> read rv (stop)

patchfail: rc=23 rv=102 ann=101
apply immo-mcp-config -> read rv -> read ann -> patch-failed (stop)
retry: rc=0 rv=102 ann=102
apply immo-mcp-config -> read rv -> read ann -> patch rv=102 -> later applies
```

Each failed reconcile above omitted `reconcile OK`; retry printed it. Earlier UI/API ConfigMap applies are omitted from these excerpts. No real API effects or pods are represented by the fake's state.

Real client checks used the annotation JSONPath and patch text extracted from target reconcile, replacing only the patch version variable with `102`:

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
set-image-same: exit=0 stdout="" (no changed object emitted)
set-image-new: rv=102 image=ghcr.io/rhanka/radar-api:new; templateChanged=true
```

The first local-check helper attempt incorrectly tried to JSON-parse the empty successful output of the unchanged-image operation and exited 1 (`SyntaxError: Unexpected end of JSON input`). Recording that no-op output explicitly corrected the review helper; the rerun exited 0. No repository implementation or test assertion was changed for this correction.

Prod/preprod render commands, run for both archives:

```bash
kubectl kustomize <checkout>/deploy/k8s
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s/refresh-cronjobs-prod
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/overlays/preprod
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute-review-output-file> ENV=review-astra-837-r5
```

Comparison outputs (25 individual raw-render success lines consolidated):

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

Normalization used offline kustomize wrappers with `resources: [object.yaml]`. Both sides received identical run-job substitutions: zero image digest above, city `brossard`, chunk size `10`, backup ID `review-astra-837-r5`, mapper reset `1`, recovery args `--apply --heal brossard`, repair args `--run-id graph-city-key-prod-review --apply brossard`. Migration used prod namespace, suffix `-a6732b7` and the same digest. Backup used nonsecret fixture values for exactly the template variables listed by `run-db-backup.sh`; other runtime shell variables were preserved. Daily-backup ConfigMap generation used the actual `kubectl create configmap --dry-run=client` and `kubectl label --local` operations with all three workflow labels. No generated payload was applied.

Public probes used `curl --silent --show-error --max-time 25 --include`, plus `--request POST --header 'Content-Type: application/json' --data '{}'` for POSTs. All four commands exited 0; response Date headers were `2026-10-09 15:30:16–17 GMT`.

| URL / method | Response |
| --- | --- |
| `https://immo.sent-tech.ca/mcp` POST | HTTP/2 401, `application/json`, `invalid_token`; challenge names prod `/mcp/.well-known/oauth-protected-resource` |
| `https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `application/json`; resource `https://immo.sent-tech.ca/mcp`, authorization server `https://auth.sent-tech.ca`, scopes `immo:read`, `immo:search`, `immo:documents:read` |
| `https://preprod.immo.sent-tech.ca/mcp` POST | HTTP/2 405, `text/html`, nginx, `405 Not Allowed` |
| `https://preprod.immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `text/html`, SPA body containing `<div id="app"></div>` |

These are observations of the public endpoints before acceptance of this target, not evidence of a post-deploy result.

## Verdict

**GO.** All five earlier findings are resolved within the demonstrated command paths and regression cases. Both round-4 survivors and all 19 additional mutants tested in this round are rejected. No new finding remains. Auth isolation, the eleven-check reconcile suite within its stated filter-substitution boundary, and offline Kubernetes validation pass. Prod inputs and renders remain byte-identical. Live rollout/availability, authenticated acceptance, hosted CI, original Python execution and the exact no-op SSA persistence guarantee remain unverified or not covered as described above.
