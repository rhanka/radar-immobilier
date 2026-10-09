status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@54fe14a3f5650479b75e08e0f20d248645ea364e
lens: kustomize-render-prod-invariance-and-deploy-path (round 6)

## Reasoning

Reviewed `origin/main...54fe14a3f5650479b75e08e0f20d248645ea364e` and the delta from `a6732b7b`. Base resolved to `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Worktree HEAD was `9cf7de23204b5d488bd8761a1d49fb10415b308f`; its deploy files, workflows, Makefile, API Dockerfile/source and UI nginx configuration matched the requested target. Verification and mutation fixtures used archives of the exact base and target. The later HEAD's review/plan changes were not substituted for the target. The only round-6 code change is `deploy/ci/reconcile-preprod-mcp.test.sh` (14 added, 4 removed lines); the delta also contains review/plan material. Reconcile, manifests, overlays and workflows are unchanged from round 5.

I read my own round-1 through round-5 prompts and reviews, repository rules, and the using-harness/review instructions. No review file whose name contains `sol` was read, and no peer was contacted. This is one independent leg. No cluster access, real kubeconfig, Python interpreter, stack, commit, push or GitHub write was used. Real kubectl operations were offline rendering, client-only ConfigMap generation, local patch/image inspection and client version inspection, with `KUBECONFIG=/dev/null`. Public requests used only the two permitted immo HTTPS hosts, without credentials or redirect following. Throwaway files, including subprocess temporary files through `TMPDIR`, were confined to `.review-tmp-astra-r6/` and removed at completion. This report is the only retained modification.

**Execution boundary.** The reconcile suite invokes the existing Python `kfilter.py`. As in my previous rounds, a temporary `python3` PATH adapter accepted only that filter invocation and dispatched a Node translation of its document-selection logic; other Python invocations were rejected. The unchanged Python source was inspected. The actual target Bash test/reconcile, real offline kustomize, auth gate and header-parity gate ran. Execution of the original Python filter is **not covered**. This boundary applies to the reconcile suite, trace and mutations. Auth-isolation and `make k8s-validate` ran without the adapter. Exact hosted CI execution is **unverified**.

**Delta and false failures.** The unmodified target returns `PASS=11 FAIL=0`, exit 0, with the execution boundary above. At test lines 119–125, an independent preprod render supplies the expected whole ConfigMap document; it is compared with the actual document captured by the fake apply at lines 47–52. The expected document does not pass through reconcile's filter. This checks payload preservation beyond the individually named fields. Lines 126–131 retain explicit namespace, issuer, resource, public URL and scopes checks and add the internal API URL.

The splitter at lines 120–124 uses POSIX awk constructs: line records, anchored regular expressions, scalar concatenation, `if`, `next`, `printf` and `END`. It does not depend on a multi-character `RS`, GNU extensions or capture-array arguments. The separator branch emits the selected document, resets all selection state and omits the separator. `END` handles a selected final document. Canonical kustomize output has `kind` before `metadata.name`, exact `---` separators and no extra blank records around this ConfigMap; the resulting text, including its final newline, matches the filter/fake's payload normalization. This is a check of that canonical render, not an arbitrary-YAML parser.

The exact extracted awk program produced byte-identical output under mawk 1.3.4 and BusyBox awk 1.37.0, both for the real render and for first/middle/last-document, leading/trailing-separator, single-document and missing-final-newline fixtures. A no-match fixture emitted nothing; a Service with the same name and an indented `---` inside a different ConfigMap did not contaminate selection. `nawk` also passed but resolves to mawk here, so it is not a third implementation. The entire unmodified reconcile suite also passed with BusyBox awk substituted on PATH (`PASS=11 FAIL=0`). No false failure was observed. GNU awk and the exact hosted runner were not exercised.

All 21 mutants from my round-5 review were rerun against the target test and rejected. Six additional post-filter payload mutants were rejected: deletion of `RADAR_API_BASE_URL`, data mode, HTTP port, `NODE_OPTIONS` or `apiVersion`, and replacement of the API URL. Each failed the applied-document assertion with `PASS=10 FAIL=1`. A seventh additional mutant changed the preprod patch's API URL to `http://radar-ui:8080`, so the applied and independently rendered documents agreed on that wrong value. The explicit value assertion still rejected it (`PASS=10 FAIL=1`). Thus the new explicit API value check was exercised separately from byte equality. Twenty-eight mutants were rejected in total; none survived. These checks do not establish exhaustive regression coverage.

