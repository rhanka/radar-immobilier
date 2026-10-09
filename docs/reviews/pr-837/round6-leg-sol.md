status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@54fe14a3f5650479b75e08e0f20d248645ea364e
lens: guard-scripts-and-oauth-semantics (round 6)

## Reasoning

Reviewed `git diff origin/main...54fe14a3f5650479b75e08e0f20d248645ea364e` and the code delta from `a6732b7b29f4cb52c439bcf9c84643bcdca222f9`. Base is `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. I read my five earlier reviews and their five prompts. No review file whose name contains `astra` was read, and no peer was contacted. This is an independent leg, without a consensus claim.

Worktree HEAD was already `9cf7de23204b5d488bd8761a1d49fb10415b308f`, on `fix/mcp-preprod-expose`. Initial and final comparisons of the target against the worktree's execution inputs returned 0. Nevertheless, all required checks and mutations used an exact target archive under `.review-tmp-sol-r6/`, excluding review dossiers. Baseline production files were separately archived from the exact base. Every mutant changed only the scratch reconcile script, starting from the saved original, while the target test remained unchanged. Mutation diffs were inspected, no-op mutations were rejected, and all 24 mutants passed `bash -n` before execution. The original script was restored and compared before the final positive control.

Only this review file was modified by me outside scratch. `TMPDIR` confined nested test/filter temporaries to `.review-tmp-sol-r6/tmp`. A nonexistent scratch `KUBECONFIG`, `K8S_VALIDATE_WITH_CLUSTER=0`, and a wrapper accepting only real `kubectl kustomize` prevented cluster access. Reconcile runs installed their fake before that wrapper. No real kubeconfig, credentials, cluster operations, direct reviewer Python invocation, reviewer-written Python, network requests, commits, pushes, or GitHub writes were used. The requested reconcile suite invokes the repository's pre-existing `kfilter.py` through the production script. Scratch was deleted at completion.

The round-6 code delta is confined to `deploy/ci/reconcile-preprod-mcp.test.sh` (14 insertions, four deletions). Production reconcile, auth checker/tests, overlays, workflows and application source remain unchanged since the round-3 target. The test independently renders preprod with the same real kubectl, extracts the complete `immo-mcp-config` document, requires a nonempty expected document and a captured apply document, and compares them with `cmp -s` (`:119`–`:125`). The explicit value checks now include `RADAR_API_BASE_URL: http://radar-api:3000` (`:130`). The expected document comes from the render rather than the apply-side filter or mutated script.

All 24 round-5 mutants are rejected. In particular, the previous survivor, deleting `RADAR_API_BASE_URL` only between the 4b filter and apply, now returns `PASS=10 FAIL=1`, exit 1, with exactly the missing API-URL line in the document diff. The other ten named cases still pass. Additional omissions of the port and data-mode keys, neither explicitly enumerated by the new value assertions, also fail specifically at document comparison. This demonstrates that the new assertion covers the whole document rather than just the listed values. The unmodified target applies the full independently selected document and passes all 11 cases, both with the default awk and with BusyBox awk; no false failure was observed.

The document split uses POSIX awk constructs: anchored regular expressions, scalar assignments, string concatenation, `next`, `END`, and `printf "%s", doc`. It uses no multicharacter `RS`, GNU extensions, array-of-arrays, or implementation-specific functions. The literal `%s` format preserves percent signs in content. Each separator flushes the preceding selected document and resets all identification state; `END` flushes a selected final document. The canonical kustomize output has exact `---` separators and `kind: ConfigMap` before `metadata.name`, satisfying the selector's ordering assumption. An independent boundary-based selector and ten split controls confirmed identical bytes on the actual preprod render and a selected document alone, first, last, and in the middle with leading/trailing separators. Both mawk 1.3.4 and BusyBox 1.37.0 passed. Arbitrary YAML formatting and other awk implementations are not covered; this test consumes canonical kustomize output.

The existing strict fake retains exact persisting-apply arguments, escaped JSONPaths and nested merge-patch validation. Independent assertions against its captured traces reconfirm recovery: apply persists RV 101, rejected patch exits 23 and leaves annotation 100, unchanged same-image retry patches annotation 101, and a settled run makes no patch. Both read faults print their value before exiting 18/19, and the unmodified script stops before patch and later applies. The production assignments and apply/patch pipeline remain outside error-suppressing conditions, preserving their statuses through `set -euo pipefail`. The declared Role permits ConfigMap get/create/patch/update and Deployment get/patch (`11-ci-deployer-preprod-rbac.yaml:72`, `:110`). Installed grants, admission, server-side apply/resourceVersion behavior and actual pod health remain unverified. The fake's stable-RV assumption is not an API-server guarantee.

