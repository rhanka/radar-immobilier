status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@bc89161a8ddd4b49e87b1a05c46c381e52f5de40
lens: guard-scripts-and-oauth-semantics (round 3)

## Reasoning

Reviewed `git diff origin/main...bc89161a8ddd4b49e87b1a05c46c381e52f5de40` and `git diff 220c5c37 bc89161a8ddd4b49e87b1a05c46c381e52f5de40`. Base was `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. I read my four requested round-1/round-2 prompts and reviews. No review file whose name contains `astra` was read, and no peer was contacted. This is an independent leg, not a consensus verdict.

The branch was `fix/mcp-preprod-expose`; HEAD was already `eb35da93a32ccb8607df65122753c7ac037afcba`. An initial `git diff --exit-code <target> -- deploy .github/workflows Makefile ui/nginx api/Dockerfile` returned 0. The requested checks first ran against those target-identical inputs. The working tree's reconcile test changed during this review, so I also ran both suites against exact target files materialized with `git archive`, and repeated make after adding its required `api/src` inputs to that archive. Findings below concern the requested commit, not subsequent working-tree changes. All mutations were confined to the archived scratch source and restored between cases.

Only this leg was edited by me outside `.review-tmp-sol-r3/`. `TMPDIR` confined nested temporary files there. A scratch kubectl wrapper allowed only offline `kustomize`, `version --client`, and `patch`/`set` with `--local`; all reconcile/workflow get/apply/diff/patch/rollout operations used fake executables. A nonexistent scratch `KUBECONFIG` and `K8S_VALIDATE_WITH_CLUSTER=0` were set. No cluster access, real kubeconfig, credentials, direct reviewer Python invocation, reviewer-written Python, commits, pushes, or GitHub writes were used. The requested reconcile test invokes the existing standard-library-only `kfilter.py` through the production script. The scratch directory was removed after recording evidence.

**Annotation lookup and first adoption.** The single quotes in `reconcile-preprod.sh:134` preserve the backslash in `sentropic\.dev/immo-mcp-config-rv`. Escaping the dot makes the annotation's complete key one map field; its slash and hyphens need no additional escaping. Actual kubectl v1.35.3, using `patch --local -p '{}' -o` on local Deployment JSON, read `101` through this exact JSONPath. Removing the backslash returned empty output instead. Both a missing key and a missing `annotations` map returned empty output with exit 0. The comparison at line 135 therefore patches a Deployment being adopted for the first time, even if its ConfigMap already has the desired data. Local merge-patch controls confirmed that the production payload creates the missing template annotation and preserves unrelated annotations. The independent reconcile mock also patched a present Deployment with an initially absent annotation.

**Retry recovery.** The live ConfigMap resourceVersion is read after its successful server-side apply (`:129`–`:131`). It is compared as a string, without numeric ordering assumptions. My adapted two-run reproduction started with old ConfigMap contents, RV `100`, and template annotation `100`. The mock apply persisted desired contents and advanced RV to `101`; the template patch then failed with exit 26. Run 1 stopped before the later CronJob/Deployment applies and retained annotation `100`. Run 2 modeled a no-op apply of the already-persisted contents, preserved RV `101`, and accepted the patch. The target returned 0 and annotated the template `101`. A third converged run returned 0 without a patch. No image change was supplied during these runs. This resolves the exact partial-success recovery gap of SOL-837-R2-01; the equality assertion records rollout intent, not actual pod readiness.

**No-op server-side apply/resourceVersion: unverified.** The relevant Kubernetes references are [API concepts — resource versions](https://kubernetes.io/docs/reference/using-api/api-concepts/#resource-versions) and [Server-Side Apply — field management](https://kubernetes.io/docs/reference/using-api/server-side-apply/#field-management). I did not fetch them: `kubernetes.io` is outside the four permitted HTTPS hosts, and no local documentation establishing the requested guarantee was available. I cannot provide a checked documentation citation proving that an otherwise identical SSA request preserves resourceVersion. No server experiment was performed. Both the supplied fake and my retry fake model stable RV on a true no-op; this is an explicit assumption, not evidence for Kubernetes storage behavior. Applying identical data can still change ownership/other metadata, so it must not automatically be described as an object-level no-op. Such a change would legitimately cause an extra annotation patch. The unconditional no-op assertion in the comment at `reconcile-preprod.sh:126` remains unverified. No demonstrated endless-rollout defect is reported from that uncertainty.

**Shell and RBAC.** The initial Deployment lookup and both RV lookups are standalone assignments, so their command-substitution exit statuses reach `set -e`. A missing annotation is successful empty output, whereas a failed GET remains fatal. `${mcp_cm_rv:?…}` rejects both an unset and an empty value; it is outside a conditional/OR list. The MCP apply pipeline and Deployment patch are also outside error-suppressing lists, so `pipefail` and `errexit` preserve failures. The existing multi-object diff at line 108 is deliberately log-only; step 4b no longer depends on a diff status. Extra mocks confirmed failure propagation for lookup exit 17, apply exit 24, ConfigMap GET exit 18, annotation GET exit 19, patch exit 26, and empty RV exit 1. The lookup and GET error mocks printed nonempty stdout before failing, ruling out accidental acceptance based on output alone. None continued to the later CronJob apply. The declared preprod Role grants Deployment get/patch and ConfigMap get/create/patch/update (`11-ci-deployer-preprod-rbac.yaml:72`, `:110`); these cover the new operations without an RBAC change. Installed grants and admission policy are unverified.

**Following set-image and Recreate.** The annotation patch changes only `.spec.template.metadata.annotations`; it leaves the image untouched. Local `kubectl set image --local` with the same image emitted no changed object; a different image retained the RV annotation. The workflow's image patch remains the final image mutation (`build-push-images.yml:824`). The controller can see both template changes together or see two successive generations; no deterministic command failure or image reversal from that sequence was demonstrated. The declared MCP is one replica with `Recreate` (`40-immo-mcp-http-deploy.yaml:113`), so either rollout can interrupt service and discard in-memory sessions. Whether it performs one or two rollouts, and the actual live strategy/image compatibility/scheduling, are unverified.

CD can fail on a rejected annotation patch or set-image command; an extra mock of the exact workflow image-step body returned exit 25 when MCP set-image failed. MCP rollout timeout/unhealthiness alone is caught as a warning (`build-push-images.yml:826`): the same body returned 0 when MCP rollout status failed. Subsequent hard readiness/served-sha checks cover API/UI, not MCP (`:883`, `:945`). Consequently MCP can remain unavailable while CD succeeds. This optional-connector policy and Recreate strategy precede round 3; they are material limits, not a new demonstrated regression. A successful retry patch also does not establish healthy pods or authenticated acceptance.

**Test isolation and sensitivity.** The six reconcile cases reset both state files before each independent case; only the final rejected-patch/retry pair intentionally retains state. Every run resets its call file, supplies `MOCK_GET`/`MOCK_PATCH_FAIL` anew, and captures the child status immediately (`reconcile-preprod-mcp.test.sh:49`). Each parent test process has a fresh temp directory and cleanup trap. The parent's omission of `-e` permits expected failures; the production child retains `set -euo pipefail`. Five independent code regressions were rejected, as was the exact round-2 reconcile. Three other regressions survived because the fake does not interpret JSONPath, validate patch nesting, or advance RV on apply; see SOL-837-R3-01. The suite's absent-deployment case is not a present-deployment/missing-annotation case. My independent local/mocked controls cover the latter, apply/GET failures, and a third converged invocation. Server RV behavior, set-image, controller health, and GitHub-runner execution are not covered by the six-case suite.

The auth guard and suite are unchanged from round 2. Re-instrumenting the four `run_bad_one` cases again produced exactly one diagnostic per isolated UI-rule/MCP-rule/MCP-TLS-host/MCP-TLS-secret mutation. Seven additional negative render mutations and two positive formatting/order controls returned their expected statuses. The awk remains the POSIX code reviewed in round 1; this round used the default mawk and did not repeat the BusyBox campaign. The new CI step is still in `quality` on `ubuntu-latest`, after checkout and kubectl installation (`ci.yml:15`, `:30`, `:45`), and requires no workspace dependency installation or cluster. Actual hosted-runner/full-CI status is unverified.

**OAuth and production scope.** The changed preprod resource remains an allowed API bearer audience, and both MCP/API use the preprod issuer (`api/src/config.ts:350`, `:370`; `server-http.ts:173`). The approved-account gate remains necessary (`api/src/routes/auth.ts:649`). The `/mcp` Prefix route covers transport and its appended PRM URL. Round 2 recorded the corrected dedicated client-ID, public PKCE, account approval, connector setup, and authenticated acceptance handoff; I retain that documented resolution, with the current remote PR body unverified because it was not fetched this round. Public metadata/challenge probes were repeated only on the four allowed hosts. They still show correct prod discovery/challenge and preprod UI HTML; actual operator installation, IdP registration, account approval, granted scopes, and authenticated operation remain unverified.

Both production renders and the whole `deploy/k8s` tree are byte-identical to origin/main, including raw files 30/40/41/70 and refresh manifests/rendering inputs. `k8s-apply-mcp.yaml` is identical. Removing full-line comments from `build-push-images.yml` yields identical bytes; all its comment hunks are inside `deploy-preprod`. The only `ci.yml` change is the reconcile-test step plus a separating blank line. Production apply inputs and job behavior are invariant at the target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| SOL-837-01 | non-blocking | resolved | Target `check-preprod-auth-isolation.test.sh:29`, `:107`: per-object/per-field reinjection and exactly-one-diagnostic assertion remain. Re-instrumented suite: four isolated expected messages, `PASS=25 FAIL=0`, exit 0. No round-3 change to these files. |
| SOL-837-02 | non-blocking | resolved | My `round2-leg-sol.md`, “Resolution of round-1 findings” and “OAuth handoff”, records the verified PR-body correction: explicit dedicated `OAUTH_CLIENT_ID`, public PKCE/resource/scopes, approved radar account, client ID/empty secret in connector settings, authenticated initialize/tools-list/search_signals acceptance. The registration builder still requires this explicit ID (`oauth-register-client.ts:89`) and radar still enforces approval (`auth.ts:649`). Resolution concerns the missing handoff; the current remote body and execution of those steps are unverified this round. |
| SOL-837-R2-01 | non-blocking | resolved | Target `reconcile-preprod.sh:129`: apply → live RV GET → compare template annotation → patch. Adapted two-run reproduction: successful CM persistence/rejected patch exits 26 with RV=101/annotation=100; same-image retry exits 0 and patches annotation=101 despite unchanged CM contents; third run performs no patch. Supplied recovery case also passes. |

## New findings

### SOL-837-R3-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/reconcile-preprod-mcp.test.sh:31`, `:35`, `:39`, `:70`.
- **Evidence:** The fake returns state values without evaluating `-o jsonpath`, extracts the annotation value without checking the patch's JSON nesting, and never changes ConfigMap RV during apply. In three independent scratch mutations of the exact target reconcile, (1) removing the JSONPath dot escape, (2) patching root `metadata.annotations` instead of `spec.template.metadata.annotations`, and (3) reading RV before apply each still produced `PASS=6 FAIL=0`, exit 0. The root-annotation mutation passes the named “pod template annotated” and retry tests while never changing a real pod template. Actual offline kubectl controls demonstrate the distinction: the escaped path reads `101`, the unescaped path reads empty, and a root-metadata patch leaves template RV at `101` rather than `102`. The target's current escaped lookup and correctly nested merge patch passed those real local controls; no current production-code defect is established.
- **Fix:** Validate the exact output expressions and complete merge-patch structure, or maintain local JSON objects and use kubectl's `patch --local`/JSONPath printer for these boundaries. Make a changed-config apply advance the mock RV, and require the patched value to equal that post-apply RV. Reject unexpected commands with a nonzero status. Keep the existing case isolation and add a present Deployment with no template annotation. Acceptance: the three demonstrated regressions must fail while the unmodified target and rejected-patch/same-image-retry scenario pass.

