status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@0bf90556735e05d503f5c31700c6b61283deb2d9
lens: guard-scripts-and-oauth-semantics (round 4)

## Reasoning

Reviewed `git diff origin/main...0bf90556735e05d503f5c31700c6b61283deb2d9` and the code delta from `bc89161a8ddd4b49e87b1a05c46c381e52f5de40`. Base is `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. I read my three earlier reviews and their three prompts. No review file whose name contains `astra` was read; no peer was contacted. This is one independent leg and does not establish consensus.

The branch was `fix/mcp-preprod-expose`; worktree HEAD was already `2c6655e54ac9d74f4ce037c45a66e6c85223c83e`. A comparison against the requested target returned exit 0 for all execution inputs (`deploy`, workflows, Makefile, `ui/nginx`, API Dockerfile/source and MCP source). The required commands ran against those target-identical worktree inputs. Baseline and exact-target files were also extracted with `git archive` under `.review-tmp-sol-r4/`, excluding review dossiers. All mutants used that exact target archive, restored between independent cases; the original eight-case suite was not edited. Its final unmodified archive execution returned `PASS=8 FAIL=0`. An end-of-review comparison found that the worktree's reconcile test had changed during this leg (`cmp` exit 1, first difference at line 40). That later version is outside this target; the mutant results and final positive control remain pinned to the exact target archive.

All temporary files, including nested `mktemp` files, were confined to `.review-tmp-sol-r4/` through `TMPDIR`. A nonexistent scratch `KUBECONFIG`, `K8S_VALIDATE_WITH_CLUSTER=0`, and a wrapper allowing only offline `kustomize`, `version --client`, and `patch`/`set` with `--local` prevented real cluster operations. The reconcile tests installed their fake ahead of that wrapper. No real kubeconfig, credentials, cluster access, direct reviewer Python invocation, reviewer-written Python, commits, pushes, or GitHub writes were used. The requested reconcile test invokes the repository's existing `kfilter.py` through the production script. Only this review file was modified outside scratch; scratch was deleted at completion.

**Round-4 scope and the strict fake.** The only code change since round 3 is `reconcile-preprod-mcp.test.sh`. The production 4b block, auth checker, auth tests, overlay and workflows are unchanged since the reviewed round-3 target. The fake now checks the exact ConfigMap and template JSONPath expressions (`:35`, `:37`) and the complete nested merge-patch shape (`:49`). Incorrect reads and patch nesting are rejected. A changed MCP apply advances the fake RV (`:44`), and the changed case asserts apply before RV read before patch (`:87`). The settled run and first adoption with an empty template annotation are exercised explicitly (`:93`, `:99`). The current target has no observed false failure: both the target-identical worktree run and the restored exact-target archive run passed all eight cases.

All nine round-3 code mutants are now rejected, including the three previously surviving regressions: RV read before apply, root-metadata patch, and unescaped annotation JSONPath. Eight additional mutants confined to 4b were tested: three fail and five survive. The survivors concern unchecked apply arguments/body and unexercised GET errors, rather than style or semantically equivalent formatting; see the two new non-blocking findings. The fake is strict at the newly fixed reads/patch, but its apply and diff branches still use wildcard patterns. Matching `$*` also does not validate argv boundaries as separate arguments. This is a bounded protocol test, not an API-server emulator.

**Recovery and failure propagation.** An adapted, independently asserted three-run reproduction advanced RV `100 -> 101` during apply, rejected the patch with exit 23, then retried without an image change or further ConfigMap change. Run 1 retained annotation `100` and stopped before later applies; run 2 patched annotation `101`; run 3 performed no patch. Extra fault injections returned exits 24/18/19 for MCP apply/ConfigMap GET/template GET, respectively, without reaching the subsequent CronJob apply. Both GET faults deliberately emitted their state value before returning an error: the unmodified target preserved that error, whereas the corresponding `|| true` mutants continued successfully. No actual server failure or pod rollout was observed.

The production assignments and apply/patch pipelines remain outside error-suppressing conditionals/OR lists, so their statuses reach `set -euo pipefail`. Empty RV is separately rejected at `reconcile-preprod.sh:132`; an absent annotation is successful empty output and triggers first adoption. The declared preprod Role still permits ConfigMap get/create/patch/update and Deployment get/patch (`11-ci-deployer-preprod-rbac.yaml:72`, `:110`); installed grants/admission are unverified.

**Actual offline kubectl controls.** Local Deployment JSON confirmed that the exact escaped JSONPath reads `101`, its unescaped mutant reads empty, and an absent annotations map reads empty with exit 0. The target's nested merge patch creates the missing annotation and preserves unrelated annotations; a root-metadata patch leaves template RV unchanged. Same-image local set-image emits no changed object; different-image local set-image preserves the RV annotation. These controls use kubectl v1.35.3 and kustomize v5.7.1 without a server.

**Runtime limits retained from round 3.** Stability of resourceVersion on a true no-op SSA remains unverified. No permitted source establishing that guarantee was available, and Kubernetes documentation is outside the four allowed HTTPS hosts. The fake models stable RV on unchanged apply; it does not prove server storage/managed-fields behavior. Recreate with one replica can interrupt MCP availability; the following set-image can introduce another template generation. The existing workflow still warns rather than fails on MCP rollout timeout (`build-push-images.yml:826`). Consequently a successful CD or annotation patch does not establish healthy MCP pods. These are unchanged limits, not new demonstrated production regressions.

**Auth/OAuth lens.** Re-instrumenting the four isolated Ingress cases again yielded exactly one intended diagnostic per case and `PASS=25 FAIL=0`. The POSIX awk and its pinned values are unchanged; this round used the default awk and did not repeat the round-1 BusyBox campaign. The preprod issuer remains aligned between MCP and API; the resource remains in the API bearer audiences (`api/src/config.ts:350`, `:370`; `server-http.ts:173`; bearer forwarding at `data-source.ts:301`). `/mcp` Prefix covers transport and the appended PRM route. The approved-account gate remains at `auth.ts:649`. SOL-837-02 remains resolved at the documented handoff level established by my round-2 review: explicit dedicated client ID, public PKCE, account approval, connector settings and authenticated acceptance. The local registration builder still defaults to `design-system` without `OAUTH_CLIENT_ID` (`oauth-register-client.ts:89`). The current remote PR body was not fetched because GitHub is outside this round's allowed network hosts. Actual registration, grants, account approval and authenticated acceptance remain unverified.

Public probes were repeated only on the four allowed hosts. Prod discovery/challenge is correct; preprod still serves UI HTML at PRM and POST `/mcp`. This does not establish post-install acceptance. Both IdP discovery documents omit `immo:*` from advertised scopes; actual per-client allowed/granted scopes remain unverified. The CI step remains after checkout and kubectl installation on `ubuntu-latest` (`ci.yml:15`, `:30`, `:45`); actual hosted-runner/full-CI execution is unverified.

**Production invariance.** Both prod renders and the entire `deploy/k8s` tree compare byte-identically to origin/main, including raw 30/40/41/70 and refresh inputs. `k8s-apply-mcp.yaml` is identical. Stripping full-line comments from `build-push-images.yml` yields identical bytes; its comment hunks are confined to `deploy-preprod`. The `ci.yml` diff adds exactly the hermetic reconcile test step and separating blank line. Production inputs and production deployment-job behavior are invariant at the requested target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| SOL-837-01 | non-blocking | resolved | Target auth test `:29`, `:107` isolates each object/field and requires one diagnostic. Re-instrumented exact-target suite: four intended single diagnostics, `PASS=25 FAIL=0`, exit 0. |
| SOL-837-02 | non-blocking | resolved | My round-2 review records the corrected PR-body instructions: dedicated `OAUTH_CLIENT_ID`, public PKCE/resource/scopes, approved radar account, client ID/empty secret in connector settings and authenticated initialize/tools-list/search_signals acceptance. Relevant registration default and approval gate re-read this round. This resolves the missing handoff; its current remote text and operational execution are unverified. |
| SOL-837-R2-01 | non-blocking | resolved | `reconcile-preprod.sh:129` applies before reading RV and compares against template annotation on every run. Reproduced rejected patch after persisted CM: exit 23, RV=101/annotation=100; unchanged same-image retry: exit 0, annotation=101; third run: exit 0/no patch. Supplied recovery case passes. |
| SOL-837-R3-01 | non-blocking | resolved | Exact JSONPath and nested payload checks at test `:35`, `:37`, `:49`; apply changes RV at `:44`; ordering/current value assertion at `:87`; first adoption at `:99`. All three previously surviving mutants now fail: pre-apply RV `5/3`, root metadata `4/4`, unescaped lookup `3/5` (PASS/FAIL), exits 1. All nine original mutants fail; unmodified eight-case suite and recovery case pass. The specific round-3 acceptance criteria are met; separate apply/error blind spots are recorded below. |

## New findings

### SOL-837-R4-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/reconcile-preprod-mcp.test.sh:40`, `:41`, `:44`.
- **Evidence:** The fake accepts any argument string containing `apply --server-side`, then derives only object names from stdin. Three independent 4b mutants each returned `PASS=8 FAIL=0`, exit 0: remove MCP `--force-conflicts`; add `-n radar-immobilier` to its apply; delete `IMMO_MCP_OAUTH_ISSUER` from only the filtered MCP apply body. A capture of the last mutant's actual stdin confirmed a ConfigMap named `immo-mcp-config` with the issuer omitted. The earlier auth guard sees the intact render, so it also passes. A separate capture confirmed the namespace mutant sends `-n radar-immobilier` with manifest namespace `radar-immobilier-preprod`. These are behavior changes: wrong destination arguments and omitted issuer would not satisfy the intended preprod apply, and removing conflict forcing changes handling of other field owners. The fake still advances RV and declares successful rollout in those scenarios. Exact server conflict/namespace responses and live field owners are unverified. The unmodified target applies the correct pinned ConfigMap and flags; no current production-code defect is established.
- **Fix:** Validate MCP apply arguments, including field manager, conflict forcing and stdin source; reject an explicit incompatible namespace. Inspect the applied MCP document's kind/name/namespace and required issuer/resource/public URL, or compare its bytes with the MCP document from the guarded render. Add acceptance that these three mutants fail while the original eight cases pass. No live cluster is needed.

