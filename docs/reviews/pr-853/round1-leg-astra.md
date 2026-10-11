status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: feat/projection-intended-removals@6b8e2c49efb09567aa19704f33c145c2a2c581c4
lens: operational-path-input-validation-runbook

## Reasoning

Target: `git diff origin/main...6b8e2c49efb09567aa19704f33c145c2a2c581c4`.
The checkout was on `feat/projection-intended-removals` at that exact SHA. This is
one independent operational review, not a consensus verdict. No other review leg
was read. Repository rules, the harness review instructions, spec §17 and the
branch plan were read. No cluster, bucket or GitHub API was contacted.

**Workflow and rendering.** The workflow still has 10 dispatch inputs. Both reused
inputs reach the apply script through environment variables; declarations are
validated before the manifest is deleted/applied. Accepted ASCII declarations
exclude shell substitutions, glob characters, quotes, backslashes, `#`, `&` and
newlines. Consequently they do not introduce sed replacement syntax, shell syntax
or a Markdown backtick into the three destinations under review. The actual sed
blocks from `origin/main` and the target were executed locally against all 14
selected manifests. The 12 other manifests have identical non-comment content.
Both projection manifests have identical argument vectors without declarations
(empty, one-city and multi-city selections); the command text has one extra space
between the script name and cities. The two CronJob suspend/resume operations do
not render a manifest and their existing branch is unchanged.

The unrendered-placeholder check includes `PROJECTION_ARGS`. The Brigham preview
and apply declarations render without a remaining placeholder. The workflow grep
retains the declaration, plan, before-row and final-summary log messages. Accepted
declarations are also bounded before entering `GITHUB_STEP_SUMMARY`. Rejected
unknown-clause text is echoed into the error annotation without percent escaping;
the `%0A::warning::fake` probe remained rejected input and was not executed as
shell code. GitHub's rendering of that annotation is **not covered** by an offline
shell test; no runner-command exploit is claimed.

**Validator parity.** The supplied 36 shell cases pass. Additional probes cover
CR/LF, tabs, vertical tabs, commas, empty loss lists, glob/substitution characters,
128/129-character IDs, 64/65-character keys, 64 removals, 16 losses, and the
4,096/4,097-character workflow boundary. TypeScript rejects the probed trailing
LF/CR and non-ASCII IDs/keys. Two differences are observed:

- The shell helper accepts `é` under `fr_FR.utf8`; TypeScript rejects it (finding
  ASTRA-853-01).
- A single-line, valid 40-ID declaration of 5,166 characters is accepted by the
  TypeScript parser; the shell's additional 4,096-character dispatch bound rejects
  it. This is a stricter workflow bound, not an exemption from a projection guard.

The standalone helper also accepts `PROJECT_CITIES=$'brigham\ndanville'` because
`read` consumes the first line. The actual workflow's earlier whole-value regex
rejects that input at `run-job.yaml:342`; this does not demonstrate a workflow
multi-city bypass. Blank CR/LF-only declarations produce no flags, as do spaces;
tabs between nonempty clauses are accepted; a vertical tab within a declaration
is rejected. These results are recorded without treating the helper as equivalent
to the complete workflow.

**Script behavior and guards.** A throwaway Vitest test imported the actual
`project-graph-from-s3.ts` entry point with S3, DB/upsert, logger, termination-file
and exit ports mocked. Preview and apply exit 0 on one successful result; refusal,
upsert error, missing latest.json, malformed JSON and missing `nodes` exit 1.
The mock-returned Brigham result produces valid termination JSON with all 21
removals and the one loss: 780 characters/bytes for preview and 781 for apply
(mock edge counts 5 and 3, not measurements of Brigham). Preview still reports
`deletedNodes=21`, the planned transaction's count. A 64-long-ID report also
survives truncation as valid JSON within 4,000 characters and 4,096 bytes. Actual
Kubernetes termination-message delivery is **unverified**; the manifest uses the
default termination path and the preprod Role grants `get` on pods, which matches
the workflow's `.state.terminated.message` query (`run-job.yaml:549`).

The code checks declaration membership under the city lock before applying any
exemption (`graph-store.ts:1224`). An absent declaration returns an aborted
result; row gates still run, and the additional undeclared-removal check covers
rows without business properties or refs. I accept the narrow gate3 interpretation:
only declared nodes proven absent from the candidate are exempt; a declared loss
on a retained node does not exempt its refs. Gate2 still compares the original
completeness baseline with the projected state and throws to roll back on a drop
(`graph-store.ts:1366`). Preview throws its rollback sentinel inside the
transaction (`graph-store.ts:1436`). Calls without declarations retain the existing
upsert invocation and empty-exemption path. These source observations are separate
from the mocked script tests.