## Commands and outputs

Commands ran through `rtk`; prefixes are omitted below for readability. `S` denotes `$PWD/.review-tmp-sol-r3`. All test executions set `TMPDIR="$S/tmp"`, a nonexistent scratch `KUBECONFIG`, the offline kubectl wrapper, and `K8S_VALIDATE_WITH_CLUSTER=0`. Target source was extracted using `git archive <target> deploy ui/nginx .github/workflows api/Dockerfile Makefile`, then `api/src` for the make target. No review directory was archived.

```text
$ git rev-parse HEAD origin/main
eb35da93a32ccb8607df65122753c7ac037afcba
641f48c31a89c9d7bc4f1bc06532728c29018cc8

$ git diff --exit-code bc89161a8ddd4b49e87b1a05c46c381e52f5de40 -- deploy .github/workflows Makefile ui/nginx api/Dockerfile
(initial check: no output)
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
ok: rejects a PROD rule host on the preprod MCP Ingress only
ok: rejects a PROD rule host on the preprod UI Ingress only
ok: rejects a PROD TLS host on the preprod MCP Ingress only
ok: rejects the PROD TLS Secret on the preprod MCP Ingress only
ok: rejects the shared Ingress host patch reverted to PROD
ok: rejects a render without ConfigMap radar-api (no vacuous pass)
ok: rejects an overlay that does not render
PASS=25 FAIL=0
exit=0

$ bash deploy/ci/reconcile-preprod-mcp.test.sh
ok: Deployment absent: no immo-mcp-config apply, no roll, rest reconciled
ok: annotation == ConfigMap resourceVersion: applied, no roll
ok: annotation stale: applied, then pod template annotated with the new resourceVersion
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=6 FAIL=0
exit=0

$ make k8s-validate ENV=review-sol-837-r3
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit=0

$ bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.sh deploy/ci/check-preprod-auth-isolation.test.sh
(no output)
exit=0
```