### SOL-837-R4-02

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/reconcile-preprod-mcp.test.sh:35`, `:37`.
- **Evidence:** Both fake GETs always succeed via `cat`; the eight cases exercise lookup failure and empty RV but no error from either later GET. Independent mutants adding `|| true` inside the ConfigMap-RV or template-annotation command substitution each returned `PASS=8 FAIL=0`, exit 0. With the respective fake GET printing its value and then returning 18 or 19, the original target exits with that status before later applies, while the matching mutant returns 0 and applies the later CronJob/API/UI. Extra assertions therefore reject each mutant (helper exit 84). This demonstrates lost failure propagation under the stated mock condition; it is not an observed Kubernetes incident or a defect in the current target.
- **Fix:** Add independent ConfigMap-GET and annotation-GET error cases, including stdout-before-error, and require failure before patch/later applies. Keep successful empty annotation distinct from failed annotation lookup. Acceptance: both suppression mutants fail and the unmodified target passes.

## Commands and outputs

Commands ran through `rtk`; prefixes are omitted below. `S` denotes `$PWD/.review-tmp-sol-r4`. Tests set `TMPDIR="$S/tmp"`, a nonexistent scratch `KUBECONFIG`, the offline wrapper on PATH, and `K8S_VALIDATE_WITH_CLUSTER=0`. Mutations were made only to the archived reconcile and restored between runs. Diff inspection confirmed every mutant changed its intended lines; each passed `bash -n`. The original target test bytes remained unchanged.

```text
$ git rev-parse HEAD origin/main
2c6655e54ac9d74f4ce037c45a66e6c85223c83e
641f48c31a89c9d7bc4f1bc06532728c29018cc8

