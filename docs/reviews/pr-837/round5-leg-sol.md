status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@a6732b7b29f4cb52c439bcf9c84643bcdca222f9
lens: guard-scripts-and-oauth-semantics (round 5)

## Reasoning

Reviewed `git diff origin/main...a6732b7b29f4cb52c439bcf9c84643bcdca222f9` and the round-5 code delta from `2c6655e54ac9d74f4ce037c45a66e6c85223c83e`. Base is `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. I read my four earlier prompts and four earlier reviews. No review file whose name contains `astra` was read and no peer was contacted. This is one independent leg, with no consensus claim.

The branch was `fix/mcp-preprod-expose`; worktree HEAD was already `dcd795a07df508901a79173a4e906852faf6803e`. Both initial and final `git diff --exit-code <target> -- deploy .github/workflows Makefile ui/nginx api/Dockerfile api/src packages/immo-mcp/src` returned 0. Thus the requested commands used target-identical execution inputs. Base and exact-target files were also archived under `.review-tmp-sol-r5/`, excluding review dossiers. All mutants changed only the archived reconcile script, starting from the exact original each time; the target test remained unmodified. A restored-original archive run passed all 11 cases.

All temporary files, including nested `mktemp` files, were confined to `.review-tmp-sol-r5/` using `TMPDIR`. An offline kubectl wrapper, a nonexistent scratch `KUBECONFIG`, and `K8S_VALIDATE_WITH_CLUSTER=0` prevented real cluster operations. The wrapper allowed only kustomize, client version, and explicitly local patch/set commands; this round used kustomize only. Reconcile executions installed a fake ahead of that wrapper. No real kubeconfig, cluster access, credentials, direct reviewer Python invocation, reviewer-written Python, commits, pushes, or GitHub writes were used. The requested reconcile suite invokes the repository's existing `kfilter.py` through the production script. Only this leg was modified outside scratch; scratch was deleted at completion. The harness review method was applied as an individual blind leg, following the owner's explicit prohibition on peer contact and additional writes.

**Delta and false-failure controls.** The only code change in round 5 is `deploy/ci/reconcile-preprod-mcp.test.sh`: 39 insertions and 10 deletions. The production reconcile, auth guard/tests, overlays, application source, and workflows compare unchanged to the round-3 target. The fake now matches the persisting apply's exact argument string at test line 44, rejecting namespace overrides, dry-run, omitted conflict forcing, and a different field manager. It retains the MCP stdin document at line 51; lines 117–121 assert kind, preprod namespace, issuer, resource, public URL, and advertised scopes. Both fake version reads can print their value before exiting 18/19 (lines 36–42), and the new cases require failure before patch/later reconciliation (lines 125–131). Per-run variables are explicitly reset, including `MOCK_FAIL_READ`, and independent cases reset RV/annotation state. The intentional multi-run scenarios retain state for convergence and recovery.

No false failure was observed on the unmodified target: the worktree and restored exact-target archive both returned `PASS=11 FAIL=0`, exit 0. The separate content assertion observes the document captured during the present-Deployment/missing-annotation case. Exact matching of `$*` is a bounded command-protocol check, not an API-server emulator or argv parser. The latest captured document's asserted fields pass, but this is not a full document-equivalence check; the remaining demonstrated consequence is SOL-837-R5-01 below.

**Earlier survivors and additional mutations.** All five round-4 surviving mutants are now rejected. Removing MCP conflict forcing and adding a prod namespace argument each yield `PASS=2 FAIL=9`; dropping only the applied issuer and suppressing each version-read error each yield `PASS=10 FAIL=1`. The issuer mutant fails specifically at the new document assertion. Each read-suppression mutant fails specifically at its corresponding stdout-before-error case: the child returns 0, patches the template and continues applying later objects, so the new negative assertion rejects it. These failures satisfy the exact round-4 acceptance criteria, without attributing an unrelated render failure to the mutation.

The three formerly surviving round-3 mutations are still rejected: pre-apply RV read, root metadata patch, and unescaped JSONPath. First adoption, empty-RV rejection, annotation comparison, lookup/patch error propagation, UID substitution, and patch-type controls also fail when independently regressed. New dry-run, field-manager, manifest-namespace, resource, public-URL, scopes, and kind mutations fail. One further filtered-body mutation survives: deleting `RADAR_API_BASE_URL`. Its applied stdin was independently captured and its behavior consequence is established by the shipped data-source factories. This is a coverage finding; the unmodified target sends the correct API URL.

**Recovery and shell behavior.** An independent execution using the exact target's stateful fake recorded RV `100 -> 101` during a successful apply, then a rejected patch (exit 23) leaving annotation `100`. A same-image retry returned 0 and patched annotation `101`; a third settled invocation made no patch. The initial failed invocation stopped before the later CronJob/API/UI applies. ConfigMap and template GET faults returned precisely 18/19, despite printing a value first, and stopped before patch/later applies. The production assignments, MCP apply pipeline, and template patch remain outside error-suppressing conditions or OR lists; their statuses reach `set -euo pipefail`. Successful empty annotation output remains distinct from a failed annotation GET. Empty ConfigMap RV is separately rejected at `reconcile-preprod.sh:132`.

The declared Role still grants ConfigMap get/create/patch/update and Deployment get/patch (`11-ci-deployer-preprod-rbac.yaml:72`, `:110`); installed grants and admission behavior are unverified. The escaped annotation JSONPath and nested merge patch are unchanged from the real offline kubectl controls recorded in rounds 3–4; those local JSON controls were not repeated this round. The present-Deployment/missing-annotation and retry cases pass at this target.

**Auth/OAuth and runtime limits.** Re-instrumenting the exact-target auth suite again yielded exactly one intended diagnostic for each isolated Ingress rule/TLS-host/TLS-secret mutation, with `PASS=25 FAIL=0`. The POSIX awk code is unchanged; the round-1 BusyBox portability campaign was not repeated. MCP and radar-api still use the same preprod issuer, and the MCP resource remains one of the API bearer audiences (`server-http.ts:173`, `api/src/config.ts:350`, `:370`); the HTTP source forwards the user bearer (`data-source.ts:301`). The `/mcp` Prefix Ingress covers transport and appended PRM discovery. Radar's approved-account gate remains at `auth.ts:649`.

SOL-837-02 retains the documented handoff resolution established in my round-2 review: explicit dedicated client ID, public PKCE, preprod resource/scopes, account approval, connector client ID/empty secret, and authenticated initialize/tools-list/search_signals acceptance. The registration builder still defaults to `design-system` without `OAUTH_CLIENT_ID` (`/home/antoinefa/src/sentropic/api/src/scripts/oauth-register-client.ts:89`). The current remote PR body was not fetched because GitHub is outside the four permitted network hosts. Current remote handoff text and operational execution remain unverified.

Public probes on the four allowed hosts still show correct prod discovery/challenge and preprod UI HTML. Both IdPs advertise S256, authorization-code and token auth `none`, without a registration endpoint or advertised `immo:*` scopes; actual per-client allowed/granted scopes remain unverified. No authenticated request was made.

No-op SSA/resourceVersion preservation remains unverified: no server experiment or permitted documentation source establishes that assumption. The fake models stable RV for an unchanged apply. One replica with Recreate can interrupt service, and following set-image can cause another template generation. The existing workflow treats MCP rollout failure as a warning (`build-push-images.yml:826`–`:827`), so successful CD does not establish healthy MCP pods. These unchanged limits are not new demonstrated regressions. Operator installation, actual client/account state, authenticated acceptance, and hosted-runner/full-CI execution remain unverified.

**Production invariance.** Both production renders and the entire `deploy/k8s` tree compare byte-identically to origin/main, including raw files 30/40/41/70 and refresh inputs. `k8s-apply-mcp.yaml` is identical. Removing full-line comments from `build-push-images.yml` yields identical bytes; its comment hunks are confined to `deploy-preprod`. The only `ci.yml` addition is the hermetic reconcile-test step and its separating blank line. Production apply inputs and production deployment-job behavior are invariant at the requested target.

## Resolution of earlier findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| SOL-837-01 | non-blocking | resolved | Auth test `:29`, `:107` retains per-object/per-field reinjection and exactly-one-diagnostic assertion. Exact-target instrumented run printed the four intended isolated messages and `PASS=25 FAIL=0`, exit 0. |
| SOL-837-02 | non-blocking | resolved | `round2-leg-sol.md` records verified PR-body corrections for dedicated `OAUTH_CLIENT_ID`, public PKCE/resource/scopes, account approval, connector settings and authenticated acceptance. Registration default and account gate were re-read. Resolution concerns the missing handoff; current remote text and execution are unverified. |
| SOL-837-R2-01 | non-blocking | resolved | Reconcile `:129`–`:138` applies then reads live RV and compares/patches template annotation on every invocation. Independent rejected-patch run: exit 23, RV=101/annotation=100; same-image retry: exit 0, annotation=101; settled third run: no patch. Supplied recovery case passes. |
| SOL-837-R3-01 | non-blocking | resolved | Test `:36`, `:40`, `:59` checks exact JSONPaths/nested merge payload; `:53`–`:54` advances RV on changed apply; `:99`–`:101` checks ordering/current value; `:109`–`:113` covers first adoption. Pre-apply RV/root metadata/unescaped lookup mutants return `8/3`, `7/4`, `5/6` (PASS/FAIL), all exit 1. |
| SOL-837-R4-01 | non-blocking | resolved | Exact persisting apply at test `:44`, stdin capture `:51`, and document checks `:117`–`:121` reject all three reported survivors: no force-conflicts `2/9`, prod namespace argument `2/9`, dropped issuer `10/1`, all exit 1. Its specific acceptance criteria are met; a different unasserted data-source key is demonstrated below. |
| SOL-837-R4-02 | non-blocking | resolved | Test `:36`–`:42`, `:125`–`:131` adds independent stdout-before-error RV and annotation failures. Each corresponding suppression mutant now returns `PASS=10 FAIL=1`, exit 1, failing only its intended read-error case. Independent target traces return exactly 18/19 before patch/later applies. |

## New findings

### SOL-837-R5-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/reconcile-preprod-mcp.test.sh:117` (document assertion through line 121); supporting production locations `packages/immo-mcp/src/data-source.ts:354`, `packages/immo-mcp/src/raw-data.ts:782`, `packages/immo-mcp/src/server-http.ts:256`.
- **Evidence:** In an independent exact-target reconcile mutant, insert `| sed '/RADAR_API_BASE_URL:/d'` only between the 4b filter and persisting apply. The unchanged target suite returns `PASS=11 FAIL=0`, exit 0, including its “applied immo-mcp-config” content check. An independent child execution/capture also returns 0, advances RV and patches the template, while its actual applied document has no `RADAR_API_BASE_URL`; kind/name/preprod namespace, issuer/resource/public URL and scopes remain correct. This is a demonstrated omission in the applied-document assertion. If that omitted key is absent from the resulting pod environment, the shipped `createDataSource` returns `MockDataSource` and `createRawDataSource` returns `MockRawDataSource`; `main` passes both to the server. Thus the omitted field selects fixture data instead of the real radar API even with `IMMO_MCP_DATA_MODE: http`. Persistence/field-ownership behavior and a live pod effect were not tested. The unmodified target capture includes `RADAR_API_BASE_URL: http://radar-api:3000`, so no current production-code defect is established.
- **Fix:** Include the real API URL in the applied-document assertion, or compare the captured MCP document with the complete MCP document from the guarded render. Acceptance: this exact omission mutant must fail, while the original 11 cases and rejected-patch/same-image-retry scenario pass. This is a bounded hermetic test change, with no cluster requirement.

