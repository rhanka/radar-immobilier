status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@220c5c376d6971c9699bc4e7ea6e330c7d7a4adb
lens: kustomize-render-prod-invariance-and-deploy-path (round 2)

## Reasoning

Reviewed `origin/main...220c5c376d6971c9699bc4e7ea6e330c7d7a4adb` and the delta from `ddce2b4fd930b48f3926dc6081e1c9b886c2c73d`. Base was `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. Worktree HEAD was `efdaafc4bf10a6a245493f33e28d938ba4bea066`; its deploy files, workflows and Makefile compared identically with the requested target. Separate base/target archives supplied the comparison and mutation fixtures. I read my own round-1 prompt and review, the repository rules and harness using/review guidance. No other review leg/prompt was read and no peer was contacted. This is one independent leg, not a consensus result.

No cluster API, real kubeconfig, stack, Python interpreter, commit, push or GitHub write was used. Public requests were unauthenticated HTTPS to the permitted immo hosts, without redirect following. The PR body was read through the explicitly authorized `gh pr view`. Real kubectl executions were local rendering/client inspection with `KUBECONFIG=/dev/null`; cluster operations in the shell checks were mocked. Temporary review artifacts were removed at completion; this file is the only retained change.

**Test boundary.** The requested new shell test calls the existing Python `kfilter.py` through reconcile. To obey the no-Python constraint, I placed a review-only `python3` command on PATH that delegates solely that filter call to a Node translation of its text-selection logic. The repository scripts and their Bash control flow were unchanged. Thus the reported five-case result covers the actual test/reconcile shell scripts, real offline kustomize render, real auth/header gates and mocked kubectl operations, but execution of the original Python filter is **not covered**. Its source was inspected: standard-library `re` and `sys` only. The same boundary applies to the independent reconcile mocks and mutation runs below. Auth-isolation and `make k8s-validate` ran without this substitution.

**Bash and RBAC.** At `deploy/ci/reconcile-preprod.sh:83`, the assignment contains a single kubectl command. A successful empty `--ignore-not-found -o name` result skips the MCP branch; an error makes the assignment nonzero and `set -e` aborts before any apply, with stderr preserved. Injected Forbidden exit 7 reproduced that behavior. The separate `mcp_cm` assignment at line 126 likewise propagated an injected filter exit 17.

Lines 127–134 initialize the result to zero, use `printf '%s\n'` with a quoted argument, and capture the pipeline status with `|| mcp_cm_diff=$?`. There is no `!` inversion losing the exit code. With `pipefail`, the captured value is the pipeline's rightmost nonzero status. The OR-list allows the documented diff result 1 without triggering errexit; result 0 keeps the initialized zero, 1 proceeds to apply/restart, and results 2 and 37 both aborted before the MCP apply in the mocks. The initial multi-object diff at line 108 remains diagnostic (`|| true`); the later MCP-only diff is the gate. MCP apply exit 19 and restart exit 23 both stopped subsequent reconciliation and prevented the following workflow step from running. The earlier UI/API ConfigMap applies can already have succeeded: this script is not transactional.

The committed preprod Role grants `apps/deployments` get/list/watch/patch/update at `deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72` and ConfigMap get/list/create/patch/update at line 110. These cover the lookup, server-side diff/apply, and `rollout restart` Deployment patch. The latter explicitly uses `-n "$NAMESPACE"`. No Deployment creation, Service or Ingress application was introduced. Live Role/Binding and admission behavior are **unverified**.

**Restart, set-image and availability.** Workflow lines 799–800 run reconcile before the image step at 811–829. For changed config, the mock trace shows ConfigMap apply, MCP restart, the remaining durable-object applies, and finally MCP set-image. The restart changes the pod-template annotation and does not write an image; the later set-image writes the release image and preserves that annotation. Same-image and new-image paths both completed in the mocks. There is no demonstrated shell ordering or image-reversion defect on those paths.

This does not prove uninterrupted MCP availability or absence of a crash loop. The declared Deployment is one replica with `Recreate` (`deploy/k8s/40-immo-mcp-http-deploy.yaml:113`); two successive template updates can entail replacement before and/or after the image change. Readiness/liveness use the local PRM path (lines 159–176). The changed ConfigMap retains all five non-environment data keys; issuer/resource remain present for `loadHttpConfig` (`packages/immo-mcp/src/server-http.ts:65`), and `main` loads the environment at startup (line 248). No new startup error is demonstrated from the three replacement values. The currently running image/spec and actual controller scheduling are **unverified**.

In particular, a failing MCP rollout is not itself a hard failure of preprod CD: `.github/workflows/build-push-images.yml:825` converts the 180-second rollout error to a warning. Injecting rollout exit 24 into the actual extracted image-step shell block still produced exit 0. The later hard-failure rollout checks name only radar-api and radar-ui (lines 882–883). Consequently I cannot certify that an unavailable MCP will fail CD; the existing workflow explicitly permits the contrary. This unchanged limit was already recorded in round 1. New lookup/diff/apply/restart API failures do stop CD as described above. Actual post-deploy PRM and authenticated acceptance remain **unverified**. A separate failed-restart recovery gap is demonstrated below.

**Hermetic tests and CI.** The new suite gives each case a fresh/truncated calls file and explicitly supplies MOCK_GET/MOCK_DIFF to a new reconcile process (`reconcile-preprod-mcp.test.sh:46`). It routes only `kubectl kustomize` to the real binary; GET/diff/apply/restart are mocked. The changed case checks apply-before-restart; the unchanged/absent cases prohibit restart; lookup and diff errors require nonzero script results and prohibit the relevant applies. Six targeted code mutations were rejected, as was the exact round-1 script. Fresh copies isolate the four new single-field Ingress injections; `run_bad_one` requires both the named object's expected diagnostic and exactly one `FAIL:` line. Exempting either UI or MCP Ingress from the guard made its isolated regression tests fail. The committed reconcile suite does not cover a failed restart followed by a retry; that is the new finding.

The CI step is in `quality` on `ubuntu-latest` (`ci.yml:15`, `45`), after `azure/setup-kubectl@v4` at line 30. Its tools are Bash, GNU core utilities/grep/sed, awk, diff, kubectl's embedded kustomize and Python 3 standard library through the existing filter. These are compatible with the hosted Ubuntu environment; no npm install, PyYAML, external service, kubeconfig or cluster credential is required. `set -uo pipefail` in the test deliberately allows collecting expected failures, and its final `[ "$FAIL" -eq 0 ]` supplies the CI status. Execution on the exact hosted runner image and the original Python interpreter is **not covered** by this local review; no CI run result is claimed.

**Prod invariance.** Re-rendered both prod trees and all 25 raw prod apply inputs listed below at base and target; every corresponding `cmp` returned 0. This includes equivalent migration, pre-release backup and daily-backup ConfigMap payloads, and the actual digest-pin `render-prod` make target. All 169 unchanged archived deploy files compared identically; the four changed existing deploy files are the preprod guard, its test, reconcile and preprod kustomization. The added deploy files are the new preprod reconcile test and two preprod patches. No `deploy/k8s` file changes.

In `build-push-images.yml`, removing comment-only lines yields identical bytes. The prefix before the preprod section and the entire `promote-prod` job compare identically. All hunks belong to the preprod section's introductory or internal comments. Removing precisely the new three-line test step from `ci.yml` reproduces base bytes; the other ten workflow files compare identically. Prod jobs do not invoke the changed reconcile script. These are checked-in input/render comparisons, not comparisons of live prod objects or runtime Secrets.

**Preprod and handoff.** The preprod render again has four added objects, one changed object, 26 unchanged objects and no removals. All rendered namespaces are preprod. The four additions are ConfigMap `immo-mcp-config`, Deployment/Service/Ingress `radar-immo-mcp`. The sole existing-object change is the UI Ingress's rule host, TLS host and Secret. MCP pod and Service selectors match; the Service exposes named port `http:8848`; the MCP Ingress's `/mcp` Prefix routes to that named port and covers the nested PRM URL. Both Ingresses use `preprod.immo.sent-tech.ca` and `radar-immo-preprod-tls`. Deployment render still uses 10m requested CPU and the inherited image/command/probes; its spec is not in the reconcile apply set. The three MCP URL keys are the intended preprod issuer/resource/public URL, and the other five keys compare identically with prod. Existing NetworkPolicy objects remain unchanged; live enforcement is **unverified**.

After removing Markdown indentation, the literal operator Ingress manifest in the current PR body compares byte-identically with the rendered MCP Ingress. The command is scoped to preprod, and the body excludes dispatching the prod-only MCP workflow. The UI render matches the supplied live summary on host, TLS and route; full live metadata equality remains **unverified**, and the operator procedure does not apply that UI object. The updated handoff explicitly assigns a dedicated `OAUTH_CLIENT_ID`, public PKCE registration, account approval, connector configuration and authenticated acceptance. Actual IdP client existence, account approval and authenticated tool calls are **not covered**. The explicit ID removes reliance on the registration script's stated default; the external IdP script/DB was not inspected here.

## Resolution of round-1 findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| ASTRA-837-01 | non-blocking | partially resolved | `reconcile-preprod.sh:125`–139 now detects ConfigMap drift, applies it and requests restart even when the image is unchanged. The same-image changed-config mock records apply → restart → set-image and exits 0; deleting restart makes the new suite fail. The remaining case is apply success followed by restart failure: the next same-image retry has diff 0 and issues no restart. See ASTRA-837-R2-01 and the two-run reproduction below. |
| ASTRA-837-02 | non-blocking | resolved | `reconcile-preprod.sh:83` uses `--ignore-not-found -o name` in an errexit-governed assignment. Successful empty lookup exits 0 with no MCP diff/apply/restart. Injected Forbidden exit 7 is preserved, stderr is visible, no apply occurs and `reconcile OK` is absent. Suppressing lookup errors makes the committed suite fail. |

## New findings

**ASTRA-837-R2-01 — restart failure consumes the change signal needed by a same-image retry**

- Severity: **non-blocking**.
- File:line: `deploy/ci/reconcile-preprod.sh:135` (apply), `:137` (restart conditional), `:139` (restart).
- Evidence: the script first persists the desired ConfigMap, then restarts only if the preceding diff was 1. A stateful fake API let the MCP ConfigMap apply succeed, returned exit 23 before accepting the restart patch, and retained the updated ConfigMap. The first reconcile exited 23. A second run of the unchanged target against that retained state returned diff 0, applied the already-current ConfigMap, omitted restart, printed `reconcile OK`, and exited 0. The actual workflow image-step block also exited 0 with the same image string. The mock recorded zero successful restarts across both runs. Since the existing process reads `envFrom` only at startup, a same-image retry has no remaining operation that replaces its stale environment. This is a reproduced command-path omission, not a claim of an observed live incident.
- Impact: an interrupted release or transient restart-patch failure after apply leaves the round-1 same-SHA recovery problem partially unresolved. Normal changed-config runs with an accepted restart, and later releases with a different image, are not this failure case. The first failure is visible; the retry can complete without repairing environment uptake.
- Fix: make the pod-template update independently retryable after the ConfigMap already matches, for example reconcile a deterministic config checksum on the existing preprod MCP pod template on every run. Keep that patch within the existing Deployment grant and leave prod untouched. Add a stateful two-run regression: apply succeeds, restart/template patch fails, then same-image retry must still request the missing template update. Owner: PR author.

## Commands and outputs

Commands used `rtk`; wrappers are omitted below for readability. Temporary commands/fixtures were under `.review-tmp-astra-r2/` at verification time and were deleted after recording the evidence. `TMPDIR=$PWD/.review-tmp-astra-r2/tmp`, `KUBECONFIG=/dev/null` and `K8S_VALIDATE_WITH_CLUSTER=0` were used for offline checks. Local kubectl was v1.35.3 with kustomize v5.7.1.

**Target and workflow checks:**

```text
git branch --show-current
fix/mcp-preprod-expose
git rev-parse HEAD origin/main
efdaafc4bf10a6a245493f33e28d938ba4bea066
641f48c31a89c9d7bc4f1bc06532728c29018cc8
git diff --quiet 220c5c376d6971c9699bc4e7ea6e330c7d7a4adb -- deploy .github/workflows Makefile
exit 0
git diff --check
exit 0
bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.test.sh
exit 0
```

Archives were created with `git archive <ref> deploy .github/workflows Makefile api/Dockerfile ui/nginx/default.conf | tar -x -C <base-or-target>`, refs `origin/main` and the full target SHA. The offline Node comparison helper invoked `cmp` and kubectl and emitted:

```text
Archived deploy inputs identical=169
changed=deploy/ci/check-preprod-auth-isolation.sh,
        deploy/ci/check-preprod-auth-isolation.test.sh,
        deploy/ci/reconcile-preprod.sh,
        deploy/overlays/preprod/kustomization.yaml