**Facts and runbook.** The literal `D` from §17.4 was parsed with the real parser
and compared with the proof JSON. Its 21 removals exactly equal all
`contam2.brigham.regs` rows with `inS3=false`; `muni-brigham` has `inS3=true` and
`missK=["flag"]`. `bylaw-2025-05` has one missing source SHA and `rawCities=["danville"]`.
`rows.json` confirms 36 S3 / 22 PG / 35 S3-only / 21 PG-only, with removed types
DesignationEvent 3, Lot 8, Signal 3, Source 4, Bylaw 3. `sim.json` confirms complete
counts 0 → 9, gate1 22 and gate3 1. The preprod proof's `perCity.brigham` reports
the same node counts, complete counts and one foreign regression. These are
stored historical observations; current remote state is **unverified**.

Every runbook job and named workflow input exists. `plannedRemovals` is sorted by
the implementation, not in `D`'s input order; the expected set is correct.
The suspend, image selection, declared preview/apply, mapper reset and repair
paths match the commands. Step 2's expected refusal entails exit 1 / a failed Job,
even though that refusal is the expected measurement. The repair's termination
summary is aggregate; its detailed per-city drift is in the report and pod log,
so the preprod operator needs the owner-side access described by the workflow to
check those details. The runbook's read-only wording and rollback logging order
need the non-blocking corrections below.

Rollback coverage is **partial** as an operational procedure: the code captures
all declared node preimages, including retained `muni-brigham`, and deleted city
edges, but the runbook does not pin a backup ID or require exporting that material
before proceeding. The 35 newly inserted nodes must also be removed in a city
restore; reinserting only the 21 removed nodes is insufficient. A restore was
**not covered** by this review. The PR body was not supplied or found in the
initial local file search; a local copy was requested. Its contents remain
**unverified**, independently of the checked spec runbook.

**CI.** `.github/workflows/ci.yml:51` runs the new offline shell test unconditionally
in the quality job, after checkout and before dependency installation. The existing
Kubernetes check is also wired into that job. Offline `make k8s-validate` passed;
it renders the main kustomization, validates the recovery templates and checks
image entrypoints. It does not by itself establish deployed projection behavior.
Remote CI status is **unverified** under the no-GitHub-API constraint.

## Commands run (with outputs)

All Make invocations used `ENV=review-astra-853` last. No native Node/npm/Python
was used on the host. Source reads used `git`, `rg`, `cat`, `sed` and Bash through
RTK after reading its bootstrap. Only the review leg and throwaway `.review-tmp`
files were authored.

1. Target inspection:

   ```text
   git branch --show-current
   feat/projection-intended-removals
   git rev-parse HEAD
   6b8e2c49efb09567aa19704f33c145c2a2c581c4
   git diff --stat origin/main...6b8e2c49efb09567aa19704f33c145c2a2c581c4
   13 files changed, 1066 insertions(+), 22 deletions(-)
   ```

2. `rtk bash deploy/ci/projection-declared-args.test.sh` — exit 0:

   ```text
   projection-declared-args: 36 passed, 0 failed
   ```

3. `rtk bash .review-tmp/astra-shell.sh` — exit 0. This throwaway harness called
   the real validator with adversarial values, extracted each version's actual
   sed command, and rendered the 14 selected manifests. Relevant output:

   ```text
   CR rc=1
   LF rc=1
   blankCRLF rc=0 output=''
   TAB rc=0 output=--remove=a\ --lose=b:k\ --preview
   vertical-tab rc=1
   trailing-comma rc=1
   leading-comma rc=1
   empty-loss rc=1
   glob rc=1
   question rc=1
   brackets rc=1
   backtick rc=1
   backslash rc=1
   quote rc=1
   annotation rc=1
   city-newline rc=0 output=--remove=a
   unicode-C rc=1
   unicode-FR rc=0 output=--remove=é
   unicode-key-FR rc=0 output=--lose=a:é
   long-id rc=1
   max-id rc=0
   max-key rc=0
   long-key rc=1
   max-removals rc=0
   max-losses rc=0
   max-total rc=0 output=--remove=a
   over-total rc=1
   rendered manifest comparisons=14
   workflow_dispatch inputs=10
   declared render mode=preview shell tokens=6 last=brigham
   declared render mode=apply shell tokens=5 last=brigham
   ```

   Refusal messages were printed by the validator; the excerpt above omits their
   repeated text. The over-limit message was `declarations are 4097 characters,
   at most 4096`. All other-job manifests compared identically after removing
   comments/blank lines. Projection command example:

   ```text
   origin/main: node dist/scripts/project-graph-from-s3.js brigham
   target:      node dist/scripts/project-graph-from-s3.js  brigham
   ```

   A separate Bash evaluation of the actual workflow `cities_re` printed
   `workflow-city-check=refused` for the helper's newline-city counterexample.