## Commands and outputs

Commands ran through `rtk`; prefixes are omitted below. `S` denotes `$PWD/.review-tmp-sol-r5`. Tests used `TMPDIR="$S/tmp"`, `KUBECONFIG="$S/no-kubeconfig"`, the offline wrapper on PATH, and `K8S_VALIDATE_WITH_CLUSTER=0`. Archives were made with `git archive`, excluding review dossiers. Mutants were generated with Bash/awk/sed, checked with `bash -n`, diff-inspected, and restored independently. A scratch-only quoting error and a malformed additional first-adoption helper mutation were corrected before their reported runs; neither was a target failure.

```text
$ git rev-parse HEAD origin/main
dcd795a07df508901a79173a4e906852faf6803e
641f48c31a89c9d7bc4f1bc06532728c29018cc8

$ git diff --exit-code a6732b7b29f4cb52c439bcf9c84643bcdca222f9 -- deploy .github/workflows Makefile ui/nginx api/Dockerfile api/src packages/immo-mcp/src
(no output; initial and final checks)
exit=0

$ git diff --exit-code bc89161a8ddd4b49e87b1a05c46c381e52f5de40 a6732b7b29f4cb52c439bcf9c84643bcdca222f9 -- deploy/ci/reconcile-preprod.sh deploy/ci/check-preprod-auth-isolation.sh deploy/ci/check-preprod-auth-isolation.test.sh deploy/overlays/preprod .github/workflows api/src packages/immo-mcp/src
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
ok: applied immo-mcp-config = preprod namespace, issuer, resource, public URL, prod scopes
ok: failed rv read: script stops before the patch and the later applies
ok: failed ann read: script stops before the patch and the later applies
ok: Deployment lookup failure: script stops before any apply
ok: empty ConfigMap resourceVersion: script stops, no patch
ok: patch failure then same-image retry: the retry still rolls the pod
PASS=11 FAIL=0
exit=0

$ make k8s-validate ENV=review-sol-837-r5
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

The restored exact-target archive's unmodified reconcile suite repeated the same 11 successful messages and `PASS=11 FAIL=0`, exit 0. Final archived source comparison against its saved original returned 0.

Every reported mutation below changes only the scratch 4b block or its initial Deployment lookup. “Rejected” means suite exit 1; “survived” means exit 0. Of 24 independent mutations, 23 are rejected and one survives.

| Origin | Reconcile mutation | Suite output | Exit | Result |
| --- | --- | --- | --- | --- |
| Round-4 survivor | Remove MCP apply `--force-conflicts` | `PASS=2 FAIL=9` | 1 | rejected |
| Round-4 survivor | Add prod namespace argument to MCP apply | `PASS=2 FAIL=9` | 1 | rejected |
| Round-4 survivor | Drop issuer from filtered MCP apply body | `PASS=10 FAIL=1` | 1 | rejected |
| Round-4 survivor | Suppress ConfigMap-RV GET error | `PASS=10 FAIL=1` | 1 | rejected |
| Round-4 survivor | Suppress template-annotation GET error | `PASS=10 FAIL=1` | 1 | rejected |
| Earlier control | Read RV before MCP apply | `PASS=8 FAIL=3` | 1 | rejected |
| Earlier control | Patch root metadata instead of template metadata | `PASS=7 FAIL=4` | 1 | rejected |
| Earlier control | Remove annotation JSONPath dot escape | `PASS=5 FAIL=6` | 1 | rejected |
| Earlier control | Delete template-annotation patch | `PASS=8 FAIL=3` | 1 | rejected |
| Earlier control | Invert annotation/RV inequality | `PASS=7 FAIL=4` | 1 | rejected |
| Earlier control | Delete empty-RV assertion | `PASS=10 FAIL=1` | 1 | rejected |
| Earlier control | Suppress initial Deployment lookup error | `PASS=10 FAIL=1` | 1 | rejected |
| Earlier control | Suppress template-patch error | `PASS=10 FAIL=1` | 1 | rejected |
| Earlier control | Skip patch when annotation is missing | `PASS=10 FAIL=1` | 1 | rejected |
| Earlier control | Read ConfigMap UID instead of RV | `PASS=3 FAIL=8` | 1 | rejected |
| Earlier control | Use JSON patch type with merge-patch object | `PASS=7 FAIL=4` | 1 | rejected |
| New control | Add `--dry-run=server` to MCP apply | `PASS=2 FAIL=9` | 1 | rejected |
| New control | Replace MCP apply field manager | `PASS=2 FAIL=9` | 1 | rejected |
| New control | Change applied MCP manifest namespace to prod | `PASS=10 FAIL=1` | 1 | rejected |
| New control | Drop applied MCP resource | `PASS=10 FAIL=1` | 1 | rejected |
| New control | Drop applied MCP public URL | `PASS=10 FAIL=1` | 1 | rejected |
| New control | Drop applied MCP advertised scopes | `PASS=10 FAIL=1` | 1 | rejected |
| New control | Change applied MCP kind to Secret | `PASS=10 FAIL=1` | 1 | rejected |
| New control | Drop applied `RADAR_API_BASE_URL` | `PASS=11 FAIL=0` | 0 | survived |

Independent control traces reused the exact target fake, with its state preserved across the recovery runs. Unrelated early UI/API applies are abbreviated below:

```text
patch-rejected: exit=23 rv=101 ann=<100>
get radar-immo-mcp | … | apply immo-mcp-config | read rv | read ann | patch-failed