workflow-noncomments: cmp exit 0
workflow-before-preprod: cmp exit 0
workflow-promote-prod: cmp exit 0
Other unchanged workflow files=10
ci-without-new-step: cmp exit 0
prod: cmp exit 0
prod-refresh: cmp exit 0
migration.rendered: cmp exit 0
backup-before-release.rendered: cmp exit 0
backup-cm: cmp exit 0
refresh-fixed.yaml: cmp exit 0
PREPROD ADDED ConfigMap/radar-immobilier-preprod/immo-mcp-config
PREPROD ADDED Service/radar-immobilier-preprod/radar-immo-mcp
PREPROD ADDED Deployment/radar-immobilier-preprod/radar-immo-mcp
PREPROD CHANGED Ingress/radar-immobilier-preprod/radar
PREPROD ADDED Ingress/radar-immobilier-preprod/radar-immo-mcp
PREPROD base=27 target=31 unchanged=26 additions=4 changes=1 removed=0; all namespaces preprod
mcp-unpatched-data: cmp exit 0
operator-ingress: cmp exit 0
```

Main render commands, each executed for both archived checkouts:

```bash
kubectl kustomize <checkout>/deploy/k8s
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/k8s/refresh-cronjobs-prod
kubectl kustomize --load-restrictor LoadRestrictionsNone <checkout>/deploy/overlays/preprod
make -f <checkout>/deploy/k8s/refresh-cronjobs/refresh-018.mk render-prod \
  IMAGE_REF=ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000 \
  RENDER_OUT=<absolute-review-output-path> ENV=review-astra-837-r2
