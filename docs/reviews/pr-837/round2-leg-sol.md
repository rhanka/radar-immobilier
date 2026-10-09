status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: fix/mcp-preprod-expose@220c5c376d6971c9699bc4e7ea6e330c7d7a4adb
lens: guard-scripts-and-oauth-semantics (round 2)

## Reasoning

Reviewed `git diff origin/main...220c5c376d6971c9699bc4e7ea6e330c7d7a4adb` and the delta from `ddce2b4fd930b48f3926dc6081e1c9b886c2c73d`. Base was `641f48c31a89c9d7bc4f1bc06532728c29018cc8`. I read my round-1 prompt and review. I did not read any prohibited review/prompt or contact a peer. This is an independent leg, not a consensus verdict.

The branch was `fix/mcp-preprod-expose`; HEAD was already `efdaafc4bf10a6a245493f33e28d938ba4bea066`. `git diff --exit-code <target> -- deploy .github/workflows Makefile ui/nginx api/Dockerfile` returned 0, so the requested executions used target-identical inputs. Baseline and target files for comparisons and mutations were materialized with `git archive` into `.review-tmp-sol-r2/`; no review dossiers were archived. Only this review file was edited outside that scratch directory. All temporary files, including nested `mktemp` files, were confined there using `TMPDIR`, and the directory was deleted at completion. No cluster access, real kubeconfig use, credentials, direct Python invocation, reviewer-written Python, commits, pushes, or GitHub writes were used. The requested reconcile test itself executes the repository's pre-existing, standard-library-only `kfilter.py`.

**Shell and failure propagation.** `reconcile-preprod.sh:83` is a standalone assignment, outside an `if` condition or an OR list. The assignment inherits the lookup's exit status, so `set -e` stops on a failed lookup, even if the command printed a nonempty Deployment name first. With `--ignore-not-found -o name`, NotFound is successful empty output and skips the MCP; Forbidden/transport failures remain failures. The supplied absent/error cases and an extra stdout-plus-exit-17 mock exercise these distinctions.

At `reconcile-preprod.sh:126`, the ConfigMap extraction is likewise a standalone assignment. At lines 127–130, `mcp_cm_diff` starts at 0. The `printf | kubectl diff || mcp_cm_diff=$?` OR list permits an expected diff exit 1 without triggering `errexit`, and captures the pipeline's status immediately. `pipefail` also preserves a producer failure. There is no `!` inversion or later command overwriting `$?`. Status 0 applies without restart; 1 applies then restarts; statuses greater than 1 abort before the MCP apply. Extra mocks with statuses 0, 1, 2, 7, and 127 confirm the paths. The apply pipeline is outside that OR list and fails under `pipefail`; an apply exit 24 stopped before restart. A restart exit 26 stopped before subsequent CronJob/Deployment applies and before the workflow image step. The earlier multi-object diff at line 108 remains log-only; the new separate MCP diff is fail-closed. UI/API ConfigMaps have already been applied before an MCP diff error; the code does not claim transactional rollback.

**Role and rollout interaction.** The restart at `reconcile-preprod.sh:139` explicitly targets `radar-immobilier-preprod`. The declared Role grants `apps/deployments` get/list/watch/patch/update (`deploy/k8s/11-ci-deployer-preprod-rbac.yaml:72`) and core ConfigMaps get/list/create/patch/update (`:110`). These cover lookup, the server-side diff/apply dry-run, and the Deployment template patch performed by restart; no Ingress grant is needed or added. Actual installed Role/RoleBinding state is unverified.

The MCP ConfigMap is successfully applied before restart. The reconcile does not apply the MCP Deployment or change its image, so the later set-image remains the final image patch (`.github/workflows/build-push-images.yml:823`). A restart and an immediate image patch may produce successive template generations; neither patches the image back afterward. The rendered mandatory issuer/resource values are present and match `loadHttpConfig` and radar-api's bearer issuer/audiences (`packages/immo-mcp/src/server-http.ts:65`, `api/src/config.ts:350`, `:370`). No deterministic startup failure from the three changed values was demonstrated. Compatibility of the actual old live image, scheduling, and controller convergence are unverified without cluster access.

