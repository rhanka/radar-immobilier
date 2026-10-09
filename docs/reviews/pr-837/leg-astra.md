status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@61df07ae40f69afe50f141b3f4465058265b8040
lens: no-python delta (round 7, single leg)

## Reasoning

Reviewed only `6448a90d..61df07ae40f69afe50f141b3f4465058265b8040`: two files, 38 insertions and 5 deletions. The additional comparison with `origin/main...61df07ae40f69afe50f141b3f4465058265b8040` addresses the requested Python-invocation audit. At review time, `origin/main` and the merge base both resolved to `b6d0a5da5a97f9551fa8f3bffe58b27246f20712`; HEAD was `c74b5b01937c0dbe86e913bba659aea1240ae5ab`. The working deploy files, workflows, Makefile and UI nginx inputs matched the requested target. Mutations used copies of an exact-target archive.

Read the round-1 Astra prompt, Astra rounds 1–6, repository rules and harness review guidance. No review file whose name contains `sol` was read; no peer was contacted. No network, cluster access, real kubeconfig, Python interpreter, commit, push or GitHub write was used. Real kubectl was restricted to offline `kustomize`, with `KUBECONFIG=/dev/null`. Temporary files and subprocess `TMPDIR` were confined to `.review-tmp-astra-r7/`, removed at completion. This report is the only retained modification. Earlier rounds' broader production/live checks were not repeated or treated as new evidence for this delta.

**Execution boundary.** To run the requested reconcile test without executing Python, a temporary `python3` PATH adapter accepted only `deploy/ci/kfilter.py` and executed a Node translation of its inspected logic. The test's new shim remained unchanged: its `command -v python3` selected that adapter, and its `exec "$REAL_PYTHON3" "$@"` delegated to it. Thus the actual target test, new shim, reconcile, `mcp_cm`, auth gate, header gate and offline render ran; original Python execution is **not covered**. The same boundary applies to mutations. This does not substitute for or suppress the new shim's call logging or `clean` assertion.

**No added operational Python calls.** The PR's added operational lines mentioning `python3`, `kfilter` or `kf` are confined to the test shim, its setup/comments and its log assertion. No new Python file or deployment/CI Python invocation was found outside that shim. Review prose was excluded from the operational diff scan; the added review runner was separately checked and contains no such reference. `deploy/ci/kfilter.py` is byte-identical to `origin/main`. The complete ordered set of `kf` definition/call lines is also byte-identical: one existing Python-backed definition and ten calls, two each for the nginx ConfigMap prefix, ConfigMap `radar-api`, Deployments `radar-api`/`radar-ui`, and CronJob `radar-consistency-snapshot`. No remaining `kf` call selects `immo-mcp-config`. This is the requested delta assessment, not a claim that the repository contains zero Python.

**Selection and output (`reconcile-preprod.sh:81`–95).** The program splits canonical kustomize documents at top-level `---` lines, requires top-level `kind: ConfigMap`, then searches for an exactly two-space-indented `name: immo-mcp-config` only inside the top-level `metadata` block. The block stops at the next unindented field. A nested kind, another kind with that name, `data.name` before or after metadata, nested label names and name suffixes were rejected. Zero and two matches each returned exit 1, the correct count on stderr and zero stdout; selection is completed before output begins.

The current ConfigMap output is 647 bytes and equals both a separate, metadata-scoped awk extraction of the current render and a Node transcription of the old filter's logic. Reading `kfilter.py:34`–70 establishes why: the delimiter regex is the same; the current document's first two-space `name` is its metadata name; both implementations strip only surrounding newline characters and append one newline. The new filter deliberately differs for zero/duplicate matches and metadata decoys. It is a canonical-render selector, not a general YAML parser. First/middle/last placement, separator whitespace, missing final newline and surrounding blank lines also produced the expected bytes.

**Quoting and error propagation.** The JavaScript inside the Bash single quotes contains no apostrophe; double-quoted JavaScript strings and regex backslashes reach Node unchanged. `"$RENDER"` remains one argument and is read as `process.argv[1]`. Running the extracted, unchanged function with spaces, dollar signs, backticks and a semicolon in the filename succeeded; apostrophes and shell metacharacters in document data were preserved.

