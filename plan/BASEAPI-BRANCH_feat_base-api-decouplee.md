# Feature: Independent BASE API and database activation

## Objective
- [ ] Deliver the existing signal, workspace and lot behavior through an autonomous API.
- [ ] Qualify and activate BASE without requiring MCP, artifacts, H5 or a new Sentropic package.

## Scope / Guardrails
- [ ] Authority: the owner's recorded requests and approved proposition-base.md, lots B0–B5.
- [ ] Baseline: feat/base-api-decouplee at 9a81508704b8ee247e3d402f9cbf15d458edfe2a.
- [ ] Integration workspace: /home/antoinefa/src/radar-immobilier/.worktrees/base-api.
- [ ] Retain independent signal baskets, separate archive scopes and existing lot capabilities.
- [ ] Personal restoration never lifts common hiding or recreates a removed selection.
- [ ] Keep mandatory lot discard reasons and the existing lettre_envoyee meaning.
- [ ] Use the recommended maintenance-window activation; keep all four owner choices OPEN.
- [ ] Never read .env or .env.*, client inputs, client reports, operational data or credentials.
- [ ] Use synthetic fixtures, isolated PostgreSQL and mocked external HTTP only.
- [ ] Use standalone Make targets: the root Makefile includes .env at line 3.
- [ ] Use containers; prefix shell commands with rtk; put ENV last in every Make command.
- [ ] Zero Python: no Python execution on the host or in containers, including tooling, tests and cleanup.
- [ ] On success, failure, INT or TERM, capture evidence and clean only the runner-owned disposable test-* or e2e-* project; preserve the original failure/signal status.
- [ ] Any down -v requires a validated ENV, explicit project identity and verified resource ownership; never target dev, shared/external volumes or another chain.
- [ ] If cleanup fails or interruption prevents it, report residual resources and use the same guarded Make cleanup on retry; never claim a clean PASS.
- [ ] Each authored slice is at most 150 added-plus-deleted lines and 15 files, including tests and plan updates.
- [ ] Muse builds one slice; Sol verifies and commits it before the next slice accumulates.
- [ ] Commit subjects are English Conventional Commits, at most 72 characters, without body or trailers.
- [ ] Record actual slice sizes; planned sizes and executable results remain unverified until measured.

