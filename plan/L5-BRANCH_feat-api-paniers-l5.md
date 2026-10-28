# Feature: Published reader write integration

## Objective
- [ ] Connect the real L3 published reader to PW prepare, polling and explicit application confirmation; finish PW-E on final runtime images.

## Scope / Guardrails
- [x] Owner authorizes L5, PW-E completion and upstream merges; no push, no new login/session category, no BASE reimplementation.
- [x] Frozen imported base: 5dc6fa3da80da35f7ca9536bdd8323854647726e, including PW-E c276209c, PW-A cfb3ecfe and main 62dd3553.
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
- [ ] Lot 2: wire listener, H receiver and application confirmation using existing PW/BASE contracts.
- [ ] Lot 3: lock actual artifact authority in prepare/admission/disclosure; qualify discriminating failures and races.
- [ ] Lot 4: PostgreSQL, API CI, required matrices and mutations on merged candidate without required skips.
- [ ] Lot 5: exact runtime image, real OIDC browser, persisted published page read/prepare/app-confirm and CT-9.
- [ ] Lot 6: audit own commits, incremental bundle from 37f21d3d, French L5/PW-E final report and cleanup receipts.