Both suites produced the same outputs in the target archive. The make command passed initially in the worktree and again in the completed target archive. An intermediate archive-only repeat failed with exit 2 and `image entrypoint check: 17 failure(s)` because my partial archive omitted `api/src`; extracting that exact target directory corrected the fixture. Two other helper corrections were a shell-command quoting error before tests launched and expecting same-image local set-image to print an unchanged object (it actually prints no changed object). These were reviewer-helper errors, not PR findings.

Actual offline client checks used local Deployment JSON, never `get` against a server:

```bash
kubectl patch --local -f "$S/deployment.json" --type merge -p '{}' \
  -o 'jsonpath={.spec.template.metadata.annotations.sentropic\.dev/immo-mcp-config-rv}'
kubectl patch --local -f "$S/deployment.json" --type merge \
  -p '{"spec":{"template":{"metadata":{"annotations":{"sentropic.dev/immo-mcp-config-rv":"102"}}}}}' -o json
kubectl set image --local -f "$S/patched.json" mcp=radar-api:same -o json
```

```text
escaped annotation JSONPath: <101>, exit=0
unescaped dot control: <>, exit=0
no-key: <>, exit=0
no-annotations: <>, exit=0
merge patch creates absent annotation: <102>, exit=0
merge patch preserves other annotation: <kept>, exit=0
same-image set-image: no object emitted, exit=0 (no image patch)
new-image set-image preserves CM annotation: <102>, exit=0
root-metadata patch control leaves pod-template RV: <101>, exit=0
Client Version: v1.35.3
Kustomize Version: v5.7.1
```