## Branch Scope Boundaries (MANDATORY)
- [ ] Allowed: this plan; docs/spec/SPEC_EVOL_BASE_API.md; docs/spec/SPEC_BASE_API.md.
- [ ] Allowed: docs/spec/BASE_API_ACTIVATION.md; tools/make/base-api*; local tmp/base-api-* evidence.
- [ ] Allowed: api/src/services/facets/**; their synthetic tests; api/tests/integration/base-api*.
- [ ] Allowed: api/src/scripts/base-api-personal-activation.ts, only for B4's 6H activation/resume entry point.
- [ ] Allowed: api/src/routes/workspaces.ts; scoped-signal-facets*; scoped-workspace-archive*.
- [ ] Allowed: api/src/routes/scoped-signal-reveal.ts; use this exact name in B0's contract and B1's mount/tests.
- [ ] Allowed: api/src/routes/scoped-projection-*; scoped-lot-*; signal-facets*; graph-signals*.
- [ ] Allowed: api/src/services/geo/{ogc-pull,populate-geo}.ts and focused source-lock tests.
- [ ] Allowed: api/src/services/exploitation/projection.ts and focused source-lock tests.
- [ ] BASE Sol A-owned: api/src/db/schema.ts; api/src/app.ts, api/src/index.ts and api/drizzle/** are subject to the exclusive cross-track CT-1 lease.
- [ ] BASE Sol A-owned: tools/make/paniers-lot6.mk; tools/make/paniers-lot6-verify.sh.
- [ ] Conditional: api/src/routes/auth.ts and existing auth tests, only for evidenced BASE composition defects; auth.ts also follows CT-1 if both tracks touch it.
- [ ] Conditional: legacy delivery paths in routes/chat.ts, routes/prospect-marks* and services/chat/stream-bus*.
- [ ] Conditional inherited-only: the pinned 6K plan, tooling and UI changes; no additional UI work.
- [ ] Forbidden: root Makefile; docker-compose*.yml; rules/**; AGENTS.md; CLAUDE.md; GEMINI.md.
- [ ] Forbidden: MCP/artifact implementation changes, new dependencies, client files and historical SQL rewrites.
- [ ] Forbidden: other branch plans except unchanged inherited 6K history; root checkout writes; production actions.
- [ ] Declare any further scope exception with evidence, impact and rollback before changing its paths.

## Feedback Loop
- [ ] BRBASE-EX1: retain the owner-specified .worktrees/base-api integration lane; impact is workspace location only; rollback is removal after delivery.
- [ ] BRBASE-EX2: import existing 6K history at 3c6d3c1f95d6794ba0939cf71db6b169cb3f071d, including 0022 and 0023; preserve inherited SQL bytes/hashes; only unpublished, unapplied journal suffix metadata may change under CT-5–CT-7.
- [ ] BRBASE-EX2 impact: inherited schema, retirement paths, tooling and UI enter with provenance; rollback before activation by reverting integration.
- [ ] BRBASE-EX3: retire legacy delivery paths required by B1/B4; preserve unrelated notes, contacts and chat behavior; rollback only before epoch change.
- [ ] OPEN O1: maintenance window is the execution default; continuous coordination is outside this delivery.
- [ ] OPEN O2: lot discard reason remains mandatory.
- [ ] OPEN O3: keep lettre_envoyee; no new a_lettre state or historical event relabeling.
- [ ] OPEN O4: retain independent signal baskets and separate archive state.
- [ ] D1–D4 remain ratified as recorded in the proposal; concrete operational values remain unverified.
- [ ] D5 applies only to actual manifest conflicts; never invent dispositions or suppress unresolved history.
- [ ] After scoped epoch activation, recovery is protected forward resume, never restoration of legacy authority.
- [ ] CT compatibility: pinned 6K api/src/services/facets/lots/lot-cutover-journal-db.test.ts:29–31 requires adjacency, incompatible with ARTEFACTS-first at lines 29–30; BASE Sol A qualifies relative prerequisite order in B2.1 under unchanged CT-7 before releasing K_SHA.
- [ ] CT compatibility: packages/immo-mcp/src/data-source.ts:316 calls the route retired by B1.6; BASE supplies the retirement contract, ARTEFACTS owns adapter requalification under unchanged CT-3/CT-9 before combined delivery; no MCP implementation enters BASE.

## Orchestration Mode (AI-selected)
- [x] Multi-branch: B0 first, then two independent Muse → Sol chains.
- [ ] Chain A: tmp/base-api-b1, branch feat/base-api-decouplee-b1; B1, then B4.
- [ ] Chain B: tmp/base-api-b2, branch feat/base-api-decouplee-b2; B2, then B3.
- [ ] Sol A is the BASE integrator for its integration workspace; cross-track shared writes require the current conductor-recorded CT-1 lease, with no independent concurrent write right. Muse/Sol B submit shared-file hunks.
- [ ] Start B1 nonshared work while the integrator performs B2's pinned 6K import; release B2 from that qualified integration SHA.
- [ ] Import the same integration SHA into B1 before its app/startup wiring; preserve main's 6L2 additions.
- [ ] Integrate through merge commits, preserving source history; no squash, cherry-pick or whole-file ours/theirs resolution.
- [ ] Each chain edits only its own plan checkboxes; the integrator reconciles both sets without losing either.
- [ ] B4 development follows B1/B2; final B4 qualification also requires B3; B5 follows B3/B4.
- [ ] CT-1 — BASE/ARTEFACTS shared-write rule: one conductor-recorded lease holder at a time edits `api/src/app.ts`, `api/src/index.ts` and `api/drizzle/**` across both tracks; include `auth.ts` if both tracks touch it. Neither lane's integrator has an independent concurrent write right.
- [ ] CT-2 — Each lease records holder, receiving branch/HEAD, both input SHAs, exact hunks, migration reservations, tests and resulting commit. The next holder acknowledges that receipt. Nonshared work continues; joining the histories uses merge commits, never whole-file ours/theirs or copied commits.
- [ ] CT-3 — Preserve both sets of mounts/startup dependencies and middleware order: content-host isolation first, control cookie guard, then authenticated business routes; keep H4 and H5 identities distinct. Requalify the named signals API adapter if BASE retires its route; do not reopen a retired route.
- [ ] CT-4 — Reserve `0022_facet_lot_cutover.sql` and `0023_facet_lot_versions_fence.sql` for BASE's pinned 6K import. Allocate artifact technical files from the next globally unreserved number, at least 0024; reservation alone is not migration-order proof. Preserve inherited SQL bytes and hashes.
- [ ] CT-5 — Use the existing common Drizzle journal/migrator. The lease holder assigns each unreleased suffix entry a unique tag and sequential idx, with when greater than the maximum existing journal/applied timestamp. Preserve the applied prefix; never renumber, retime or replace an applied/released entry or edit database migration history.
- [ ] CT-6 — BASE-first is permitted: append artifact entries after the fixed BASE prefix. ARTEFACTS-first is permitted without importing or applying 6K: release its technical suffix on the current baseline, then register still-unreleased BASE entries after that suffix, retaining 0022/0023 SQL bytes and their relative order. Their original lower timestamps must not be inserted behind an already-applied artifact suffix.
- [ ] CT-7 — Freeze one journal order before first persistent use across the target release chain. Reindex/retime only unpublished, unapplied suffix metadata, with provenance; a branch commit or disposable test DB is not a deployment release; BASE owns qualifying its migration assertions by relative prerequisite order rather than obsolete adjacency. If 6K metadata is already immutable, retain its prefix and refuse an incompatible combined upgrade; do not invent a history repair. Applied/deployed state is unverified until an operator receipt.
- [ ] CT-8 — Qualify a standalone delivery on fresh DB, its baseline upgrade and rerun using only its own migrations. Before a combined delivery, also qualify baseline-to-first-track-to-combined with its frozen journal: every expected SQL hash occurs once, none is skipped, technical/business data survive. Alternative orders need their own pre-release qualification. Serialize migration jobs per target DB; never wait for the other track to qualify a standalone delivery.
- [ ] CT-9 — After joining histories, test the exact combined SHA/image: both mount sets, auth/session and 6L2 regressions, BASE with artifacts off, artifacts without optional business capabilities, two-reader API proof and migration history. A shared-image update must retain already-delivered capabilities; no stale branch image may overwrite them. Schema coordination never requires 6K business activation or makes MCP/H5 a BASE prerequisite.

## UAT Management (in orchestration context)
- [ ] BASE acceptance uses HTTP/PostgreSQL with artifacts disabled; no UI deliverable or artifact acceptance prerequisite.
- [ ] Keep root dev/UAT unchanged; operational activation is a separate maintenance-window execution.

## Plan / Todo (lot-based)
- [ ] B0 — BASE contract; Muse 1–2 h, Sol 1 h, total 2–3 h.
  - [ ] B0.1: establish standalone Make entry points, isolated verification and bounded delivery; qualify zero-Python execution and cleanup after success, failure and interruption.
  - [ ] B0.2: commit this plan and branch/path ownership; bind every packet to CT-1–CT-9 and record BASE Sol A's lease/handoff duties.
  - [ ] B0.3: document reads, reveal, reason catalog, workspace context, heads and revisions.
  - [ ] B0.4: document commands, idempotency, expected heads, displayed versions and errors.
  - [ ] B0.5: freeze the existing authority matrix and independent HTTP/SQL acceptance cases.
  - [ ] Gate: contract traced to code; open defaults visible; no artifact dependency; safe runner and bundle audit qualified.
- [ ] B1 — Signal/workspace API; Muse 3–5 h, Sol 3–4 h, total 6–9 h.
  - [ ] B1.1: mount workspace, personal, common-archive, revision and invalidation routers.
  - [ ] B1.2: constrain middleware to its intended endpoints; preserve cookie writes and supported bearer reads.
  - [ ] B1.3: expose workspace context and reason codes without legacy readers.
  - [ ] B1.4: implement authorized reveal with current content, fingerprint and scoped heads.
  - [ ] B1.5: qualify reveal → restore, concurrent source changes and independent archive scopes.
  - [ ] B1.6: return explicit legacy 503 during cutover and 410 after retirement, never a replacement 404.
  - [ ] B1.7: preserve exact receipt recovery and unresolved command contexts.
  - [ ] Gate: base-api-{composition,authority,reveal,legacy,receipts}.spec.ts plus existing scoped/SSE regressions; typecheck and scoped lint.
- [ ] B2 — Complete lot destination; Muse 4–6 h, Sol 4–5 h, total 8–11 h.
  - [ ] B2.1: integrate pinned 6K history and both migrations under CT-1–CT-8; preserve 6L2 routes, watcher and verifier profiles; qualify CT-7 migration assertions before releasing K_SHA.
  - [ ] B2.2: require destination opening in services before business reads and receipt returns.
  - [ ] B2.3: apply the same opening rule to single commands and atomic batches.
  - [ ] B2.4: cover target/city reads, destination history and source-history navigation.
  - [ ] B2.5: separate authorized internal cutover readback from public opened-destination reads.
  - [ ] B2.6: qualify truly empty history → opening → first mark without artificial business events.
  - [ ] B2.7: retain closure for unresolved-only history, missing rights, uncovered writers or invalid epoch.
  - [ ] Gate: lot-opening*, lot-cutover-readback*, lot-cutover-empty*, existing 6J/6K and 6L2 regressions; typecheck and scoped lint.
- [ ] B3 — Serialized source writers; Muse 3–5 h, Sol 3–4 h, total 6–9 h.
  - [ ] B3.1: ogc-pull.ts and its source-lock DB tests; lock the actual mutated identity in the mutation transaction.
  - [ ] B3.2: populate-geo.ts and its source-lock DB tests; cover both update and insert paths.
  - [ ] B3.3: exploitation/projection.ts and its source-lock DB tests; share the canonical lock protocol.
  - [ ] B3.4: qualify lock order, contention and unchanged-UUID content changes before recording writer coverage.
  - [ ] Gate: all three real writer paths contend with facet commands; no coverage attestation without the corresponding executable proof.
- [ ] B4 — Operational cutover; Muse 5–8 h, Sol 4–6 h, total 9–14 h.
  - [ ] B4.1: implement/inject 6H and 6K maintenance safety through existing activation interfaces; Muse A implements B4, Sol A verifies and commits BASE-owned files; shared application/startup deltas use the current CT-1 lease holder.