**Earlier runtime findings.** Reconcile retains `set -euo pipefail` at line 49 and the NotFound-only lookup assignment at line 83. Lines 129–138 apply the ConfigMap, read and require its live resourceVersion, read the pod-template annotation and merge-patch it when unequal. A missing annotation is allowed and causes the first template update. The update signal is independent of an image change and remains available after a failed patch.

A disposable trace copy added logging immediately after the test's `RC=$?`, leaving reconcile and every assertion unchanged. It returned `PASS=11 FAIL=0`. The changed-config case applied version `101` before reading and patching it; the settled run made no patch. The failure/retry pair persisted version `102`, failed patch with exit 23 while annotation remained `101`, then successfully patched `102` on retry. The initial lookup failure stopped before any apply. Version-read failures preserved exits 18 and 19 even after printing a value and stopped before patch/later applies. These are modeled command paths, not observations of real pods.

Real kubectl local checks accepted the exact escaped annotation JSONPath extracted from reconcile, returning `101` for a present key and empty output with exit 0 for either a missing key or missing annotations map. The actual nested merge-patch text, with fixture version `102`, preserved an unrelated annotation and the image. A subsequent local image change preserved the version annotation; setting the already-current image emitted no changed object.

The committed preprod Role still grants Deployment get/patch/update and ConfigMap get/create/patch/update (`deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72`, `:110`), covering these operations. Live RBAC/admission state is **unverified**. Reconcile still precedes set-image (`.github/workflows/build-push-images.yml:800`, `:824`) and applies neither Ingress nor the MCP Deployment/Service manifest. One replica with `Recreate` does not establish uninterrupted availability. The unchanged MCP rollout wait converts failure into a warning at workflow lines 826–827, so successful CD does not prove MCP readiness. Operator Ingress application, IdP registration/account approval and authenticated acceptance remain necessary and are **not covered**. The current PR body was not fetched in this round.

The precise no-op server-side-apply/resourceVersion guarantee remains **unverified**. The fake models it; no API server or checked documentation passage was used, and Kubernetes documentation is outside the permitted HTTPS hosts. Metadata/field-ownership changes can also advance resourceVersion. An extra version change would request an extra template update rather than consume the retry signal. No defect in the submitted implementation was demonstrated on that basis.

**Prod invariance.** The prod base render, refresh overlay, digest-pinned refresh make target, 25 raw prod apply inputs and their normalized renders, migration payload, pre-release backup payload and client-generated/labeled daily-backup ConfigMap compare byte-identically with origin/main. Of existing archived deploy files, 169 are identical and four differ: the preprod auth guard, its test, reconcile and preprod kustomization. No `deploy/k8s` file changes. The new deploy files are the reconcile test and two preprod patches. Existing sealed manifests were compared without printing their contents; none was introduced or changed, and no runtime Secret was read.

In `build-push-images.yml`, removing comment-only lines gives identical bytes; the entire prefix before the preprod section and the entire `promote-prod` job also compare identically. All changed comments are in or introduce deploy-preprod. Removing the single three-line reconcile-test step from `ci.yml` reproduces base bytes; the other ten workflows are identical. Prod jobs do not invoke the changed reconcile script. This establishes checked-in input/render invariance, not live-object or runtime-input equality.