The auth suite again passes 25 cases. Instrumenting a scratch copy printed exactly one intended diagnostic for each isolated MCP-rule/UI-rule/MCP-TLS-host/MCP-TLS-secret mutation. OAuth semantics remain aligned: the MCP and API share the preprod issuer, and the preprod MCP resource is one of the API bearer audiences (`server-http.ts:173`; `api/src/config.ts:350`, `:370`). The source forwards the user's bearer (`data-source.ts:301`); `/mcp` Prefix routing covers transport and the appended metadata URL. The approved-account gate remains at `api/src/routes/auth.ts:649`. The two data-source factories still select mocks without `RADAR_API_BASE_URL` (`data-source.ts:354`, `raw-data.ts:782`), making the resolved omission material to runtime behavior.

SOL-837-02 remains resolved at the handoff level recorded by my round-2 review: explicit dedicated client ID, public PKCE, preprod resource/scopes, account approval, connector client ID/empty secret, and authenticated initialize/tools-list/search_signals acceptance. The registration builder's default without `OAUTH_CLIENT_ID` was re-read at `/home/antoinefa/src/sentropic/api/src/scripts/oauth-register-client.ts:89`. Current remote PR text and execution of those external steps are unverified; no GitHub or public endpoint was fetched this round. One replica with Recreate can interrupt service, and the existing workflow treats MCP rollout failure as a warning (`build-push-images.yml:826`). CD success alone does not establish healthy MCP pods. These unchanged limits are not newly demonstrated defects.

Production invariance was reconfirmed from the exact base and target archives: both production renders and the entire `deploy/k8s` tree are byte-identical, including raw 30/40/41/70 and refresh inputs. `k8s-apply-mcp.yaml` is identical. Removing full-line comments from `build-push-images.yml` yields identical bytes; its comment hunks are confined to `deploy-preprod`. The only `ci.yml` addition is the hermetic reconcile-test step and its separating blank line. Production apply inputs and production deployment-job behavior are invariant at this target. No remaining gap changing the shipped production behavior was demonstrated.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| SOL-837-01 | non-blocking | resolved | Auth test `:29`, `:107` retains object/field-specific reinjection and exactly-one-diagnostic assertions. Exact-target instrumented run printed the four intended isolated messages, `PASS=25 FAIL=0`, exit 0. |
| SOL-837-02 | non-blocking | resolved | `round2-leg-sol.md` records the checked PR-body corrections: dedicated `OAUTH_CLIENT_ID`, public PKCE/resource/scopes, account approval, connector settings and authenticated acceptance. Registration default `oauth-register-client.ts:89` and approval gate `auth.ts:649` were re-read. This resolves the missing instructions; current remote text and operational execution remain unverified. |
| SOL-837-R2-01 | non-blocking | resolved | Reconcile `:129`–`:138` applies before reading live RV and compares/patches the template annotation every invocation. Independent traces: rejected patch exits 23 with RV=101/annotation=100; same-image retry exits 0 and patches 101; third invocation makes no patch. Target recovery case passes. |
| SOL-837-R3-01 | non-blocking | resolved | Test `:36`, `:40`, `:59` checks exact JSONPaths/nested patch; `:53`–`:54` advances RV on changed apply; `:99`–`:101` checks ordering/current value; `:110`–`:113` covers first adoption. Pre-apply RV, root metadata and unescaped lookup mutants return `8/3`, `7/4`, `5/6` (PASS/FAIL), all exit 1. |
| SOL-837-R4-01 | non-blocking | resolved | Exact persisting apply at test `:44`, capture `:51`, full comparison `:119`–`:125`, and pinned values `:126`–`:131` reject omitted force-conflicts `2/9`, prod namespace argument `2/9`, and dropped issuer `10/1`, all exit 1. |
| SOL-837-R4-02 | non-blocking | resolved | Test `:36`–`:42`, `:136`–`:140` exercises each stdout-before-error GET independently. Both suppression mutants return `PASS=10 FAIL=1`, exit 1. Independent target traces exit exactly 18/19 before patch/later applies. |
| SOL-837-R5-01 | non-blocking | resolved | Complete document comparison at test `:125` plus explicit API URL at `:130`. The exact API-URL omission mutant now returns `PASS=10 FAIL=1`, exit 1, failing only the content comparison with the missing `RADAR_API_BASE_URL` line. Original and retry cases pass; independent original capture matches the complete render. |