same-image-retry: exit=0 rv=101 ann=<101>
get radar-immo-mcp | … | apply immo-mcp-config | read rv | read ann | patch rv=101 | apply radar-consistency-snapshot | apply radar-api | apply radar-ui

settled: exit=0 rv=101 ann=<101>
get radar-immo-mcp | … | apply immo-mcp-config | read rv | read ann | apply radar-consistency-snapshot | apply radar-api | apply radar-ui

readfail-rv: exit=18 rv=101 ann=<100>
get radar-immo-mcp | … | apply immo-mcp-config | read rv

readfail-ann: exit=19 rv=101 ann=<100>
get radar-immo-mcp | … | apply immo-mcp-config | read rv | read ann

missing-api-url: exit=0 rv=101 ann=<101>
get radar-immo-mcp | … | apply immo-mcp-config | read rv | read ann | patch rv=101 | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
independent controls: PASS=6 FAIL=0
helper exit=0
```

The surviving mutation is exactly this insertion before the production apply at line 130:

```bash
  kf "$RENDER" ConfigMap immo-mcp-config \
    | sed '/RADAR_API_BASE_URL:/d' \
    | kubectl apply --server-side --field-manager="$FM" --force-conflicts -f -
```

The independent capture contains:

```yaml
  IMMO_MCP_DATA_MODE: http
  IMMO_MCP_HTTP_PORT: "8848"
  IMMO_MCP_OAUTH_ISSUER: https://preprod.auth.sent-tech.ca
  IMMO_MCP_OAUTH_RESOURCE: https://preprod.immo.sent-tech.ca/mcp
  IMMO_MCP_OAUTH_SCOPES_SUPPORTED: immo:read immo:search immo:documents:read
  RADAR_PUBLIC_BASE_URL: https://preprod.immo.sent-tech.ca