The preprod render still contains four additions (MCP ConfigMap, Service, Deployment and Ingress), one changed existing object (UI Ingress host/TLS fields), 26 identical objects and no removals. All namespaces are preprod. The MCP's five unpatched data keys compare identically with prod: data mode, HTTP port, scopes, `NODE_OPTIONS` and `RADAR_API_BASE_URL`. The unchanged overlays retain `/mcp` Prefix, matching Service/Deployment selectors and `http:8848` mapping, preprod issuer/resource/public URL, the shared preprod TLS Secret and 10m requested CPU. Public probes below still reproduce the routing symptom; they do not establish deployment of this target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| ASTRA-837-01 | non-blocking | resolved | `reconcile-preprod.sh:129`–138 requests a template update independently of image changes. Trace: changed config patches `101`, an existing Deployment without the annotation patches `100`, settled run does not patch. Deleting the patch is rejected with `PASS=8 FAIL=3`. Actual pod readiness remains unverified, distinct from the omitted-update finding. |
| ASTRA-837-02 | non-blocking | resolved | Line 83 retains `--ignore-not-found -o name` in an errexit-governed assignment. Trace: successful empty lookup exits 0 without MCP operations; failed lookup exits 1 before any apply with the Forbidden diagnostic. Swallowing lookup failure is rejected with `PASS=10 FAIL=1`. |
| ASTRA-837-R2-01 | non-blocking | resolved | Trace: first apply advances ConfigMap version to `102`; patch exits 23 and leaves annotation `101`. Retry reads persisted version `102`, patches annotation `102` and completes, without requiring an image change. Swallowing patch failure is rejected with `PASS=10 FAIL=1`. |
| ASTRA-837-R3-01 | non-blocking | resolved | Changed apply advances the fake version, exact JSONPath is checked, and missing annotation/settled rerun are covered. All three former survivors fail again: read-before-apply `PASS=8 FAIL=3`; unescaped dot `PASS=5 FAIL=6`; existing-annotation prerequisite `PASS=10 FAIL=1`. Real client JSONPath checks pass. |
| ASTRA-837-R4-01 | non-blocking | resolved | `reconcile-preprod-mcp.test.sh:44` requires the persisting apply command. Adding `--dry-run=server` or removing `-f -` is rejected with fake exit 98 and suite exit 1, each `PASS=2 FAIL=9`. The unmodified target passes. |

Round 5 reported **none** under New findings, so there is no additional round-5 finding ID to resolve. Every mutant recorded in that review was rerun below.

## New findings

none

No demonstrated finding remains from rounds 1–5. No new defect affecting the shipped scripts/manifests or false failure of the unmodified target was demonstrated. The offline coverage boundaries and unverified live behavior above are not claimed as verified outcomes.

## Commands and outputs

Commands used `rtk`; wrappers are omitted below for readability. Temporary helpers used Bash/Node and offline kubectl. Local versions: kubectl v1.35.3, kustomize v5.7.1, mawk 1.3.4 (20260129), BusyBox v1.37.0. Subprocesses used `TMPDIR=<worktree>/.review-tmp-astra-r6/tmp`, `KUBECONFIG=/dev/null`, `K8S_VALIDATE_WITH_CLUSTER=0`. Only reconcile checks/mutants had the Node filter adapter on PATH.

Target and syntax checks:

```text
git rev-parse HEAD origin/main
9cf7de23204b5d488bd8761a1d49fb10415b308f
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet 54fe14a3f5650479b75e08e0f20d248645ea364e -- deploy .github/workflows Makefile api/Dockerfile api/src ui/nginx/default.conf
exit 0
git diff --quiet a6732b7b 54fe14a3 -- deploy/ci/reconcile-preprod.sh deploy/k8s deploy/overlays .github/workflows
exit 0
bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.test.sh
exit 0
```

Archives used `git archive <ref> deploy .github/workflows Makefile api/Dockerfile api/src ui/nginx/default.conf | tar -x -C <review/base-or-target>`, for origin/main and the full target SHA. No review dossier was archived or scanned. The following required checks ran in the exact-target archive.

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
ok: applied immo-mcp-config = the full rendered preprod document
ok: failed rv read: script stops before the patch and the later applies
ok: failed ann read: script stops before the patch and the later applies
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=11 FAIL=0
exit 0