There is **no demonstrated guarantee of continuous MCP availability or of a CD failure when MCP is unhealthy**. The declared MCP uses one replica and `Recreate` (`deploy/k8s/40-immo-mcp-http-deploy.yaml:113`), so restarting permits a service interruption. The live strategy is unverified because the CD does not reconcile that Deployment. The existing MCP rollout check catches a nonzero status and warns (`build-push-images.yml:825`); executing that exact image-step body with a failing MCP rollout returned 0. The following hard readiness checks cover only radar-api/radar-ui (`:882`), and the public served-sha check probes `/health` and `/build.json`, not the MCP (`:944`). A pending or crash-looping MCP therefore is not established as healthy by a successful CD. That optional-connector policy predates this delta and is not a new finding. The new conditional restart also has a separately demonstrated retry gap, SOL-837-R2-01 below.

**Tests and CI.** The reconcile suite allocates a fresh temp directory, resets a separate call file for each `(MOCK_GET, MOCK_DIFF)` pair, passes both variables anew, and captures each child exit status immediately (`reconcile-preprod-mcp.test.sh:46`). Its fake kubectl delegates only `kustomize` to the real binary; all get/diff/apply/restart calls stay fake. Positive cases require the named MCP apply/restart and check apply-before-restart; negative cases reject inappropriate applies/restarts. The parent intentionally omits `set -e` so expected failures are counted; the production child retains `set -euo pipefail`.

I tested seven independent reconcile code regressions in fresh restored scratch source: all made this suite fail. Running the round-2 suite against the exact round-1 reconcile also returned `PASS=2 FAIL=3`, exit 1. The supplied five cases do not cover an apply failure, restart rejection, retry after partial success, set-image, or pod readiness. Additional mocks cover failure propagation and expose the retry gap; no mock establishes Kubernetes runtime health.

The auth suite's four isolated Ingress cases append a later JSON patch targeted by object name and exact field (`check-preprod-auth-isolation.test.sh:107`). Fresh fixture copies prevent mutation carryover. `run_bad_one` requires both the expected diagnostic and exactly one `FAIL: ` line (`:29`). Instrumentation confirmed one diagnostic for each UI-rule, MCP-rule, MCP-TLS-host, and MCP-TLS-secret case. A separate shared-patch case preserves broad coverage. Three guard regressions removing object-specific host or secret checking all made the suite fail. Seven additional negative render mutations and two positive formatting/order controls also produced their expected results. The production guard's awk code is unchanged in round 2; these checks ran with mawk 1.3.4.

The new CI step is in the `quality` job on `ubuntu-latest`, after checkout and `azure/setup-kubectl@v4`, before workspace dependency installation (`.github/workflows/ci.yml:15`, `:30`, `:45`). It needs Bash, GNU core utilities, grep/sed/awk, kubectl's bundled kustomize, and Python 3's standard library through the existing filter. These are available on GitHub's Ubuntu hosted image or installed by the preceding kubectl step; no PyYAML, npm dependencies, credentials, or cluster are required. Local execution used kubectl v1.35.3/kustomize v5.7.1. Execution on the actual GitHub runner and current full CI status are unverified; no CI-green claim is made.

**OAuth handoff and production invariance.** The updated read-only PR body explicitly specifies a dedicated `OAUTH_CLIENT_ID`, public PKCE settings, preprod resource indicator, radar-account approval, Claude advanced settings with that ID and empty secret, and authenticated initialize/tools-list/search_signals acceptance. The local registration builder still defaults to `design-system` without that variable and requires PKCE for the public registration (`/home/antoinefa/src/sentropic/api/src/scripts/oauth-register-client.ts:89`, `:109`, `:153`). Radar's approval gate remains at `api/src/routes/auth.ts:649`. This resolves the missing operational instructions; actual registration/account/client/token state and authenticated acceptance remain unverified.

The PR's literal operator Ingress compared exactly with the target's rendered `radar-immo-mcp` Ingress. Both public IdP metadata documents still advertise their respective canonical issuer, S256, authorization-code, and token auth `none`, without a registration endpoint. Their advertised scope lists omit `immo:*`; permitted/granted per-client scopes remain unverified, as in round 1. Prod challenge/PRM paths still match the implementation. Preprod public probes still reach UI HTML, so the change's post-deploy effect is unverified.

Both production renders, the entire `deploy/k8s` file tree (including raw 30/40/41/70), and `k8s-apply-mcp.yaml` compared byte-identically to origin/main. Removing full-line comments from both versions of `build-push-images.yml` produced byte-identical files. Its comment hunks are confined to `deploy-preprod`; `ci.yml` adds only the requested test step. No production apply input or production job behavior changed in the reviewed diff.

## Resolution of round-1 findings

