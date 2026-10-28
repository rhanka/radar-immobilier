# Feature: Published reader write integration

## Objective
- [x] Connect the real L3 published reader to PW prepare, polling and explicit application confirmation; finish PW-E on final runtime images.

## Scope / Guardrails
- [x] Owner authorizes L5, PW-E completion and upstream merges; no push, no new login/session category, no BASE reimplementation.
- [x] Frozen imported base: 5dc6fa3da80da35f7ca9536bdd8323854647726e, including PW-E c276209c, PW-A cfb3ecfe and main 62dd3553.
- [x] Qualified PW-C handoff: 8d86392a; merge 1a9a8c8e. Current PW-A be3e06c4 and main 26a78195 imported by merges 09498fe8 and 8ea25cc5.
- [x] Track event blob remains identical (5be59da6) across all imported parents and merge results; no acceptance freshness is claimed.
- [x] Merge resolutions preserve L3 release serving, actual read dispatch, mandatory P proofs, closed reply projection and fresh BASE reads.
- [x] Repository-local worktree tmp/l5; Make only, ENV last, no environment-file reads or host Node/Python.
- [x] Test environments test-api-paniers-pwe and e2e-api-paniers-pwe; API 18935, UI 15935, Maildev 11935.
- [x] Shared Docker lock, wait for foreign stacks, one owned stack, down -v --remove-orphans and release lock.
- [x] English Conventional subjects <=72 characters, no body/trailer; own commits <=150 changed lines.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed Paths: api/src/artifacts/**, api/src/index.ts, api/src/services/facets/pw-write-fences.ts, api/tests/integration/l5-*.ts, tools/make/base-api-l5*, plan/L5-BRANCH_feat-api-paniers-l5.md.
- [x] Forbidden Paths: api/src/artifacts/write-intent-transaction.ts, api/drizzle/**, Makefile, docker-compose*.yml, rules/**, agent bootstrap files, other branch plans, .track/**.
- [x] Conditional Paths: none; upstream merge imports are preserved and audited separately from own changes.

## Feedback Loop
- [x] Two independent read-only design reviews: authority/provenance and runtime-image/browser evidence.
- [x] Existing P gains additive approval-time provenance; old P remains read only. Read grants/profile remain unchanged.
- [x] Release write declaration is a request under server policy, never author privileges. Actual SQL authority is locked through BASE admission.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; independent design reviewers do not write or run Docker.

## UAT Management (in orchestration context)
- [x] Automated browser qualification only; root UAT and dev data remain untouched.

## Plan / Todo (lot-based)
- [ ] PR 938 second pass: current page disclosure rights after waits, post-commit application disclosure, renewable read grants, bounded application POSTs/bootstrap, targeted regressions and exact-image browser qualification.
- [x] Reproduce post-COMMIT continuation withdrawal with actual PostgreSQL membership, artifact ACL and moderation changes; retain exactly one committed command.
- [x] Add exact-served-script reproductions for suspended application confirmation/revocation and L5 bootstrap, covering transport and JSON body separately.
- [x] Refresh fixture 6L1 after granting moderation; type the shared prepare port with the six-operation contract. Initial campaign reproduces membership/ACL disclosure and all six missing browser deadlines.
- [x] Add controlled-clock page regressions for grant recovery before a new gesture and committed state/search refresh beyond 55 seconds; refusal must create no new intent.
- [x] Specify read-only sealed-P recovery boundaries: exact pinned host, reader/session/artifact/profile, current ACL, same-origin POST and unexpired P; an explicitly invalid grant never falls back implicitly.
- [x] Both page-status withdrawals reproduce on the unchanged runtime (103331-pg). Reuse the application disclosure guard after the final P resolution with workspace/approval locks and operation-specific moderation.
- [x] Confirmation discards the execution return value and consults the durable result after COMMIT under current rights. Withdrawal preserves committed technical state without disclosing a business receipt or rerunning the command.
- [x] Application POSTs bound fetch plus JSON to 15 seconds, release controls and expose same-intent recovery on uncertainty; late replies cannot update the document. Technical committed state renders without an empty business receipt.
- [x] L5 bootstrap bounds fetch and body consumption to 15 seconds before installing any script/bootstrap node; late transport/body completion cannot install write controls.
- [x] Each demanded PW read renews the read grant; a 401 explicitly retries cookie-only recovery under the existing sealed pinned P and current reader authority. One 15-second deadline covers renewal/recovery/read and bodies; polling never extends P or write authority.
- [x] Scoped qualification explicitly lints every second-pass runtime change and new regression; retain original required matrices without rerunning unrelated API/mutation campaigns.
- [x] Targeted replay 103641-pg: 44/46 pass; page withdrawals are masked but the BASE refusal normalizer maps authority-unavailable to 503. Use the established capability-required 403 refusal for current-rights denial; remove one unused test constant.
- [x] Exact-image browser transport can suspend either headers or JSON after draining a real runtime response; this fault injection changes no product authority or executor.
- [x] Browser expiry cases observe the real server JWT cutoff before preparing and before confirming, with normal OIDC/P, exactly one command, recovered BASE state/cards/counts and both 401/200 renewal responses.
- [x] Browser deadline cases use a controlled browser clock, real runtime commits and suspended TLS headers/body: same-intent receipt recovery, released controls and settled bootstrap with no installed write reader.
- [x] Browser status case commits a workspace discard, withdraws moderation while preserving membership and observes a receipt-free 403 on P; explicit authorized restore returns the fixture to its original archive state.
- [x] Second-pass delivery gate requires current source identity, all required files without skips, touched reader tests, 27 browser cases on exact HEAD images, both host cleanups and a main-only import of the named branch ref.
- [x] Lot 0: merge approved PW-A and main; preserve Track event blob identity.
- [x] Lot 1: bind verified approval provenance, explicit release write request and private page bootstrap.
- [x] Implementation and targeted PG proof: actual one-use ticket provenance, explicit workspace, matching signed read grant and no publisher privileges.
- [x] Lot 2: wire listener, H receiver and application confirmation using existing PW/BASE contracts.
- [x] Corrected PW-C script is served by the published runtime; private P instance/CSRF and canonical HTML recovery links are wired.
- [x] Lot 3: lock actual artifact authority in prepare/admission/disclosure; qualify discriminating failures and races.
- [x] Actual SQL ACL withdrawal, lost-response receipt recovery and technical owner revocation pass in the deployed image.
- [x] Lot 4: PostgreSQL, API CI, required matrices and mutations on merged candidate without required skips.
- [x] Lot 5: exact runtime image, real OIDC browser, persisted published page read/prepare/app-confirm and CT-9.
- [x] Image candidate c8d42b5c: ten browser cases pass without skips on same-site/cross-site hosts, including six operations and BASE/read closure variants. Final HEAD replay remains required.
- [x] Three inherited published-read cases are selected explicitly; their TLS helper now receives the archived OpenSSL executable and libraries in the disposable browser runner.
- [x] Browser campaign 20261028T070555 on 46b4917d: ten real-image cases plus three inherited read regressions pass, no required skips; CT-9 covered on both hosts.
- [x] Corrected runtime f0597917 passes all thirteen browser cases (090811-images); preserve each host's cleanup log separately from the idempotent EXIT cleanup before final proof aggregation.
- [x] Bound service shutdown after completed assertions to two seconds; observed 25-second Compose stop exceeded the unchanged 20-second teardown barrier. Do not extend test deadlines.
- [x] Astra r2b: isolate asynchronous reread ownership, bound reads/body consumption, and cover terminal HTML under current rights.
- [x] Seven deterministic r2b reproductions fail on unchanged runtime (071040-pg); reads now bound fetch plus JSON consumption and reject obsolete gesture display updates.
- [x] Terminal status stops its own budget before rereading; continuation versions and request ownership prevent late I from stopping J, clearing J's request or replacing J's display.
- [x] Terminal HTML regressions cover committed, revoked and committed-then-revoked documents: original receipt under current rights, distinct execution/revocation, no confirmation/challenge, no receipt after membership withdrawal.
- [x] Targeted replay passes all seven suspended-read reproductions and 23 existing page regressions; terminal tests check issued challenge bytes/private bootstrap rather than a reference in the shared script.
- [x] Lot 6: audit own commits, unique combined bundle from main 26a78195, French combined delivery report and cleanup receipts.
- [x] Qualified 86a0f3bf: 397 required, 4712 API (79 conditional skips), 139 killed/restored mutants, three nginx and thirteen browser cases. Main-only bundle import, HEAD/tree and fsck pass; root delivery report rendered. The bundle gate requires fresh exact-HEAD images after this documentation commit.
- [x] Owner final delivery scope supersedes the earlier 37f21d3d bundle base; fetched main remains 26a78195 and is already an ancestor.
- [x] Qualification explicitly lints the new read/HTML regressions; inherited stale-status mutation retains its fault at the versioned continuation boundary. Global API uses two isolated workers in one owned stack.
- [x] Targeted lint includes the merged L3 content-serving composition in addition to the published runtime and all r2b changes.
- [x] Retain 43 completed/restored A/B/D mutants from 083531 before intrusion; wrapper failure remains explicit and must agree with batch receipts. Qualify missing C/E/review/L5 groups separately, never accept a partial group.
- [x] Correct the mutation adapter's no-regex-spaces lint finding before restarting final qualification; no runtime change.
- [x] Repeated foreign probe intrusions are retained and discarded as full qualifications; retries wait for the shared locks and an empty Docker machine without any departure deadline or foreign cleanup.
- [x] Candidate d9e0d16e: typecheck/lint/build, CT-8 and 397 required cases pass with zero skips before intrusion in 072553-full. Retain these completed components; rerun API CI and mutations separately.
- [x] Recover verified owned resources under the radar lock before waiting for Docker; interrupted runner leftovers cannot deadlock the controller's empty-machine wait. Remove the extra stability delay, retaining all owner lock/isolation checks.