The independent fake checked namespace, exact JSONPath arguments, the complete patch payload, and post-apply RV. Its state changed on the first desired-data apply and was retained for retry. Target traces, with unrelated apply calls abbreviated:

```text
patch-rejected: exit=26, rv=101, ann=<100>
get deployment name | … | apply immo-mcp-config | get configmap rv | get template annotation | patch attempted

same-image-retry: exit=0, rv=101, ann=<101>
get deployment name | … | apply immo-mcp-config | get configmap rv | get template annotation | patch attempted | patch rv=101 | apply radar-consistency-snapshot | apply radar-api | apply radar-ui

converged-third-run: exit=0, rv=101, ann=<101>
get deployment name | … | apply immo-mcp-config | get configmap rv | get template annotation | apply radar-consistency-snapshot | apply radar-api | apply radar-ui

first-adoption: exit=0, rv=101, ann=<101>, patch rv=101
lookup-error: exit=17, no apply/patch
apply-error: exit=24, no RV GET/patch/later apply
cmget-error: exit=18, no annotation GET/patch/later apply
annget-error: exit=19, no patch/later apply
empty-rv: exit=1, no annotation GET/patch/later apply
…reconcile-preprod.sh: line 132: mcp_cm_rv: immo-mcp-config has no resourceVersion after apply
EXTRA RECONCILE PASS=9 FAIL=0

exact workflow body, MCP set-image succeeds / rollout fails: exit=0
::warning::radar-immo-mcp rollout not complete within 180s (optional connector, deploy continues)
exact workflow body, MCP set-image fails: exit=25
workflow controls PASS=2 FAIL=0
```

Each code mutation began from the restored exact target reconcile and ran its unchanged target six-case suite:

| Scratch code mutation | Suite output | Exit |
| --- | --- | --- |
| Delete Deployment annotation patch | `PASS=4 FAIL=2` | 1 |
| Invert annotation/RV inequality | `PASS=3 FAIL=3` | 1 |
| Delete empty-RV assertion | `PASS=5 FAIL=1` | 1 |
| Suppress Deployment lookup error with `|| true` | `PASS=5 FAIL=1` | 1 |
| Suppress annotation-patch error with `|| true` | `PASS=5 FAIL=1` | 1 |
| Read ConfigMap RV before its apply | `PASS=6 FAIL=0` | 0 |
| Patch root metadata instead of template metadata | `PASS=6 FAIL=0` | 0 |
| Remove JSONPath dot escape | `PASS=6 FAIL=0` | 0 |
| Replace reconcile with exact round-2 script | `PASS=3 FAIL=3` | 1 |