```

All commands exited 0. The following individual prod inputs also had both raw-file and normalized-render `cmp exit 0`. Normalization used a temporary `resources: [object.yaml]` kustomization, never an apply.

| Workflow path | Compared files |
| --- | --- |
| MCP apply; file 40 also used by prod deploy/promote | `deploy/k8s/{30-api,40-immo-mcp-http-deploy,41-immo-mcp-ingress,70-networkpolicy}.yaml` |
| run-job prod selections | `deploy/k8s/35-run-geo-mapper-job.yaml`, `42-graph-city-key-repair-job.yaml`, `35-consistency-snapshot-job.yaml`, `32-graph-projection-only-job.yaml`, `37-graphify34-apply-job.yaml`, `37-graphify34-slugs-configmap.yaml`, `38-graphify34-emit-candidates-job.yaml`, `38-graphify34-set167-configmap.yaml`, `33b-scrape-cities-job.yaml`, `33-scrape-chunk-loop-configmap.yaml`, `39-export-graph-nodes-job.yaml`, `40-export-gt-designation-events-job.yaml`, `41-document-date-recovery-job.yaml` |
| bascule prod bundle | `deploy/ci/bascule-preprod/{radar-db-ro-prod-sealed,radar-pra-admin-prod-sealed,db-ro-role-provision,cronjob-db-backup-prod,vap-ci-trigger-suspend-only,rbac-ci-trigger-prod}.yaml` |
| daily backup | `deploy/ci/backup/{cronjob-backup-daily,cronjob-backup-freshness}.yaml` |

Run-job substitutions were identical on both sides: the zero digest above, city `brossard`, chunk size `10`, backup ID `review-astra-837-r2`, mapper reset `1`, recovery args `--apply --heal brossard` and repair args `--apply brossard`. The migration render used prod namespace, suffix `-220c5c3` and the same digest. The pre-release backup used identical nonsecret fixture values for exactly its declared template variables. The generated daily-backup ConfigMap used identical script bytes, prod namespace, fixed name and all three workflow labels, including component `db-backup`. Runtime Secret values were not read. Existing sealed-file contents were not printed; no sealed file changes.

**Requested checks:**

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
test_exit=0

bash deploy/ci/reconcile-preprod-mcp.test.sh
# PATH contains the review-only Node filter adapter described above.
ok: Deployment absent: no immo-mcp-config diff/apply, no restart, rest reconciled
ok: present + ConfigMap unchanged: applied, no restart
ok: present + ConfigMap changed: applied, then radar-immo-mcp restarted
ok: Deployment lookup failure: script stops before any apply
ok: immo-mcp-config diff failure: stops before its apply
PASS=5 FAIL=0
test_exit=0

make k8s-validate ENV=review-astra-837-r2
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
make_exit=0
```