$ git diff --exit-code 0bf90556735e05d503f5c31700c6b61283deb2d9 -- deploy .github/workflows Makefile ui/nginx api/Dockerfile api/src packages/immo-mcp/src
(no output)
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
ok: unchanged ConfigMap, annotation current: applied, no roll
ok: ConfigMap changed by the apply: version read after it, pod template annotated
ok: settled re-run after a roll: no further patch
ok: present Deployment without the annotation: pod template annotated
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=8 FAIL=0
exit=0

$ make k8s-validate ENV=review-sol-837-r4
[k8s-validate] rendering deploy/k8s with kustomize…
[k8s-validate] structural check (every doc has apiVersion + kind)…
[document-date-recovery] offline render ok (preprod + prod)
[k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
image entrypoint check: ok (24 reference(s) in 93 file(s), 17 entrypoint(s))
[k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
exit=0

$ bash deploy/ci/check-preprod-auth-isolation.sh
preprod auth isolation: ok (/home/antoinefa/src/radar-immobilier/tmp/mcp-preprod-expose/deploy/overlays/preprod — no PROD auth value or routing host; 8 preprod keys pinned in radar-api + immo-mcp-config)
exit=0

$ bash -n deploy/ci/reconcile-preprod.sh deploy/ci/reconcile-preprod-mcp.test.sh deploy/ci/check-preprod-auth-isolation.sh deploy/ci/check-preprod-auth-isolation.test.sh
(no output)
exit=0
```

The restored exact-target archive's unchanged reconcile suite repeated the same eight successful messages and `PASS=8 FAIL=0`, exit 0. No false failure was observed on the unmodified target.

Each mutation below starts from the exact original reconcile and runs the unchanged target test. “Rejected” means suite exit 1; “survived” means suite exit 0. All 17 mutants are syntactically valid. Twelve are rejected, five survive.

| Origin | Scratch reconcile mutation | Suite output | Exit | Result |
| --- | --- | --- | --- | --- |
| Round 3 | Delete template-annotation patch | `PASS=5 FAIL=3` | 1 | rejected |
| Round 3 | Invert annotation/RV inequality | `PASS=4 FAIL=4` | 1 | rejected |
| Round 3 | Delete empty-RV assertion | `PASS=7 FAIL=1` | 1 | rejected |
| Round 3 | Suppress initial Deployment lookup error | `PASS=7 FAIL=1` | 1 | rejected |
| Round 3 | Suppress template-patch error | `PASS=7 FAIL=1` | 1 | rejected |
| Round 3 | Read RV before MCP apply | `PASS=5 FAIL=3` | 1 | rejected |
| Round 3 | Patch root metadata instead of template metadata | `PASS=4 FAIL=4` | 1 | rejected |
| Round 3 | Remove annotation JSONPath dot escape | `PASS=3 FAIL=5` | 1 | rejected |
| Round 3 | Substitute exact round-2 reconcile | `PASS=2 FAIL=6` | 1 | rejected |
| New, 4b | Skip patch when annotation is missing | `PASS=7 FAIL=1` | 1 | rejected |
| New, 4b | Read ConfigMap UID instead of resourceVersion | `PASS=2 FAIL=6` | 1 | rejected |
| New, 4b | Use JSON patch type with merge-patch object | `PASS=4 FAIL=4` | 1 | rejected |
| New, 4b | Remove MCP apply `--force-conflicts` | `PASS=8 FAIL=0` | 0 | survived |
| New, 4b | Add prod namespace to MCP apply arguments | `PASS=8 FAIL=0` | 0 | survived |
| New, 4b | Drop issuer from filtered MCP apply body | `PASS=8 FAIL=0` | 0 | survived |
| New, 4b | Suppress ConfigMap-RV GET error | `PASS=8 FAIL=0` | 0 | survived |
| New, 4b | Suppress template-annotation GET error | `PASS=8 FAIL=0` | 0 | survived |

Representative exact surviving mutations:

```bash
# At production line 130, replace the apply command with:
    | kubectl -n radar-immobilier apply --server-side --field-manager="$FM" --force-conflicts -f -
# Or insert between production lines 129 and 130:
    | sed '/IMMO_MCP_OAUTH_ISSUER:/d' \
# At production line 131, suppress the GET status:
  mcp_cm_rv="$(kubectl -n "$NAMESPACE" get configmap immo-mcp-config -o jsonpath='{.metadata.resourceVersion}' || true)"
```

The independent extra harness retained the target fake's exact read/patch validation, captured actual MCP apply stdin/arguments, and added apply/GET failure switches. With unrelated applies abbreviated, the unmodified target produced:

```text
patch-rejected: exit=23 rv=101 ann=100
… | apply immo-mcp-config | read rv | read ann | patch-failed
same-image-retry: exit=0 rv=101 ann=101
… | apply immo-mcp-config | read rv | read ann | patch rv=101 | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
settled: exit=0
… | apply immo-mcp-config | read rv | read ann | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
apply-error: exit=24; trace ends at apply immo-mcp-config
cmget-error: exit=18; trace ends at read rv
annget-error: exit=19; trace ends at read ann
EXTRA target checks: PASS=6 FAIL=0
helper exit=0

ConfigMap-GET suppression mutant + cmget fault: child exit=0; later applies occur; helper exit=84
Annotation-GET suppression mutant + annget fault: child exit=0; later applies occur; helper exit=84
```

The issuer-drop capture contained `kind: ConfigMap`, `name: immo-mcp-config`, the preprod resource/public URL and other MCP data, but no `IMMO_MCP_OAUTH_ISSUER`. The namespace capture was:

```text
args: -n radar-immobilier apply --server-side --field-manager=cd-preprod --force-conflicts -f -
manifest: namespace: radar-immobilier-preprod
```

Local client controls used `kubectl patch --local -f "$S/deployment.json" --type merge -p … -o …` and `kubectl set image --local`. Every command returned 0; helper exit 0:

```text
escaped JSONPath: <101>; unescaped control: <>
missing annotations map: <>, exit=0
nested merge patch creates first annotation: <102>
unrelated annotation: <kept>
root-metadata patch control leaves template RV: <101>
same-image set-image: no changed object
new-image set-image retains template RV: <102>
Client Version: v1.35.3
Kustomize Version: v5.7.1
LOCAL controls: PASS
```

Auth-suite instrumentation printed exactly these isolated diagnostics, with `PASS=25 FAIL=0`, exit 0:

```text
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls
```

Public probes used `curl --proto '=https' --max-time 20 -sS`, without credentials or redirect following. GETs were limited to the two IdP `/.well-known/oauth-authorization-server` endpoints and the two app `/mcp/.well-known/oauth-protected-resource` endpoints; POSTs were limited to app `/mcp` with JSON `{}`. All six curls returned 0. Response Date headers ranged from `Fri, 09 Oct 2026 15:16:10 GMT` to `15:16:26 GMT`.

| Public endpoint | Observed output |
| --- | --- |
| Prod IdP metadata | HTTP/2 200 JSON; canonical prod issuer, S256, authorization-code, token auth includes `none`; no registration endpoint |
| Preprod IdP metadata | HTTP/2 200 JSON; canonical preprod issuer, same capabilities; no registration endpoint |
| Prod GET PRM | HTTP/2 200 JSON; prod resource/issuer and three `immo:*` scopes |
| Prod POST `/mcp` | HTTP/2 401 JSON; `resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"` |
| Preprod GET PRM | HTTP/2 200 HTML; SPA title `Radar immobilier` |
| Preprod POST `/mcp` | HTTP/2 405 HTML; nginx, `405 Not Allowed` |

Production comparisons used the exact base/target archives, `kubectl kustomize` on `deploy/k8s`, and `kubectl kustomize --load-restrictor LoadRestrictionsNone` on `refresh-cronjobs-prod`. Each reported comparison returned 0:

```text
prod base render: byte-identical
prod refresh render: byte-identical
entire deploy/k8s tree: byte-identical
30-api.yaml: byte-identical
40-immo-mcp-http-deploy.yaml: byte-identical
41-immo-mcp-ingress.yaml: byte-identical
70-networkpolicy.yaml: byte-identical
k8s-apply-mcp.yaml: byte-identical
build-push-images.yml without full-line comments: byte-identical
git diff --check origin/main...<target>: exit=0
```

The comment comparison used `sed '/^[[:space:]]*#/d'`. The only executable workflow addition is:

```yaml
      - name: Validate preprod reconcile immo-mcp branch (hermetic, fake kubectl)
        run: bash deploy/ci/reconcile-preprod-mcp.test.sh
```

## Verdict

**GO-with-nits.** All four earlier findings are resolved at the evidence levels stated above; all nine round-3 mutants are rejected. Required checks pass and production invariance is reconfirmed. Two additional non-blocking test-coverage gaps remain demonstrated by five surviving new mutants. No blocking production-code regression was demonstrated. No-op SSA/RV behavior, installed grants/admission, controller/pod health, current remote handoff text, operator installation and authenticated preprod acceptance remain unverified.