4. `rtk make k8s-validate ENV=review-astra-853` — exit 0:

   ```text
   [k8s-validate] rendering deploy/k8s with kustomize…
   [k8s-validate] structural check (every doc has apiVersion + kind)…
   [document-date-recovery] offline render ok (preprod + prod)
   [k8s-validate] every Job script is an esbuild entrypoint of api/Dockerfile…
   image entrypoint check: ok (25 reference(s) in 94 file(s), 18 entrypoint(s))
   [k8s-validate] offline render ok; set K8S_VALIDATE_WITH_CLUSTER=1 for a server dry-run
   ```

5. `rtk make install ENV=review-astra-853` — exit 0. Output: `added 951 packages,
   and audited 965 packages in 15s`.

6. Throwaway operational tests:

   ```sh
   rtk make test-api SCOPE='src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts ../.review-tmp/astra-operational.test.ts --config ../.review-tmp/vitest.config.ts' ENV=review-astra-853
   ```

   Exit 0. The custom config selected only the throwaway file despite the three
   supplied filters; this run is **not** represented as running the repository's
   two test files. Output:

   ```text
   Test Files  1 passed (1)
   Tests       10 passed (10)
   PARSER {"argv":["--remove=a\n","brigham"],"accepted":false}
   PARSER {"argv":["--lose=a:k\r","brigham"],"accepted":false}
   PARSER {"argv":["--remove=a","brigham\n"],"accepted":false}
   PARSER {"argv":["--remove=é","brigham"],"accepted":false}
   PARSER {"argv":["--lose=a:é","brigham"],"accepted":false}
   PARSER total length 5166 accepted=true
   ```

   Script assertions: preview/apply exit 0; refused/error/missing/invalid-json/
   no-nodes exit 1; every emitted termination body parses as JSON and meets the
   size limits. Both Brigham success summaries retain all 21 sorted removals and
   `plannedLosses=["muni-brigham:flag"]`. The four info messages selected by the
   actual workflow regex were:

   ```text
   project-graph-from-s3: changements déclarés
   project-graph-from-s3: plan vs changements déclarés
   project-graph-from-s3: lignes PG avant changements déclarés (retour arrière)
   project-graph-from-s3: terminé
   ```

   Historical preprod output:

   ```json
   {"group":"G6-both","s3":36,"pg":22,"onlyS3":35,"onlyPG":21,"verdict":"gate1-business-property","cb":0,"ca":9,"owned":0,"cls":"mixed","foreignRegs":1,"pgOnlyTypes":["DesignationEvent","Lot","Signal","Source","Bylaw"]}
   ```

7. `rtk make typecheck ENV=review-astra-853` — exit 0. API and workspace `tsc`
   commands completed. `svelte-check found 0 errors and 7 warnings in 1 file`
   (`SignauxSelPanel.svelte`, unused export/selectors).

8. Repository tests (default config):

   ```sh
   rtk make test-api SCOPE='src/scripts/projection-args.test.ts src/services/graph/graph-store.test.ts' ENV=review-astra-853 > .review-tmp/astra-unit.log 2>&1
   ```

   Exit 0:

   ```text
   src/scripts/projection-args.test.ts (23 tests)
   src/services/graph/graph-store.test.ts (157 tests)
   Test Files  2 passed (2)
   Tests       180 passed (180)
   Duration    24.24s
   ```

   The database-bound tests ran, including declared success, undeclared removal
   with/without properties, absent declaration, unchanged no-option refusal,
   preview rollback and gate2 rollback. No skipped tests were reported.