kind: ConfigMap
  name: immo-mcp-config
  namespace: radar-immobilier-preprod
```

An explicit assertion of the absence of `^  RADAR_API_BASE_URL:` succeeded. Restoring the original script and repeating that independent capture returned exit 0 with `RADAR_API_BASE_URL: http://radar-api:3000` present. Behavior follows directly from the shipped factories:

```typescript
// data-source.ts:354
const base = env.RADAR_API_BASE_URL;
if (base) return new HttpDataSource({ baseUrl: base });
return new MockDataSource();

// raw-data.ts:782
const base = env.RADAR_API_BASE_URL;
if (base) return new HttpRawDataSource({ baseUrl: base, publicBaseUrl: env.RADAR_PUBLIC_BASE_URL ?? base });
return new MockRawDataSource();
```

Exact-target auth instrumentation printed these four isolated diagnostics, with `PASS=25 FAIL=0`, exit 0:

```text
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls
```

Public requests used `curl --proto '=https' --max-time 20 -sS`, without credentials or redirect following. GETs were limited to the two IdP `/.well-known/oauth-authorization-server` endpoints and two app `/mcp/.well-known/oauth-protected-resource` endpoints; POSTs were limited to app `/mcp` with JSON `{}`. All six curls returned 0; response Date headers were `Fri, 09 Oct 2026 16:09:33 GMT`.