make k8s-validate ENV=review-astra-837-r6
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit 0
```

**Mutation results.** Each mutant used a separate exact-target copy. For the 21 round-5 reruns and first six new mutants, only reconcile was mutated and `bash -n` passed before the target suite ran. The final new mutant changed only the fixture's preprod ConfigMap patch. Every listed suite exited 1; these are expected mutant rejections, not baseline failures.

| Mutation | Origin | Output | Detecting evidence |
| --- | --- | --- | --- |
| Add `--dry-run=server` to MCP apply | Round 5 rerun | `PASS=2 FAIL=9` | Unexpected apply, fake exit 98 |
| Remove `-f -` from MCP apply | Round 5 rerun | `PASS=2 FAIL=9` | Unexpected apply, fake exit 98 |
| Read ConfigMap version before apply | Round 5 rerun | `PASS=8 FAIL=3` | Changed-config, settled and retry sequence |
| Remove escaped dot in annotation JSONPath | Round 5 rerun | `PASS=5 FAIL=6` | Exact GET rejected, fake exit 98 |
| Require existing nonempty annotation | Round 5 rerun | `PASS=10 FAIL=1` | Existing Deployment without annotation |
| Delete template patch | Round 5 rerun | `PASS=8 FAIL=3` | Changed config, missing annotation, retry |
| Patch unconditionally | Round 5 rerun | `PASS=9 FAIL=2` | Current annotation and settled run |
| Swallow initial lookup error | Round 5 rerun | `PASS=10 FAIL=1` | Failed lookup incorrectly continues |
| Swallow patch failure | Round 5 rerun | `PASS=10 FAIL=1` | First retry-pair run incorrectly succeeds |
| Swallow ConfigMap version-read error inside substitution | Round 5 rerun | `PASS=10 FAIL=1` | Failed read incorrectly patches/continues |
| Swallow annotation-read error inside substitution | Round 5 rerun | `PASS=10 FAIL=1` | Failed read incorrectly patches/continues |
| Remove empty-version guard | Round 5 rerun | `PASS=10 FAIL=1` | Empty patch reaches `bad patch`, violates `clean` |
| Change field manager; remove force-conflicts; remove server-side apply (three separate mutants) | Round 5 reruns | Each `PASS=2 FAIL=9` | Exact apply rejected, fake exit 98 |
| Delete applied kind, namespace, issuer, resource, public URL, scopes (six separate mutants) | Round 5 reruns | Each `PASS=10 FAIL=1` | Applied-document comparison |
| Delete applied API URL, data mode, HTTP port, `NODE_OPTIONS`, `apiVersion` (five separate mutants) | Round 6 | Each `PASS=10 FAIL=1` | Whole-document comparison |
| Replace applied API URL with `http://radar-ui:8080` | Round 6 | `PASS=10 FAIL=1` | Whole-document comparison |
| Set preprod patch API URL to `http://radar-ui:8080` in both actual/expected renders | Round 6 | `PASS=10 FAIL=1` | Explicit API value check despite equal documents |

Post-filter payload mutants insert `sed '/^<field>:/d'`, with the actual two-space indentation for namespace/data fields, between block 4b's `kf` and apply. API replacement uses `sed 's#http://radar-api:3000#http://radar-ui:8080#'`. The read-error mutants add `|| true` inside the relevant substitution, preserving stdout while suppressing failure. Apply-command mutations change only the block-4b call. The final render mutant appends `RADAR_API_BASE_URL: "http://radar-ui:8080"` under the copied preprod patch's `data`. It returns `FAIL: applied immo-mcp-config differs from the render:` with an empty diff because the explicit value, rather than byte equality, failed.

**Awk portability and trace outputs:** the exact awk source was extracted from target lines 120–124 and executed with `mawk -f`, `nawk -f`, and `busybox awk -f` against the same inputs; each output was compared with an independent selection of the real rendered document. The full BusyBox run used an `awk` PATH wrapper and unchanged target scripts. The trace copy added logging/copying after `RC=$?`, without altering assertions.

```text
mawk: exact split matches independent selection; 8 positive fixtures + no-match pass
nawk: exact split matches independent selection; 8 positive fixtures + no-match pass
busybox: exact split matches independent selection; 8 positive fixtures + no-match pass
Full unmodified suite with BusyBox awk: PASS=11 FAIL=0
TRACE absent rc=0 rv=100 ann=
TRACE current rc=0 rv=100 ann=100
TRACE changed rc=0 rv=101 ann=101
TRACE settled rc=0 rv=101 ann=101
TRACE first rc=0 rv=100 ann=100
TRACE readfail-rv rc=18 rv=101 ann=100
TRACE readfail-ann rc=19 rv=101 ann=100
TRACE lookup rc=1 rv=100 ann=100
TRACE norv rc=1 rv= ann=100
TRACE patchfail rc=23 rv=102 ann=101
TRACE retry rc=0 rv=102 ann=102
PASS=11 FAIL=0
```

Retained call logs show `apply immo-mcp-config → read rv → read ann → patch-failed` on the failing run, then `apply immo-mcp-config → read rv → read ann → patch rv=102 → later applies` on retry. Lookup failure logs only the lookup. Both failing version reads stop at that read. No real API effects are represented by this fake state.

Real client commands used the annotation expression and patch JSON extracted from target reconcile (only fixture version `102` substituted):