The first attempt at the Node adapter used an extensionless CommonJS entry point and failed in the review harness (`PASS=2 FAIL=3`). Giving that review-only entry point a `.cjs` suffix corrected it; the result above is the rerun. No repository implementation was changed to obtain it.

**Mutation results:** each mutation was applied to a separate archived-target fixture and exercised by the committed test. Every listed mutant exited 1.

| Mutation | Test output | Detected by |
| --- | --- | --- |
| Exact reconcile from round-1 target ddce2b4f | `PASS=2 FAIL=3` | changed config, lookup failure, diff failure |
| Delete restart | `PASS=4 FAIL=1` | changed-config case |
| Restart on diff 0 as well | `PASS=4 FAIL=1` | unchanged-config case |
| Add `|| true` to the lookup substitution | `PASS=4 FAIL=1` | lookup-failure case |
| Remove `--ignore-not-found` | `PASS=4 FAIL=1` | absent case |
| Disable the diff-error abort | `PASS=4 FAIL=1` | diff-failure case |
| Move restart before apply, unconditionally | `PASS=3 FAIL=2` | unchanged case and apply-before-restart assertion |
| Exempt only Ingress/radar from guard | `PASS=23 FAIL=2` | isolated UI host case and shared-patch case |
| Exempt only Ingress/radar-immo-mcp from guard | `PASS=22 FAIL=3` | isolated MCP rule host, TLS host and TLS Secret cases |