At line 129, `targeted | kubectl diff ... || true` is intentionally diagnostic. Bash disables errexit in this conditional context, including inside `targeted`; later successful `kf` calls can also determine that function's final status. A failure of only the diff-side `mcp_cm` therefore does not stop the release. This behavior was reproduced, followed by a successful independent apply-side extraction. At lines 149–151, the apply pipeline is an ordinary command in the `if` body, with `set -euo pipefail` active. An injected filter exit 37 stopped reconcile with exit 37 even though the downstream mock consumed empty input and returned 0. Zero/two selections, missing Node and an apply error also stopped before the MCP version reads and all later applies. Earlier nginx/API ConfigMap applies can already have succeeded; this is not transactional.

**Runner availability.** Both jobs use GitHub-hosted `ubuntu-latest` (`build-push-images.yml:565`, `ci.yml:15`), whose standard image includes Node on PATH. Neither job declares a container or replaces PATH. `ci.yml:28` already runs a native Node selftest before the new reconcile test at line 49. The filter needs only built-in `fs` and ordinary CommonJS/JavaScript features; no package installation or repository module resolution is needed. Local execution used Node `v22.22.1`. The exact hosted runner image/version and hosted job execution are **unverified** under the no-network constraint; no CI-run result is claimed.

**Regression guard (`reconcile-preprod-mcp.test.sh:67`–95).** Reintroducing the old Python-backed call at either call site, at both sites, or directly as `python3 deploy/ci/kfilter.py ... immo-mcp-config` at apply made the target suite exit 1 with `PASS=3 FAIL=8`. Failure output contained the shim's recorded MCP Python invocation. As a control, removing only the new Python pattern from `clean` made the both-sites mutant return `PASS=11 FAIL=0`: rejection comes from the new guard, not unrelated payload/rollout differences. The unmodified target returns `PASS=11 FAIL=0`.

The shim logs before delegation, quotes the executable and argv, and uses `exec`, preserving delegated stdout, stderr and status. Direct execution of its exact body with an injected failing delegate preserved exit 37 and its diagnostic; a missing delegate produced exit 127 and `python3 not installed`. Injecting legacy-filter failure through the complete suite returned `PASS=4 FAIL=7`, exit 1. Its existing read/patch failure cases also pass with the new shim present. The guard's coverage is **partial**, not a general prohibition on all possible Python entry points: it observes PATH-resolved `python3` calls whose arguments contain the ConfigMap name, and `clean` is not asserted on the lookup-error run or the first failed-patch run. No additional defect in the scoped implementation was demonstrated from those unchanged assertion limits.

## Findings

none

## Commands and outputs

Commands used `rtk`; the prefix and output-capture wrappers are omitted below. Review helpers were disposable Bash/Node/awk files under `.review-tmp-astra-r7/`.

```text
git rev-parse HEAD origin/main
c74b5b01937c0dbe86e913bba659aea1240ae5ab
b6d0a5da5a97f9551fa8f3bffe58b27246f20712
git merge-base origin/main 61df07ae40f69afe50f141b3f4465058265b8040
b6d0a5da5a97f9551fa8f3bffe58b27246f20712
git diff --quiet 61df07ae40f69afe50f141b3f4465058265b8040 -- deploy .github/workflows ui/nginx Makefile
exit 0
git diff --numstat 6448a90d 61df07ae40f69afe50f141b3f4465058265b8040
15  3  deploy/ci/reconcile-preprod-mcp.test.sh
23  2  deploy/ci/reconcile-preprod.sh
git diff --exit-code origin/main 61df07ae40f69afe50f141b3f4465058265b8040 -- deploy/ci/kfilter.py
exit 0
```

The operational audit used `git diff --no-ext-diff --unified=0 origin/main...61df07ae40f69afe50f141b3f4465058265b8040 -- . ':(exclude)docs/reviews/**'`, checking added lines for `python3`, `kfilter` and `kf`. All hits were in the test shim/setup/comments/assertion. Comparing `sed -n '/^[[:space:]]*kf[ (]/p'` output from the origin/main script and target script with `diff -u` returned exit 0 (one definition, ten calls). The separate review-runner reference search returned exit 1, no matches.