```bash
kubectl patch --local -f - --type merge -p '{}' \
  -o 'jsonpath={.spec.template.metadata.annotations.sentropic\.dev/immo-mcp-config-rv}'
kubectl patch --local -f - --type merge -p <target-patch-with-rv-102> -o json
kubectl set image --local -f - mcp=ghcr.io/rhanka/radar-api:same -o json
kubectl set image --local -f - mcp=ghcr.io/rhanka/radar-api:new -o json
```

```text
present: exit=0 stdout="101"
missing-key: exit=0 stdout=""
missing-map: exit=0 stdout=""
merge-patch: rv=102 keep=yes image=same
set-image-same: exit=0 stdout=""
set-image-new: rv=102 image=new
```

**Prod/preprod comparisons.** The following ran for each archive, and corresponding outputs were compared with `cmp`:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s/refresh-cronjobs-prod
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/overlays/preprod
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute-review-output-file> ENV=review-astra-837-r6
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

The 25 raw and normalized prod input comparisons were:

| Workflow path | Compared files |
| --- | --- |
| MCP apply; file 40 also used by prod deploy/promote | `deploy/k8s/{30-api,40-immo-mcp-http-deploy,41-immo-mcp-ingress,70-networkpolicy}.yaml` |
| run-job prod selections | `deploy/k8s/35-run-geo-mapper-job.yaml`, `42-graph-city-key-repair-job.yaml`, `35-consistency-snapshot-job.yaml`, `32-graph-projection-only-job.yaml`, `37-graphify34-apply-job.yaml`, `37-graphify34-slugs-configmap.yaml`, `38-graphify34-emit-candidates-job.yaml`, `38-graphify34-set167-configmap.yaml`, `33b-scrape-cities-job.yaml`, `33-scrape-chunk-loop-configmap.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml`, `41-document-date-recovery-job.yaml` |
| Bascule prod bundle | `deploy/ci/bascule-preprod/{radar-db-ro-prod-sealed,radar-pra-admin-prod-sealed,db-ro-role-provision,cronjob-db-backup-prod,vap-ci-trigger-suspend-only,rbac-ci-trigger-prod}.yaml` |
| Daily backup | `deploy/ci/backup/{cronjob-backup-daily,cronjob-backup-freshness}.yaml` |

Normalization used offline `resources: [object.yaml]` kustomize wrappers. Both sides received identical run-job substitutions: the zero image digest above, city `brossard`, chunk size `10`, backup ID `review-astra-837-r6`, mapper reset `1`, recovery args `--apply --heal brossard`, repair args `--run-id graph-city-key-prod-review --apply brossard`. Migration used prod namespace, suffix `-54fe14a` and the same digest. The backup template received identical nonsecret values for exactly the twelve variables declared by `run-db-backup.sh`'s envsubst call; other runtime shell variables were preserved. Daily-backup ConfigMap generation used the actual `kubectl create configmap --dry-run=client` and `kubectl label --local` operations with all three workflow labels. No generated payload was applied.

**Public probes.** All four `curl` commands exited 0; response Date headers were `2026-10-09 16:20:49 GMT`. Options were `-q --silent --show-error --max-time 25 --include`, plus `--request POST --header 'Content-Type: application/json' --data '{}'` for POSTs. No credentials or redirects were used.

| URL / method | Response |
| --- | --- |
| `https://immo.sent-tech.ca/mcp` POST | HTTP/2 401, `application/json`, `invalid_token`; challenge names prod `/mcp/.well-known/oauth-protected-resource` |
| `https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `application/json`; resource `https://immo.sent-tech.ca/mcp`, authorization server `https://auth.sent-tech.ca`, scopes `immo:read`, `immo:search`, `immo:documents:read` |
| `https://preprod.immo.sent-tech.ca/mcp` POST | HTTP/2 405, `text/html`, nginx, `405 Not Allowed` |
| `https://preprod.immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource` GET | HTTP/2 200, `text/html`, SPA body containing `<div id="app"></div>` |

These reproduce the public routing symptom; they do not establish post-deploy acceptance of this target.

## Verdict

**GO.** All five earlier findings are resolved in the demonstrated command paths and regression cases; round 5 added no finding. All 21 round-5 mutants and seven additional round-6 mutants are rejected. No new finding remains and no false failure was observed on the unmodified target, including the awk checks. Both requested suites and offline Kubernetes validation pass within the stated no-Python substitution boundary. Prod inputs and renders remain byte-identical. Live rollout/availability, authenticated acceptance, hosted CI, original Python execution and the exact no-op SSA persistence guarantee remain unverified or not covered as described above.