| id | severity | status | evidence |
| --- | --- | --- | --- |
| SOL-837-01 | non-blocking | resolved | `check-preprod-auth-isolation.test.sh:29`, `:107`–`:121`: each of the four new cases targets one Ingress field and asserts one diagnostic. Instrumented target run returned the four isolated messages recorded below, `PASS=25 FAIL=0`. Removing MCP host detection, UI host detection, or TLS-secret detection caused suite exits 1 (`23/2`, `23/2`, `24/1`). |
| SOL-837-02 | non-blocking | resolved | Read-only PR #837 body, “Remaining after merge” steps 3–5 and “Authenticated acceptance”: dedicated `OAUTH_CLIENT_ID` with the default/upsert hazard explained, account approval with owner, preprod connector URL/client ID/empty secret, and initialize/tools-list/search_signals acceptance are now explicit. Compared against the registration builder and radar approval gate above. The missing handoff is resolved; execution of those external steps is unverified. |

## New findings

### SOL-837-R2-01

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/reconcile-preprod.sh:135` and `:137` (apply succeeds before a restart conditional based on the pre-apply diff).
- **Evidence:** With an existing Deployment, MCP diff exit 1, successful ConfigMap apply, and rejected restart (mock exit 26), the target exited 26 after `apply immo-mcp-config` and `restart deploy/radar-immo-mcp`. On the next invocation, modeling the now-successfully-applied ConfigMap with diff exit 0 and restored restart permission, the target returned 0 and never attempted restart. Since `envFrom` is read at pod creation (`40-immo-mcp-http-deploy.yaml:153`), the old running pod can retain its old issuer/resource. On a same-image workflow retry, set-image does not change the pod template and cannot supply the missed restart. This is a demonstrated command-sequence gap under the stated failure condition, not an observed cluster incident. The first run visibly fails and a different-image retry would roll the pod, which limits severity.
- **Fix:** Make rollout intent recoverable after a successful ConfigMap apply and a rejected restart. For example, compare/patch a ConfigMap-content checksum in the MCP Deployment pod template on every invocation, so a retry sees the unapplied template change independently of ConfigMap diff. Add a two-run hermetic case: apply succeeds/restart is rejected, then unchanged ConfigMap/restart permitted; require a rollout-triggering patch on the second run. This remains within the existing Deployment patch grant.

## Commands and outputs

Commands were executed through `rtk`. Shell commands below omit that prefix for readability. `S` denotes `$PWD/.review-tmp-sol-r2`. Tests set `TMPDIR="$S/tmp"` and a nonexistent scratch `KUBECONFIG`. A scratch wrapper rejected every real kubectl command except `kustomize`; the reconcile suite installed its own fake in front of it. `K8S_VALIDATE_WITH_CLUSTER=0` was set for the make check. There were no stacks or cluster requests.

```text
$ git rev-parse HEAD origin/main
efdaafc4bf10a6a245493f33e28d938ba4bea066
641f48c31a89c9d7bc4f1bc06532728c29018cc8

$ git diff --exit-code 220c5c376d6971c9699bc4e7ea6e330c7d7a4adb -- deploy .github/workflows Makefile ui/nginx api/Dockerfile
(no output)
exit=0

$ bash deploy/ci/check-preprod-auth-isolation.sh
preprod auth isolation: ok (/home/antoinefa/src/radar-immobilier/tmp/mcp-preprod-expose/deploy/overlays/preprod — no PROD auth value or routing host; 8 preprod keys pinned in radar-api + immo-mcp-config)
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
ok: Deployment absent: no immo-mcp-config diff/apply, no restart, rest reconciled
ok: present + ConfigMap unchanged: applied, no restart
ok: present + ConfigMap changed: applied, then radar-immo-mcp restarted
ok: Deployment lookup failure: script stops before any apply
ok: immo-mcp-config diff failure: stops before its apply
PASS=5 FAIL=0
exit=0

$ make k8s-validate ENV=review-sol-837-r2
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

An instrumented scratch copy printed the output inside `run_bad_one`; each case returned exactly the following single diagnostic, plus the common failure footer:

```text
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar: PROD routing host -> - host: immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca
FAIL: Ingress/radar-immo-mcp: PROD TLS secret -> secretName: radar-immo-tls
Instrumented suite: PASS=25 FAIL=0, exit=0
```

Mutation helpers restored the exact original scratch script before each independent mutation. All mutated-suite exits were 1, and the helper returned `MUTANTS KILLED=10/10`, exit 0:

| Scratch code regression | Suite output |
| --- | --- |
| Delete MCP restart command | `PASS=4 FAIL=1`; changed ConfigMap no longer restarts |
| Add `|| true` inside lookup command substitution | `PASS=4 FAIL=1`; lookup failure continues applying |
| Remove `--ignore-not-found` | `PASS=4 FAIL=1`; absent Deployment now aborts |
| Change diff-error threshold from `>1` to `>255` | `PASS=4 FAIL=1`; diff error now applies MCP ConfigMap |
| Replace `|| mcp_cm_diff=$?` with `|| true` | `PASS=3 FAIL=2`; changed/error statuses lost |
| Treat diff exit 1 as fatal (`>0`) | `PASS=4 FAIL=1`; ordinary changed-config case aborts |
| Move restart block before MCP apply | `PASS=4 FAIL=1`; apply-before-restart assertion fails |
| Remove MCP-specific Ingress host diagnostic | Auth `PASS=23 FAIL=2`; isolated MCP rule/TLS tests fail |
| Remove UI-specific Ingress host diagnostic | Auth `PASS=23 FAIL=2`; isolated UI rule/shared-patch tests fail |
| Remove Ingress PROD TLS-secret check | Auth `PASS=24 FAIL=1`; isolated secret mutation is accepted |

The exact round-1 reconcile, substituted only in scratch, produced `PASS=2 FAIL=3`, exit 1 under the new suite: changed-config restart, lookup failure, and diff failure were rejected. Both target scripts were restored and compared against the worktree with `cmp`, exit 0.

Independent extra reconcile mocks returned `EXTRA MOCKS PASS=10 FAIL=0`, helper exit 0. They parsed the actual stdin manifests, rejected any prod namespace, delegated only offline kustomize, and supplied the following process statuses:

| Mock case | Observed target behavior |
| --- | --- |
| MCP diff 0 | Exit 0; apply MCP CM; no restart; subsequent applies run |
| MCP diff 1 | Exit 0; apply MCP CM, then restart, then subsequent applies |
| MCP diff 2, 7, or 127 | Each exit 1; no MCP apply/restart; `::error title=immo-mcp-config diff failed::kubectl diff exit N — aborting before set-image` |
| Lookup prints Deployment name, then exits 17 | Exit 17; get only; no apply |
| MCP apply exits 24 | Exit 24; no restart or subsequent applies |
| MCP restart exits 26 after successful apply | Exit 26; no subsequent applies |
| Retry with now-unchanged MCP CM, restart allowed | Exit 0; no restart; subsequent applies run |
| Actual workflow image-step body; MCP rollout status exits 1 | Exit 0; `::warning::radar-immo-mcp rollout not complete within 180s (optional connector, deploy continues)` |

The two traces supporting SOL-837-R2-01, with unrelated log-diff/resource calls abbreviated:

```text
restart-error: exit=26
get radar-immo-mcp | … | diff immo-mcp-config | apply immo-mcp-config | restart deploy/radar-immo-mcp

retry-after-restart-error: exit=0
get radar-immo-mcp | … | diff immo-mcp-config | apply immo-mcp-config | apply radar-consistency-snapshot | apply radar-api | apply radar-ui
```

For these mocks, the source was the unmodified target-identical worktree script. The workflow run body was extracted from lines 811–829. An initial scratch extraction accidentally omitted its closing `fi`, producing a helper syntax error; that extraction was corrected before the reported run. That error was in the reviewer helper, not the PR.

Seven extra negative mutations started from the released preprod render; all returned 1 with their expected messages. Two positive controls returned 0. Helper output was `EXTRA AUTH PASS=9 FAIL=0`, exit 0:

| Render mutation/control | Diagnostic/result |
| --- | --- |
| Delete each of `IMMO_MCP_OAUTH_ISSUER`, `IMMO_MCP_OAUTH_RESOURCE`, `RADAR_PUBLIC_BASE_URL` (three cases) | Respective `ConfigMap/immo-mcp-config: KEY missing (expected …)` |
| Set both API and MCP issuer to `https://idp.preprod.sent-tech.ca` | Both pinned-issuer failures; no issuer-mismatch diagnostic |
| Append only an extra prod MCP TLS host | Only `Ingress/radar-immo-mcp: PROD routing host -> - immo.sent-tech.ca` |
| Append a second MCP rule with prod host | Only `Ingress/radar-immo-mcp: PROD routing host -> - host: immo.sent-tech.ca` |
| Double-quote wrong MCP resource `/api/mcp` | `IMMO_MCP_OAUTH_RESOURCE=https://preprod.immo.sent-tech.ca/api/mcp (expected https://preprod.immo.sent-tech.ca/mcp)` |
| Double-quote all eight valid pinned values | Accepted, exit 0 |
| Reverse ConfigMap uppercase data-key order | Accepted, exit 0 |