The target source was restored after each case; final comparison to its saved original returned 0. The three surviving mutations are the evidence for SOL-837-R3-01.

Auth instrumentation produced these four isolated diagnostics and `PASS=25 FAIL=0`, exit 0:

```text
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls
```

Additional independent render cases returned `EXTRA AUTH PASS=9 FAIL=0`, helper exit 0:

| Mutation/control | Exit | Evidence |
| --- | --- | --- |
| Delete each MCP issuer/resource/public-base key, three cases | 1 each | Corresponding `ConfigMap/immo-mcp-config: KEY missing (expected …)` |
| Give API and MCP the same third issuer | 1 | Two pinned-value failures; no issuer-mismatch message |
| Add only an extra prod MCP TLS host | 1 | Only `Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca` |
| Add a second MCP rule with a prod host | 1 | Only `Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca` |
| Double-quote wrong MCP resource `/api/mcp` | 1 | Wrong-resource pinned-value diagnostic |
| Double-quote all eight valid pinned values | 0 | Auth isolation accepted |
| Reverse uppercase ConfigMap data-key order | 0 | Auth isolation accepted |

Public requests used `curl --proto '=https' --max-time 20 -sS` without credentials or redirect following. GETs were limited to IdP `/.well-known/oauth-authorization-server` and app `/mcp/.well-known/oauth-protected-resource`; POSTs were limited to app `/mcp` with JSON `{}`. Each curl returned 0. Response Date headers were 2026-10-09 12:29:35–36 GMT:

| Public endpoint | Observed output |
| --- | --- |
| Prod IdP metadata | HTTP/2 200 JSON; canonical prod issuer, S256, authorization-code, token auth `none`, no registration endpoint |
| Preprod IdP metadata | HTTP/2 200 JSON; canonical preprod issuer, same capabilities, no registration endpoint |
| Prod POST `/mcp` | HTTP/2 401 JSON; `resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"` |
| Prod GET PRM | HTTP/2 200 JSON; prod resource/issuer and three `immo:*` scopes |
| Preprod POST `/mcp` | HTTP/2 405 HTML; nginx, `405 Not Allowed` |
| Preprod GET PRM | HTTP/2 200 HTML; nginx, SPA title `Radar immobilier` |

Both IdP advertised scope lists omit `immo:*`; actual per-client allowed/granted scopes are unverified. No authenticated requests were made.

Production comparisons used baseline/target archives and `kubectl kustomize` for the base plus `kubectl kustomize --load-restrictor LoadRestrictionsNone` for `refresh-cronjobs-prod`. `cmp`/`diff -qr` returned:

```text
prod base render: byte-identical (cmp exit=0)
prod refresh render: byte-identical (cmp exit=0)
entire deploy/k8s tree: byte-identical (diff exit=0)
30-api.yaml: byte-identical (cmp exit=0)
40-immo-mcp-http-deploy.yaml: byte-identical (cmp exit=0)
41-immo-mcp-ingress.yaml: byte-identical (cmp exit=0)
70-networkpolicy.yaml: byte-identical (cmp exit=0)
k8s-apply-mcp.yaml: byte-identical (cmp exit=0)
build-push-images.yml without full-line comments: byte-identical (cmp exit=0)
git diff --check origin/main...<target>: exit=0
```

The comment comparison used `sed '/^[[:space:]]*#/d'`. The `ci.yml` diff adds exactly:

```yaml
      - name: Validate preprod reconcile immo-mcp branch (hermetic, fake kubectl)
        run: bash deploy/ci/reconcile-preprod-mcp.test.sh
```

Header lines 2–6 were retained from the dispatched stub; the only header change is `status: completed`. Review-file whitespace and scratch-removal checks completed with exit 0.

## Verdict

**GO-with-nits.** All three earlier findings are resolved at the evidence levels stated above. Required checks pass and production invariance is reconfirmed. SOL-837-R3-01 is a demonstrated non-blocking test-coverage gap; no blocking production-code regression was demonstrated. No-op SSA/RV preservation, live grants/admission, controller/pod health, operator installation, current remote handoff text, and authenticated preprod acceptance remain unverified. CD success alone does not establish a healthy MCP.