**Independent shell mocks:** the original archived-target reconcile script used a separate fake kubectl that recorded argv, consumed stdin, injected errors and retained successful MCP apply/restart state between the two retry runs. It delegated only offline kustomize to real kubectl. The actual workflow image-step block was extracted without altering its shell body and run against that same fake where indicated.

| Case | Reconcile exit | Observed calls/result |
| --- | --- | --- |
| Present, diff 0 | 0 | MCP apply, no restart; subsequent image step exit 0 |
| Present, diff 1, same image | 0 | MCP apply → restart → later set-image to `:same`; image step exit 0 |
| Present, diff 1, new image | 0 | MCP apply → restart → later set-image to `:new`; image step exit 0 |
| Successful empty lookup | 0 | no MCP diff/apply/restart; other durables applied |
| Forbidden lookup exit 7 | 7 | lookup only; visible Forbidden diagnostic; no `reconcile OK` |
| MCP diff exit 2 | 1 | earlier UI/API ConfigMaps applied; no MCP apply/restart; diagnostic names exit 2 |
| MCP diff exit 37 | 1 | same stop; diagnostic names exit 37 |
| MCP apply exit 19 | 19 | no restart or later durable applies; no `reconcile OK` |
| MCP filter exit 17 | 17 | stops at the MCP command substitution; no MCP-only diff/apply/restart |
| MCP restart exit 23 | 23 | desired MCP ConfigMap already applied; no successful restart; no later durable applies |
| Retried previous case, same image | 0 | diff 0, no restart, `reconcile OK`; subsequent image step exit 0 |
| MCP rollout-status exit 24 | 0 | image step emits optional-connector warning and exits 0 |