```text
bash -n deploy/ci/reconcile-preprod.sh
(no output)
exit 0

bash deploy/ci/reconcile-preprod-mcp.test.sh
# Temporary Node delegate for legacy kfilter calls; target test/shim unchanged.
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
```

Filter checks used `kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod`, a separate line-oriented awk extractor tracking top-level metadata, the Node transcription of `kfilter.py`, and the exact `mcp_cm` function extracted into a Bash script with `set -euo pipefail`. `node .review-tmp-astra-r7/filter-checks.cjs` exited 0:

```text
current render = independent awk = legacy-logic Node reference: exit=0, bytes=647
single / first / middle / last / separator whitespace / no final newline / surrounding blank lines:
  each exit=0, bytes=647, exact expected output
apostrophes and shell metacharacters in data: exit=0, bytes=707, exact expected output
empty / same-name Service / nested kind / data.name before or after metadata / nested label name / name suffix:
  each exit=1, bytes=0, stderr=mcp_cm: expected 1 immo-mcp-config ConfigMap, got 0
two matching documents: exit=1, bytes=0, stderr=mcp_cm: expected 1 immo-mcp-config ConfigMap, got 2
metadata name wins over preceding data.name: exit=0, bytes=661, exact expected output
```

`node .review-tmp-astra-r7/mutation-checks.cjs` exited 0. Each mutation used a separate target copy; Bash syntax passed before running the suite. The first four rows change only reconcile. The control additionally changes the copied test's `clean` pattern.

| Mutation/check | Suite exit | Output |
| --- | --- | --- |
| Restore `kf "$RENDER" ConfigMap immo-mcp-config` in diagnostic diff only | 1 | `PASS=3 FAIL=8` |
| Restore it in apply only | 1 | `PASS=3 FAIL=8` |
| Restore it at both sites | 1 | `PASS=3 FAIL=8` |
| Direct `python3 deploy/ci/kfilter.py` invocation at apply | 1 | `PASS=3 FAIL=8` |
| Both restored calls, remove only Python clause from `clean` | 0 | `PASS=11 FAIL=0` |
| Unchanged target, delegated legacy filter returns 37 | 1 | `PASS=4 FAIL=7` |

The exact extracted test shim additionally returned exit 37 with the delegate's diagnostic unchanged, and exit 127 with `python3 not installed` for an empty delegate path; both calls were logged.

`node .review-tmp-astra-r7/pipeline-checks.cjs` ran the unchanged full reconcile with independent kubectl/Node wrappers. Kubectl operations were mocked; render input was the saved real render. Node fault injection acted only on `mcp_cm`, after the auth gate, to exercise both call sites. The mock deliberately accepted empty apply input, so a failed upstream filter could not rely on downstream failure. Final helper exit: 0.

| Injection | Reconcile exit | MCP version read / later CronJob and Deployment applies | `reconcile OK` |
| --- | --- | --- | --- |
| None | 0 | Executed | Present |
| Filter exit 37 at first (diff) call only | 0 | Executed after successful second extraction | Present |
| Filter exit 37 at second (apply) call only | 37 | Not executed | Absent |
| Zero matches at both calls | 1 | Not executed | Absent |
| Two matches at both calls | 1 | Not executed | Absent |
| Missing Node, exit 127 | 127 | Not executed | Absent |
| MCP kubectl apply exit 19 | 19 | Not executed | Absent |

Zero/two-match runs each printed the correct selection diagnostic twice; the diff-side failure was tolerated and the apply-side failure stopped reconciliation. The initial review-only pipeline helper had a JavaScript template-escaping error (`SyntaxError: Missing } in template expression`); correcting that helper produced the results above without changing any repository implementation or assertion.

## Verdict

**GO.** No demonstrated finding in the round-7 delta. The MCP path adds no Python invocation; other objects' `kf` calls remain unchanged. Selection, output equivalence, shell quoting, failure propagation and the new regression guard pass the stated offline checks. Original Python execution is **not covered**; hosted runner execution and live deployment behavior are **unverified**.