9. Cleanup — both commands exited 0:

   ```sh
   rtk make clean ENV=review-astra-853
   rtk make clean COMPOSE_FILES_DEV='-f docker-compose.yml -f docker-compose.dev.yml -f docker-compose.test.yml' ENV=review-astra-853
   ```

   The first command removed the review's Postgres/MinIO containers, network and
   development dependency/data volumes. The second removed the two test dependency
   volumes, which the default development Compose file does not declare. Output
   included `radar-review-astra-853_radar-test-root-node-modules Removed` and
   `radar-review-astra-853_radar-test-api-node-modules Removed`.

   My throwaway tests, local log and rendered fixtures were deleted. Other
   concurrently authored temporary files and a changed shared test config were
   preserved; their contents were not used for this review. Final `git diff
   --name-only` was empty, and HEAD remained
   `6b8e2c49efb09567aa19704f33c145c2a2c581c4`. The review directory and shared
   temporary directory are untracked; no tracked implementation file changed,
   and no commit or push was made.

## Findings

### ASTRA-853-01 — Shell validation depends on locale and differs from TypeScript

- **Severity:** non-blocking.
- **File:line:** `deploy/ci/projection-declared-args.sh:19` (used at lines 49 and 55);
  comparison: `api/src/scripts/projection-args.ts:18`.
- **Evidence:** the actual helper with `LC_ALL=fr_FR.utf8`, `PROJECT_CITIES=brigham`,
  `MODE=apply`, `DECLARATIONS=remove=é` exits 0 and prints `--remove=é`.
  `DECLARATIONS=lose=a:é` similarly prints `--lose=a:é`. In locale `C` the first
  input is rejected; the actual TypeScript parser rejects both. Bash range
  matching uses locale collation, while the TypeScript regex is ASCII. Thus the
  helper's claimed ASCII contract is not stable across environments. The
  Brigham declaration is ASCII, and a rejected TypeScript argument touches no
  database; no guard bypass is demonstrated.
- **Fix:** set/export `LC_ALL=C` before validation and include a non-ASCII case in
  parity tests. Retain the earlier workflow whole-city check, or reject CR/LF in
  `PROJECT_CITIES` inside the helper too if it is intended as a standalone boundary.

### ASTRA-853-02 — The two repair measurements write a report despite “read-only” wording

- **Severity:** non-blocking.
- **File:line:** `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:747` and `:751`;
  executed code: `api/src/scripts/repair-graph-city-key.ts:234`.
- **Evidence:** both runbook commands dispatch `graph-city-key-repair` preview.
  `runRepair` unconditionally calls `store.put` for
  `reports/graph-city-key/<run-id>/repair.json` after collecting the reports,
  including a refused city. It returns failure if that upload fails. PG preview
  changes roll back and `latest.json` is not written, but the command is not
  entirely read-only with respect to S3.
- **Fix:** describe these steps as “no committed PG/graph changes; writes the
  diagnostic S3 report,” and name that output/required permission. Explicitly
  note that step 2's expected `refused-guard` produces a failed Job/workflow.

### ASTRA-853-03 — Before-row logging happens after commit; rollback capture lacks a pre-apply stop

- **Severity:** non-blocking.
- **File:line:** `api/src/scripts/project-graph-from-s3.ts:150` and `:157`;
  `api/src/services/graph/graph-store.ts:1436`;
  `docs/spec/SPEC_FIX_GRAPH_CITY_KEY.md:713` and `:754`.
- **Evidence:** `projectCityInTransaction` reads the preimages into
  `result.declaredBaseline` before mutation, but apply returns that result only
  after `db.transaction` completes. The script then logs it. The spec instead
  says the rows are read and logged before the writes. The runbook names logs
  and a daily backup as rollback material without a checkpoint requiring either
  to be exported/identified before apply. Preprod's CI credential cannot read
  pod logs, and the termination summary contains no row preimages. No lost log
  or failed restore was observed; persistence/retrieval of actual rollback
  material is **unverified**.
- **Fix:** correct the documented ordering and require saving the preview's full
  node/edge preimages plus the exact backup identifier before step 4, stopping if
  that material cannot be retrieved. Alternatively, emit/persist the apply
  preimage before its writes. Describe a city restore that also removes the 35
  newly added nodes; reinserting deleted rows alone does not restore the baseline.

## Verdict

**GO-with-nits.** No blocking defect was demonstrated for the declared Brigham
operation or the unchanged job paths in this review. The three findings are
non-blocking and have bounded fixes. The PR body, remote CI, deployed image,
current remote graph state and an actual rollback remain **unverified**; this
verdict does not claim operational execution or consensus with another reviewer.