## New findings

none. No new blocking or non-blocking finding was demonstrated.

## Commands and outputs

Commands ran through `rtk`; prefixes are omitted below for readability. `S` denotes `$PWD/.review-tmp-sol-r6`. Target archive inputs were `deploy`, `ui/nginx`, `.github/workflows`, `api/Dockerfile`, `api/src`, `packages/immo-mcp/src`, and `Makefile`. Base archive inputs were `deploy/k8s` and `.github/workflows`; no review dossier was archived. Required commands ran from `$S/target` with `TMPDIR="$S/tmp"`, `KUBECONFIG="$S/no-kubeconfig"`, the offline kubectl wrapper on PATH and `K8S_VALIDATE_WITH_CLUSTER=0`. No stack was started.

```text
$ git rev-parse HEAD origin/main
9cf7de23204b5d488bd8761a1d49fb10415b308f
641f48c31a89c9d7bc4f1bc06532728c29018cc8

$ git diff --exit-code 54fe14a3f5650479b75e08e0f20d248645ea364e -- deploy .github/workflows Makefile ui/nginx api/Dockerfile api/src packages/immo-mcp/src
(no output; initial and final comparisons)
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
ok: applied immo-mcp-config = the full rendered preprod document
ok: failed rv read: script stops before the patch and the later applies
ok: failed ann read: script stops before the patch and the later applies
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=11 FAIL=0
exit=0

$ make k8s-validate ENV=review-sol-837-r6
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

Each row below replays one round-5 mutant against the unchanged target test. All suite exits are 1; all 24 mutants are rejected. Each independently restores the original before applying its indicated edit.

| Reconcile mutation | Suite output | Exit |
| --- | --- | --- |
| Remove MCP apply `--force-conflicts` | `PASS=2 FAIL=9` | 1 |
| Add prod namespace argument to MCP apply | `PASS=2 FAIL=9` | 1 |
| Drop issuer from filtered MCP apply body | `PASS=10 FAIL=1` | 1 |
| Suppress ConfigMap-RV GET error | `PASS=10 FAIL=1` | 1 |
| Suppress template-annotation GET error | `PASS=10 FAIL=1` | 1 |
| Read RV before MCP apply | `PASS=8 FAIL=3` | 1 |
| Patch root metadata instead of template metadata | `PASS=7 FAIL=4` | 1 |
| Remove annotation JSONPath dot escape | `PASS=5 FAIL=6` | 1 |
| Delete template-annotation patch | `PASS=8 FAIL=3` | 1 |
| Invert annotation/RV inequality | `PASS=7 FAIL=4` | 1 |
| Delete empty-RV assertion | `PASS=10 FAIL=1` | 1 |
| Suppress initial Deployment lookup error | `PASS=10 FAIL=1` | 1 |
| Suppress template-patch error | `PASS=10 FAIL=1` | 1 |
| Skip patch when annotation is missing | `PASS=10 FAIL=1` | 1 |
| Read ConfigMap UID instead of RV | `PASS=3 FAIL=8` | 1 |
| Use JSON patch type with merge-patch object | `PASS=7 FAIL=4` | 1 |
| Add `--dry-run=server` to MCP apply | `PASS=2 FAIL=9` | 1 |
| Replace MCP apply field manager | `PASS=2 FAIL=9` | 1 |
| Change applied MCP manifest namespace to prod | `PASS=10 FAIL=1` | 1 |
| Drop applied MCP resource | `PASS=10 FAIL=1` | 1 |
| Drop applied MCP public URL | `PASS=10 FAIL=1` | 1 |
| Drop applied MCP advertised scopes | `PASS=10 FAIL=1` | 1 |
| Change applied MCP kind to Secret | `PASS=10 FAIL=1` | 1 |
| Drop applied `RADAR_API_BASE_URL` | `PASS=10 FAIL=1` | 1 |

```text
MUTANTS REJECTED=24/24
helper exit=0