Selected exact outputs for the retained-state reproduction:

```text
restart-error: reconcile_exit=23
DIFF immo-mcp-config
APPLY immo-mcp-config
RESTART -n radar-immobilier-preprod rollout restart deploy/radar-immo-mcp
reconcile_OK=false
mock restart patch failed
mock_state={"applied":true,"restarted":0,"image":"same"}

retry-after-restart-error: reconcile_exit=0
retry-after-restart-error: workflow_roll_exit=0
DIFF immo-mcp-config
APPLY immo-mcp-config
APPLY radar-consistency-snapshot
APPLY radar-api
APPLY radar-ui
SET-IMAGE -n radar-immobilier-preprod set image deploy/radar-immo-mcp mcp=ghcr.io/rhanka/radar-api:same
ROLLOUT-STATUS -n radar-immobilier-preprod rollout status deploy/radar-immo-mcp --timeout=180s
reconcile_OK=true
mock_state={"applied":true,"restarted":0,"image":"same"}

rollout-timeout: reconcile_exit=0
rollout-timeout: workflow_roll_exit=0
::warning::radar-immo-mcp rollout not complete within 180s (optional connector, deploy continues)
```

The printed mock state records API effects, not actual pods or Kubernetes controller behavior. The unchanged-image implication follows from the workflow's literal set-image operation and the Deployment's environment-at-start contract.

**PR body and public probes:** `gh pr view 837 -R rhanka/radar-immobilier --json body --jq .body` exited 0. At `2026-10-09T10:28:01Z`, the following requests each exited 0:

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

Relevant response output:

```text
immo.sent-tech.ca POST /mcp
HTTP/2 401
content-type: application/json
www-authenticate: Bearer error="invalid_token", error_description="Authorization header is required.", resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"
{"error":{"code":"invalid_token","message":"Authorization header is required."}}

immo.sent-tech.ca GET /mcp/.well-known/oauth-protected-resource
HTTP/2 200
content-type: application/json
{"resource":"https://immo.sent-tech.ca/mcp","authorization_servers":["https://auth.sent-tech.ca"],"bearer_methods_supported":["header"],"dpop_signing_alg_values_supported":["EdDSA"],"scopes_supported":["immo:read","immo:search","immo:documents:read"]}

preprod.immo.sent-tech.ca POST /mcp
HTTP/2 405
content-type: text/html
server: nginx
HTML title: 405 Not Allowed

preprod.immo.sent-tech.ca GET /mcp/.well-known/oauth-protected-resource
HTTP/2 200
content-type: text/html
server: nginx
content-length: 673
HTML title: Radar immobilier; body contains <div id="app"></div>
```

These responses reproduce the pre-deployment symptom; they do not validate the reviewed target after deployment.

## Verdict

**GO-with-nits.** ASTRA-837-02 is resolved; ASTRA-837-01 is partially resolved, with one demonstrated non-blocking retry gap. No blocking regression was demonstrated in the normal reconcile/image path. Prod inputs and renders remain byte-identical, and the updated operator manifest matches the render. Auth-isolation and offline Kubernetes validation pass; the five-case reconcile test passes within the explicitly stated Node-filter substitution boundary. Live rollout, the original Python execution, hosted CI and authenticated connector acceptance remain unverified or not covered as specified above.
