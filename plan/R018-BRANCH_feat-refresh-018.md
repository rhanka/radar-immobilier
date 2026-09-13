# Feature: Complete the existing Graphify 0.18 Kubernetes refresh

## Objective
- [ ] Deliver autonomous PV-to-typed-Signal refresh with exact PDF evidence, reusing i-cond's existing work.

## Scope / Guardrails
- [x] Worktree `tmp/refresh-018`, branch `feat/refresh-018`, base `097036783006226afea53a6b49383bf70890774f`.
- [x] Make-only, Docker-first; preserve root UAT and all existing lanes.
- [x] Test environment `test-refresh-018`; API_PORT=8881 UI_PORT=5381 MAILDEV_UI_PORT=1181. Check port ownership before starting services; no root dev services.
- [x] No credentials in reports, prompts, logs or Git; no production writes by delegates.
- [x] Graphify 0.18.0 is published; direct Immo chat mesh migration and a new network mesh service are out of scope.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed: `plan/R018-BRANCH_feat-refresh-018.md`, `docs/spec/SPEC_EVOL_REFRESH_018.md`, `docs/reviews/refresh-018/**`.
- [x] R018-EX1 — owner-requested build released after Fable GO_WITH_CHANGES; exact C01–C14 paths below. Impact: isolated application/dependency/tests only; rollback: revert branch commits; no deployed state changes.
- [x] R018-EX2 — owner-approved single 2,157-line generated dependency-pair exception for Graphify 0.18.0 plus the refresh mesh 0.19.0 alias, preserving chat mesh 0.1.2; rollback: revert `api/package.json` and `package-lock.json` together.
- [x] Allowed C01–C14: `api/package.json`, `package-lock.json`; `api/src/services/graph/refresh-{mesh,corpus,profile,v23,state,run}.ts`; `api/src/services/graph/refresh-{mesh,corpus,profile,v23,state}.test.ts`; `api/tests/fixtures/refresh-018/oracle.json`; `api/tests/integration/refresh-018.spec.ts`; `api/src/scripts/refresh-pv.ts`. Braces enumerate exact filenames, not open globs.
- [x] Forbidden: root `Makefile`, `docker-compose*.yml`, `rules/**`, agent entrypoints, `.track/**`, other branch plans, other repositories.
- [x] Conditional: C15–C25 remain unreleased until slice tests/reconciliation; Kubernetes operations remain conductor-only. Existing canonical writer, graph store and enrichment are read-only reuse unless a precise amendment is recorded.

## Feedback Loop
- [x] Owner routing: Astra design, Gemini 3.8 High pre-build review via h2a run agy, Sol xhigh build, Gemini 3.8 High post-build review. This is the requested review circuit, not a claim of the skill's two-host consensus.
- [x] September 13 owner amendment: keep independent review; Fable 5 may replace unavailable Gemini. Delegate development to Sol immediately after reconciliation; the owner did not waive review.
- [x] Fable F1–F4 accepted: public prep composition instead of unexported runConfiguredDataprep; cross-instance mesh probe; published schema-forwarding probe; explicit projection abort/refusal propagation. No new architecture or producer wait.
- [x] Native Sol developer `/root/t1_build` replaces failed h2a developer launch (missing runtime package); Fable review remains a distinct Claude-hosted leg. Do not stage reviewer files from the build worker.
- [x] Disjoint secondary Sol owns C06–C07 profile source/test/oracle only, with no Git, plan or shared-service operations; `/root/t1_build` retains integration and index ownership.
- [x] Report to `codex:radar-immobilier:98cef8dfc274`, loop `loop:immo-transitions-2026-09-13`; do not mark the overall loop done.

## Orchestration Mode (AI-selected)
- [x] One writer at a time; design, review and build are separate bounded mandates.

## UAT Management
- [x] No root checkout switch or root UAT mutation by delegates.

## Plan / Todo (lot-based)
- [x] Lot 0: identify exact existing consumer/runner/canonical writer/projection/3.4 contracts and reusable CAS work; evidence and decisions in `docs/spec/SPEC_EVOL_REFRESH_018.md`.
- [x] Lot 1: deliver numbered continuation decisions, proposed exact build paths/commit caps and acceptance gates in `docs/spec/SPEC_EVOL_REFRESH_018.md` and `docs/reviews/refresh-018/build-handoff.md`; static design only.
- [x] Lot 1 gate: report first design handoff through h2a for independent Gemini review; package, typed Signal/PDF and scheduled-run acceptance remain unexecuted.
- [x] Scope release: conductor reconciled Fable findings and released exact C01–C14 with the corrections in `docs/reviews/refresh-018/build-handoff.md`; no further owner vote required for this code scope.
- [x] Lot 2: Fable independent design review GO_WITH_CHANGES and conductor reconciliation; evidence `docs/reviews/refresh-018/fable-design.md` at target ca7d9acf. One reviewer, no two-peer consensus claim.
- [x] Persist the completed independent Fable review and its unchanged findings in version control.
- [x] Preserve the review's detailed verification appendix and the original-PDF page-3 oracle, with immutable source hashes.
- [x] Record the failed Gemini leg, authorized Fable replacement and refreshed Immo preprod read-only evidence; no deployment inferred.
- [ ] Lot 3: Sol builds the released scope with isolated tests and atomic commits.
- [x] C02: compose the public owner-scoped Graphify mesh with explicit refresh adapters, model and run abort signal.
- [x] C03: prove schema/token forwarding, three-copy mesh interop, owner isolation, classified failure, abort propagation and log silence.
- [x] C04a: define strict immutable-manifest, original-page and bounded UTF-8 corpus chunk contracts.
- [x] C04b: materialize selected PDF bytes and metadata with checksum, page-text and input-hash validation.
- [x] C04c: retain explicit physical-page markers inside bounded profile prompt chunks.
- [x] C05: cover checksum/path/duplicate refusal, physical pages, changed input identity and bounded UTF-8 chunks.
- [x] C06: compose public profile/config/registry exports and require strict validated completion for every chunk.
- [x] C07: freeze the Waterloo page-3 oracle and cover typed evidence, wrong-page, partial and scanned-input refusal.
- [x] C08: port baseline-first v2.3 mapping with exclusions and exact original-PDF references on nodes and edges.
- [x] C09: cover stable IDs, baseline/exclusion/source preservation, wrong-page refusal and 3.4 field derivation.
- [x] C10a: persist canonical run identity and conservative maximum-attempt chunk reservations in S3.
- [x] C10b: persist immutable candidate hashes and redacted per-city stage receipts in S3.
- [x] C10c: retain and hash-check durable per-chunk extraction artifacts for partial-run resume.
- [x] C10d: retain the first run timestamp so resumed candidates remain deterministic.
- [x] C10e: discover same-input state only while its published bytes remain canonical.
- [x] C11: cover same-input no-call resume, conservative interruptions, baseline changes and failed-write receipts.
- [x] C12a: adapt one successful existing acquisition recap into a strict immutable PDF manifest.
- [x] C12b: compose resumable profile extraction, v2.3/3.4, guarded publish and atomic projection.
- [x] C12c: resume post-publication projection without repeating same-input extraction.
- [ ] Lot 4: Gemini independent post-build review; fix verified findings.
- [ ] Lot 5: conductor-controlled preprod end-to-end and scheduled refresh acceptance, then gated production promotion.
- [ ] Lot 6: synchronize architecture reference and monthly evidence with actual transition state.

## Merge / Close
- [ ] CI and live acceptance evidenced; conductor integrates by merge commit only, preserving branch history.