API-URL omission's only failed case:
FAIL: applied immo-mcp-config differs from the render: 9d8|<   RADAR_API_BASE_URL: http://radar-api:3000

extra omission IMMO_MCP_DATA_MODE: exit=1 PASS=10 FAIL=1
FAIL: applied immo-mcp-config differs from the render: 3d2|<   IMMO_MCP_DATA_MODE: http
extra omission IMMO_MCP_HTTP_PORT: exit=1 PASS=10 FAIL=1
FAIL: applied immo-mcp-config differs from the render: 4d3|<   IMMO_MCP_HTTP_PORT: "8848"

final restored-original control: PASS=11 FAIL=0, exit=0
original archived reconcile cmp: exit=0
```

The previously surviving API-URL omission is the same insertion as round 5:

```bash
  kf "$RENDER" ConfigMap immo-mcp-config \
    | sed '/RADAR_API_BASE_URL:/d' \
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
```

The exact target split was extracted into a scratch awk file. An independent selector evaluates kind/name at each document boundary, then emits the selected original text. For both `mawk -f split.awk` and `busybox awk -f split.awk`, the actual preprod render and four position/separator controls compared byte-identically with that independent document:

```text
mawk preprod: exact document, exit=0
mawk split-only: exact document, exit=0
mawk split-first: exact document, exit=0
mawk split-last: exact document, exit=0
mawk split-middle: exact document, exit=0
busybox preprod: exact document, exit=0
busybox split-only: exact document, exit=0
busybox split-first: exact document, exit=0
busybox split-last: exact document, exit=0
busybox split-middle: exact document, exit=0
mawk 1.3.4 20260129
BusyBox v1.37.0 (Ubuntu 1:1.37.0-7ubuntu1)
SPLIT CONTROLS PASS=10 FAIL=0
helper exit=0
```

A scratch PATH wrapper running `/usr/bin/busybox awk "$@"` also ran the full unmodified reconcile suite: the same 11 successful messages, `PASS=11 FAIL=0`, exit 0. Independent recovery/failure assertions reused the exact target fake with separate call/state files; unrelated early applies are abbreviated below:

```text
patch-rejected: exit=23 rv=101 ann=<100>
… | apply immo-mcp-config | read rv | read ann | patch-failed
same-image-retry: exit=0 rv=101 ann=<101>
… | apply immo-mcp-config | read rv | read ann | patch rv=101 | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
settled: exit=0 rv=101 ann=<101>
… | apply immo-mcp-config | read rv | read ann | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
readfail-rv: exit=18 rv=101 ann=<100>
… | apply immo-mcp-config | read rv
readfail-ann: exit=19 rv=101 ann=<100>
… | apply immo-mcp-config | read rv | read ann
INDEPENDENT CONTROLS PASS=5 FAIL=0; captured MCP = full independent render
helper exit=0
```

Auth instrumentation printed the following isolated diagnostics and `PASS=25 FAIL=0`, exit 0:

```text
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls
```

Production comparisons used `kubectl kustomize <archive>/deploy/k8s` and `kubectl kustomize --load-restrictor LoadRestrictionsNone <archive>/deploy/k8s/refresh-cronjobs-prod`, followed by `cmp`/`diff -qr`. Each comparison returned 0:

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
production reconcile, auth checker/tests, overlay, application source and workflows: unchanged since round 3
selected target diff whitespace: exit=0
```

Workflow comment comparison used `sed '/^[[:space:]]*#/d'`. The only executable workflow addition is:

```yaml
      - name: Validate preprod reconcile immo-mcp branch (hermetic, fake kubectl)
        run: bash deploy/ci/reconcile-preprod-mcp.test.sh
```

Header lines 2–6 were preserved from the dispatched stub; only status changed. Review whitespace, header preservation, and scratch-removal checks completed with exit 0.

## Verdict

**GO.** All seven earlier findings are resolved at the evidence levels stated above. All 24 round-5 mutants, including the former API-URL survivor, are rejected; required checks and awk controls pass without an observed false failure. Production invariance is reconfirmed. No new finding remains demonstrated. Live server/RV behavior, grants/admission/pod health, operator installation and authenticated preprod acceptance remain unverified; this code-review verdict does not establish deployed acceptance.