Read-only PR retrieval used `gh pr view 837 -R rhanka/radar-immobilier --json number,title,body,headRefOid,url`, exit 0. It returned head `efdaafc4bf10a6a245493f33e28d938ba4bea066`; the review still targets `220c5c37`. Extracting its literal MCP Ingress and comparing against the target render returned `diff exit=0`. The body explicitly contains the client-ID, approval, connector, and authenticated acceptance instructions summarized above.

Public probes used only the four allowed origins, without credentials or redirect following:

```bash
curl --max-time 25 -sS -D "$headers" "https://$idp/.well-known/oauth-authorization-server" -o "$body"
curl --max-time 25 -sS -D "$headers" -X POST -H 'content-type: application/json' -d '{}' "https://$app/mcp" -o "$body"
curl --max-time 25 -sS -D "$headers" "https://$app/mcp/.well-known/oauth-protected-resource" -o "$body"
```

All six curls returned exit 0; response Date headers were `Fri, 09 Oct 2026 10:38:46 GMT`:

| Endpoint | Observed output |
| --- | --- |
| Prod IdP metadata | HTTP/2 200 JSON; issuer `https://auth.sent-tech.ca`, S256, token auth includes `none`; no registration endpoint |
| Preprod IdP metadata | HTTP/2 200 JSON; issuer `https://preprod.auth.sent-tech.ca`, same capabilities; no registration endpoint |
| Prod POST `/mcp` | HTTP/2 401 JSON; `resource_metadata="https://immo.sent-tech.ca/mcp/.well-known/oauth-protected-resource"` |
| Prod GET PRM | HTTP/2 200 JSON; resource `https://immo.sent-tech.ca/mcp`, issuer `https://auth.sent-tech.ca`, three `immo:*` scopes |
| Preprod POST `/mcp` | HTTP/2 405 HTML; nginx; `405 Not Allowed` |
| Preprod GET PRM | HTTP/2 200 HTML; nginx; SPA title `Radar immobilier` |

Production comparisons used `git archive origin/main deploy/k8s .github/workflows` and `git archive <target> deploy ui/nginx .github/workflows api/Dockerfile Makefile` in scratch, followed by both `kubectl kustomize <tree>/deploy/k8s` and `kubectl kustomize --load-restrictor LoadRestrictionsNone <tree>/deploy/k8s/refresh-cronjobs-prod`:

```text
prod base render: byte-identical (cmp exit=0)
prod refresh render: byte-identical (cmp exit=0)
30-api.yaml: byte-identical (cmp exit=0)
40-immo-mcp-http-deploy.yaml: byte-identical (cmp exit=0)
41-immo-mcp-ingress.yaml: byte-identical (cmp exit=0)
70-networkpolicy.yaml: byte-identical (cmp exit=0)
entire deploy/k8s tree: byte-identical (diff -qr exit=0)
k8s-apply-mcp.yaml: byte-identical (cmp exit=0)
build-push-images.yml after removing full-line comments: byte-identical (cmp exit=0)
```

The comment comparison used `sed '/^[[:space:]]*#/d'` on both workflow versions. `git diff --numstat origin/main...<target> -- deploy/k8s .github/workflows/k8s-apply-mcp.yaml` and `git diff --check origin/main...<target>` produced no output, exit 0. The ci.yml diff is exactly the added step and separating blank line.

Final review-file whitespace checking and comparison of header lines 2–6 against the dispatched stub both returned 0. `rm -rf -- .review-tmp-sol-r2` followed by `test ! -e .review-tmp-sol-r2` returned 0; the scratch directory and all helper files were removed.

## Verdict

**GO-with-nits.** Both of my round-1 findings are resolved. The requested checks passed, the supplied suites detect the tested regressions, and production invariance was reconfirmed. SOL-837-R2-01 is a non-blocking recovery gap after a rejected restart; no blocking finding was demonstrated. Installed RBAC, live pod health, operator Ingress application, IdP/client/account state, authenticated acceptance, and actual GitHub-runner execution remain unverified. This verdict does not establish a working deployed preprod MCP.
