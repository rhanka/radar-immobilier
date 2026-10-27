# Feature: PW-E combined write qualification

## Objective
- [ ] Qualify the combined PW-A/B/C/D candidate against conception v7:
  PWE-01 through PWE-12, HW-01 through HW-15, C01 through C12, M01 through M16.
- [ ] Require executed functional assertions, exact source/image identities,
  and zero required skipped cases before closing any qualification tranche.

## Scope / Guardrails
- [x] Base: delivered PW-C 37f21d3d82dffed1b51bec3f06632983cba0bd09.
- [x] Isolated local worktree: tmp/api-paniers-pwc/tmp/pwe.
- [x] Dedicated test/e2e ENV: test-api-paniers-pwe / e2e-api-paniers-pwe.
- [x] Ports: API 18935, UI 15935, Maildev 11935; ENV always last.
- [x] Make-only and container runtimes; no Python or environment-file reads.
- [x] Shared radar-docker-campaign.lock; wait for all foreign stacks.
- [x] Only owned resources removed; down -v --remove-orphans and release lock.
- [x] English Conventional subjects <=72 characters; no body or trailer.
- [x] At most 150 added/deleted lines per commit, selective staging and plan.
- [x] No push, production activation, migration renumbering or root UAT change.
- [x] Existing login/session only; exact identity domains; P never confirms.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: api/tests/integration/pwe-*.ts and e2e/tests/pwe/**.
- [x] Allowed: api/src/services/facets/pwe-*.ts and api/src/artifacts/pwe-*.ts.
- [x] Allowed: tools/make/base-api-pwe*, this plan and companion report.
- [x] Conditional: existing write-intent/facets primitives for a demonstrated
  blocking defect, with a recorded PWE-EXn and scoped regression evidence.
- [x] Conditional: API image/runtime bindings after a demonstrated gap and
  explicit CT-1 attribution; preserve API/MCP/content-reader/deny entrypoints.
- [x] Forbidden: Makefile, docker-compose*.yml, rules/**, agent instructions,
  other branch plans, api/drizzle/**, write-intent-transaction.ts.
- [x] Temporary container-only mutations restore original bytes before exit.

## Feedback Loop
- [x] Add isolated process-local consumption and autonomous bucket-quota
  variants; reject skipped selected mutant cases and retain their functional diagnostics.
- [x] Add exact confirm-field refusals and immutable-summary effects; isolate
  dispatch substitution, unknown BASE reason, autonomous consumption and audit mutants.
- [x] Cancel the queued campaign before adding required variants; no owned
  containers or test results existed for the cancelled wait.
- [x] Record empty-machine startup and monitor owner labels throughout the
  campaign; any foreign stack stops only this project and invalidates its gate.
- [x] Add app-specific old-6L1 receipt mutation and target the actual executor
  boundary on replay; preserve the full pre-fix source SHA in the regression receipt.
- [x] Verify composite audit command references resolve all three committed events.
- [x] Require five missing-receipt failures on the exact pre-fix route,
  then five restored passes and byte equality, before the final full campaign.
- [x] Lint every changed app/BASE read module; include the receipt-read audit scope.
- [x] PWE-EX2 includes the existing surface DB test: require the authorized
  receipt (section7.4), retain the no-challenge assertion and add masking after revoke.
- [x] Keep negative receipt diagnostics limited to public fields, excluding CSRF bytes.
- [x] Join the existing BASE receipt reader into a bounded read transaction,
  holding I/current-rights locks, auditing receipt reads and masking withdrawn rights.
- [x] App result GET returns the immutable receipt under its existing cookie guard;
  no P, old-6L1 comparison, challenge remint or writer is involved.
- [x] Add app receipt consultation after P/deadline expiry, consumed replay,
  no-op receipts and masking after approval/membership/moderation/intent withdrawal.
- [x] PWE-EX2: the authorized app result GET omits the immutable receipt
  (C08/section7.4), even after a committed command. Allow app-route,
  app-authority, app-result and the shared read-only signal receipt primitive.
  Impact: bounded owner/rights-checked reads only; no writer/session change.
  Rollback: revert the app-result regression and read integration together.
- [x] Preserve exact pre-fix app-route bytes from50a90b89 as a test vector
  for an explicit negative/positive DB proof, never as a product fallback.
- [x] Add explicit targeted mutation follow-up mode; reject empty selectors
  and preserve the complete API/inherited campaign as the final full gate.
- [x] Add separate RR snapshot, same-RP subject, M11 executor/receipt,
  M14 header/cookie and M15 reload/checkpoint/signature variants, with nonempty filters.
- [x] Spy on grant issuance in real TCP receipt recovery: status must never sign.
- [x] Preserve stale-response isolation when clearing request deadlines.
- [x] Replace the now-redundant duplicate-start mutant with a discriminating
  focus-reset variant; record original/effective runner hashes and exact changes.
- [x] Add both C04/C05 orders for freshness, atomic import/projection and
  repair transaction entrypoints; inventory confirms shared graph-store writers.
- [x] Fixed C12 gate: 33 passed/0 failed/0 skipped, typecheck/lint passed.
- [x] Add normal A-to-B login under one RP's existing keys; B cannot reveal
  I/A, while A's already-dispatched request retains its authenticated cookie.
- [x] Reproduce C12: 7 failed/1 passed/0 skipped on the original served
  script, with typecheck/lint green and owned cleanup complete.
- [x] Persist public per-I budget before dispatch; restore window/count,
  manual cooldown and request deadline; invalid/unavailable storage keeps polling closed.
- [x] Add checkpoint-write failure coverage and lint all three changed page files.
- [x] First combined campaign: 311 required passes/0 skips, API4474/0/76,
  68 inherited and31 new mutants killed/restored; all static/build gates passed.
- [x] PWE-EX1: reload and I-to-J-to-I reset the page's in-memory follow-up
  budget (C12/HW-11). Allow page.ts, page-budget.ts and its VM harness only.
  Impact: public counters across reload; no credentials or identity/session change.
  Rollback: revert the budget helper, integration and regression commits together.
- [x] Add individual M04 key/P/6L1/deselection, M07 three-scope, M08 head/version,
  M10 final cookie/challenge clock and M13 reader/workspace quota mutation legs.
- [x] Keep deselection digest fixtures schema-valid with their matching head keys.
- [x] Add current-6L1 head/version/catalogue refusals with zero durable effects,
  and separate key/P/6L1/deselection binding discriminators for mutation selection.
- [x] Expiry/quota run: 10 passed/0 failed/0 skipped; correct the evolving
  array annotation in the quota fixture before accepting the static gate.
- [x] Add shared no-op admission bursts across six P/grants/artifacts and
  across readers, replay without debit and accessible revoke after quota refusal.
- [x] Real TCP recovery gate: 1 passed/0 failed/0 skipped; typecheck/lint passed.
- [x] Add independent challenge/cookie expiry at I, BASE key, personal stream
  and final outbox SQL waits, using the normal callback cookie and controlled time.
- [x] C03 account/workspace and normal guard/remint cases passed; fix the
  TCP client's Host handling and explicit HTTP server type before requalification.
- [x] Add full/mutation campaign phases, with isolated evidence for each
  inherited A/B/C/D mutation suite and protected transaction byte checks.
- [x] Add a real TCP cut after the normal-cookie API commit, immutable H5
  receiver receipt despite stale 6L1, consumed replay and an executor spy.
  This API adapter test uses the synthetic P resolver and does not qualify images.
- [x] Add per-leg green/red/green mutation receipts; reject nonfunctional
  failures, empty selections and skipped selected cases; hash restored bytes.
- [x] Define separate verified-identity, normal-cookie, seven-fence,
  cross-process consumption, admission-debit and status-expiry mutation legs.
- [x] Add both C03 orders for account approval, membership and moderation,
  using public membership/capability revokers and the approval SQL row lock.
- [x] Normal guard run found the form oracle expected 403 while the contract
  returns typed 415 unsupported_media_type; assert the exact refusal and zero effects.
- [x] Normal /me remint, replica and revision reruns passed; typecheck/lint passed.
- [x] Add actual /me sliding remint from a callback-issued cookie; old CSRF
  fails, fresh GET/click succeeds, no PW GET mints and I/challenge stay immutable.
- [x] Add normal-callback cookie bearer rejection on all four app surfaces,
  independent Origin/CSRF/form/page-token refusals and valid confirm/revoke.
- [x] Allow a short normal-login session TTL and controlled application clock
  to exercise the real /me remint policy while the original intent stays valid.
- [x] C01/C04/C09/C10 scoped run: 21 passed/0 failed/0 skipped; correct the
  union-promise fixture type and rerun the static gate before acceptance.
- [x] Expose the actual identity fixture application for normal-cookie guards.
- [x] Add C09 shared-lock status reads during commit/rollback; expiration
  after the wait cannot overwrite a committed result or settle prematurely.
- [x] Add rollback after each of three composed discard events, preserving
  both selected heads and all receipts/revisions until the atomic retry succeeds.
- [x] Add seven C10 SQL-trigger failure stages with whole-row rollback,
  zero durable admission effects and a single successful retry after restoration.
- [x] Add both C04 orders for personal/common/source revisions and private B;
  confirm holds the validated scope until commit and stale tokens cannot append.
- [x] Add real personal/common/source writer fixtures with a transaction
  barrier before commit, preserving the public writer implementation.
- [x] First replica run: 2 passed/0 failed/0 skipped; fix the optional IPC
  disconnect type before accepting the static gate; rerun remains required.
- [x] Add C01 commit/rollback variants using two real child processes,
  separate pools, SQL wait observation and exact effect/rollback counters.
- [x] Add an IPC-controlled replica worker with its own database pool.
- [x] Verified identity gate: 3 passed/0 failed/0 skipped; typecheck/lint passed.
- [x] Add HW-04 same-sub issuer/tier cases from actual callback sessions and
  verified grants, testing the comparator before foreign-cookie rejection.
- [x] Persist intents from verified grants following normal callback sessions,
  with separate SQL stores and per-domain session/write/challenge key references.
- [x] Scoped C03/C07 gate: 18 passed/0 failed/0 skipped, typecheck/lint passed.
- [x] Add normal authRoute login/code+PKCE/callback/signature/session fixture;
  no flow cookie or application principal is manufactured by the test.
- [x] Add C07 concurrent equal/different/P preparation and renewed-grant retry;
  the winning P, durable challenge and original deadline cannot change.
- [x] Scoped C02 gate: 3 passed/0 failed/0 skipped, typecheck and lint passed.
- [x] Add C03 both orders for tier, policy, release, delegation, reader,
  grant and page-session fences, with observed waits and durable-effect counts.
- [x] Scoped C01 gate: 2 passed/0 failed/0 skipped, typecheck and lint passed.
- [x] Add C02 both orders, confirmation rollback and stable repeated revoke.
- [x] Add C01 commit/replay and rollback-winner tests with two connections,
  observed blocking and exact durable effects before and after admission.
- [x] Add durable PW-D/BASE fixtures, bounded SQL barrier observation and
  exact receipt/consumption/admission/audit/outbox effect counters for races.
- [x] Run migration bootstrap from the API directory; the first runner
  invocation stopped before test collection on its relative journal path.
- [x] Reject empty/missing required files, failed suites and every required skip.
- [x] Add isolated source snapshots, offline tools and explicit lock release.
- [ ] Runtime prerequisite: content-reader and index omit H5/read/write
  bindings; HW-01/HW-15/CT-9 require actual network integration, not fixtures.
- [x] Add selective commit and prerequisite-only incremental bundle auditing.
- [x] Owner requested final PW-A integration before PW-E; intermediate bundle
  and report delivered, with 65 unit, 9 PG, 4396 API passes and 25 mutant kills.
- [x] Read conception sections 7.4-7.9, CT-1-CT-9 and the full PW-E matrices.
- [ ] Map every requirement to its exact assertion and observed evidence.
- [ ] Recheck approved PW-A migration numbering before final image campaign.

## Orchestration Mode (AI-selected)
- [x] Dedicated PW-E branch; preserve the delivered PW-C ref and bundle.
- [x] Serial Docker campaigns under the shared lock; no foreign cleanup.

## UAT Management (in orchestration context)
- [x] Automated browser qualification on test images; root dev remains stable.

## Plan / Todo (lot-based)
- [ ] PWE-01: published page, six operations, readback and executor counts.
- [ ] PWE-02: two HTTPS hosts, normal login, cookies and P-to-A navigation.
- [ ] PWE-03a: verified same-sub/different-issuer/tier credentials and bearers.
- [ ] PWE-03b: independent Origin, CSRF, remint and summary guards.
- [ ] PWE-04: concurrent confirms, rollback winner and prepare idempotence.
- [ ] PWE-05: both revision orders, private reader, fresh snapshot and sources.
- [ ] PWE-06: both revocation/authority orders and management after rights loss.
- [ ] PWE-07: independent expiry waits and complete transactional rollback.
- [ ] PWE-08: lost response, status contention, P expiry and immutable receipt.
- [ ] PWE-09: shared admission/audit/outbox/quotas and bounded browser polling.
- [ ] PWE-10: independently killed/restored authority mutants M01-M05/M09.
- [ ] PWE-11: independently killed/restored transaction mutants M06-M13.
- [ ] PWE-12: browser/error mutants M14-M16 and exact-image CT-9 gates.
- [ ] Gate: typecheck, targeted lint, scoped tests and complete API CI.
- [ ] Gate: HW-01-HW-15, C01-C12 both orders and all individual M01-M16 legs.
- [ ] Gate: fresh/upgrade/rerun migrations and unchanged applied prefix.
- [ ] Delivery: incremental bundle, prerequisite-only audit and French report.