| Public endpoint | Observed output |
| --- | --- |
| Prod IdP metadata | HTTP/2 200 JSON; canonical prod issuer, S256, authorization-code, token auth includes `none`; no registration endpoint |
| Preprod IdP metadata | HTTP/2 200 JSON; canonical preprod issuer, same capabilities; no registration endpoint |
| Prod GET PRM | HTTP/2 200 JSON; prod resource/issuer and three `immo:*` scopes |
| Prod POST `/mcp` | HTTP/2 401 JSON; `resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"` |
| Preprod GET PRM | HTTP/2 200 HTML; SPA title `Radar immobilier` |
| Preprod POST `/mcp` | HTTP/2 405 HTML; nginx, `405 Not Allowed` |

Production comparisons used the exact base/target archives, `kubectl kustomize` on `deploy/k8s`, and `kubectl kustomize --load-restrictor LoadRestrictionsNone` on `refresh-cronjobs-prod`. Each comparison returned 0:

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

Header lines 2–6 were preserved from the dispatched stub; only its status changed. Review-file whitespace and scratch-removal checks completed with exit 0.

## Verdict

**GO-with-nits.** All six earlier findings are resolved at the evidence levels stated above; all five round-4 survivors are rejected. Required checks pass with no observed false failure, and production invariance is reconfirmed. One new non-blocking applied-document coverage gap remains demonstrated: removing the real API URL still passes all 11 cases despite selecting mock data when that key is absent at runtime. No blocking production-code regression was demonstrated. Server SSA/RV behavior, live grants/admission/pod health, operator installation, current remote handoff text and authenticated preprod acceptance remain unverified.
