# Feature: Published reader write integration

## Objective
- [ ] Connect the real L3 published reader to PW prepare, polling and explicit application confirmation; finish PW-E on final runtime images.

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
- [x] Lot 0: merge approved PW-A and main; preserve Track event blob identity.
- [ ] Lot 1: bind verified approval provenance, explicit release write request and private page bootstrap.
- [x] Implementation and targeted PG proof: actual one-use ticket provenance, explicit workspace, matching signed read grant and no publisher privileges.
- [ ] Lot 2: wire listener, H receiver and application confirmation using existing PW/BASE contracts.
- [x] Corrected PW-C script is served by the published runtime; private P instance/CSRF and canonical HTML recovery links are wired.
- [ ] Lot 3: lock actual artifact authority in prepare/admission/disclosure; qualify discriminating failures and races.
- [x] Actual SQL ACL withdrawal, lost-response receipt recovery and technical owner revocation pass in the deployed image.
- [ ] Lot 4: PostgreSQL, API CI, required matrices and mutations on merged candidate without required skips.
- [ ] Lot 5: exact runtime image, real OIDC browser, persisted published page read/prepare/app-confirm and CT-9.
- [x] Image candidate c8d42b5c: ten browser cases pass without skips on same-site/cross-site hosts, including six operations and BASE/read closure variants. Final HEAD replay remains required.
- [x] Three inherited published-read cases are selected explicitly; their TLS helper now receives the archived OpenSSL executable and libraries in the disposable browser runner.
- [x] Browser campaign 20261028T070555 on 46b4917d: ten real-image cases plus three inherited read regressions pass, no required skips; CT-9 covered on both hosts.
- [ ] Astra r2b: isolate asynchronous reread ownership, bound reads/body consumption, and cover terminal HTML under current rights.
- [x] Seven deterministic r2b reproductions fail on unchanged runtime (071040-pg); reads now bound fetch plus JSON consumption and reject obsolete gesture display updates.
- [x] Terminal status stops its own budget before rereading; continuation versions and request ownership prevent late I from stopping J, clearing J's request or replacing J's display.
- [x] Terminal HTML regressions cover committed, revoked and committed-then-revoked documents: original receipt under current rights, distinct execution/revocation, no confirmation/challenge, no receipt after membership withdrawal.
- [ ] Lot 6: audit own commits, incremental bundle from 37f21d3d, French L5/PW-E final report and cleanup receipts.
