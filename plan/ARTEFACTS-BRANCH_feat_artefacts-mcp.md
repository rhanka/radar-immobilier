# Feature: Decoupled artifact MCP and authenticated API-connected pages

## Objective
- [ ] Deliver four artifact tools on the existing authenticated MCP connection and a synthetic page calling named API operations.
- [ ] Preserve permanent independence from business DB delivery; artifact technical PostgreSQL/S3 persistence remains required.

## Scope / Guardrails
- [ ] Branch: `feat/artefacts-mcp`; baseline: `9a81508704b8ee247e3d402f9cbf15d458edfe2a`.
- [ ] Integration workspace: `/home/antoinefa/src/radar-immobilier/.worktrees/artefacts-mcp`.
- [ ] Authority: the owner's request, approved `.lanes/conductor/tmp/861c/proposition-artefacts.md`, its execution review and code; other plans describe coordination only.
- [ ] No business UI project, business SQL access from artifact code, status migration, mandatory S0/6H/6K, real client data, secrets or environment-file reads.
- [ ] English artifacts; Make-only container execution; standalone runners; RTK prefix; `ENV` last; tests only on `test-*`/`e2e-*`.
- [ ] No Python anywhere, including containers, runners, helpers and mutation scripts; never read `.env` or `.env.*`, directly or indirectly.
- [ ] Every implementation/test/docs/dependency commit: <=150 added+deleted lines and <=15 files, including plan updates; aim for 80-120.
- [ ] Split each semicolon-separated slice below further when necessary; no generated-file exemption, uncompilable intermediate snapshot or weakened assertion.
- [ ] Muse implements; Sol qualifies and commits; two independent Astra max reviews run concurrently; then correction and revalidation.
- [ ] Unexecuted checks, external deliveries, deployment state and candidate signatures remain `unverified`.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths**: `packages/artifacts-host/src/**`; `packages/immo-mcp/src/**`, `packages/immo-mcp/config/**`, `packages/immo-mcp/README.md`.
- [ ] **Allowed Paths**: `api/src/artifacts/**`; artifact integration tests/helpers; `api/tests/e2e/artifacts-*`; `tools/h4-mcp.mk`; isolated artifact/H4/H5 runners and synthetic fixtures.
- [ ] **Allowed Paths**: this plan; new lane plans `plan/ARTEFACTS-A{1,2,6}-BRANCH_*.md`; `docs/operator/artefacts-mcp.md`; ignored evidence under `tmp/artefacts-mcp-*/`.
- [ ] **Forbidden Paths**: root `Makefile`, root `docker-compose*.yml`, `rules/**`, agent bootstrap files, other branch plans, product UI, business schemas/services, client materials, environment files, upstream repositories.
- [ ] **Conditional Paths, integration writer only**: dependency manifests/lockfiles; required artifact technical SQL and `api/drizzle/meta/_journal.json`; `tools/artifact-host.mk`; `api/vitest.config.ts` for the A6 browser exclusion.
- [ ] **Conditional Paths, integration writer only**: `api/src/{app,index,config}.ts`, `api/src/routes/auth.ts`, `api/src/services/auth/oidc.ts` and matching auth tests; only approved A1/A3/A6 bindings.
- [ ] **Conditional Paths, H5 runtime**: `api/Dockerfile`, `api/docker-entrypoint.sh`; A6 supplies deltas, the ARTEFACTS Sol integrator applies them.
- [ ] **Conditional Paths, A7 operations**: new `deploy/overlays/preprod/artifact-content-reader{,-networkpolicy}.yaml`, `deploy/overlays/preprod-h5/{kustomization,patch-artifact-content-ingress}.yaml`, `deploy/ci/check-h5-*.sh`; no live apply.
- [ ] Existing `deploy/overlays/preprod/artifact-content-{deny,ingress,networkpolicy}.yaml` are reused unchanged by the opt-in H5 render; ordinary preprod/CD stays in denial mode.
- [ ] **Exception process**: record `BRARTEFACTS-EXn` in Feedback Loop; remain within the owner-authorized outcome.

## Feedback Loop
- [x] BRARTEFACTS-EX6 / A2-BASE MCP: authorize the scoped HTTP adapter, typed errors, A2 invalidation and strict A3 route/query/configuration receipts in the assigned MCP lane. Preserve CT-3/CT-9, five stubs and six public tools. API T08/T09 and H5 stay separately owned; tests mount locally only. No migration, dependency, production activation, main merge or push. Recovery retains the current image before activation, then closes only signal capability and resumes with a qualified scoped/strict image.
- [x] BRARTEFACTS-EX4 / T00: merge main `f3436944` into integration `b2b802b5`, including inherited BASE/security paths; preserve both capabilities and the frozen migration journal. Rollback returns to the first parent; no activation or main delivery is authorized.
- [x] BRARTEFACTS-EX5 / A2-BASE API: authorize the bounded search contract, workspace resolver, coherent read helpers, canonical card exports and associated API tests/runners in the A2-BASE API lane. BASE retirement requires this read adaptation (CT-3); no business writes, migration, dependency or production mount. Preserve CT-3/CT-9 and exclusive ownership of app/auth/startup/A3/H5/MCP files. Recovery keeps the current image before activation, then closes only the signal capability and uses a qualified scoped image. No main merge, push or activation is authorized.
- [ ] T00 qualification: exact merged SHA, API CI collection, H4/MCP, closed BASE, CT-8 fresh/upgrade/rerun and portable bundle audit; report evidence and remaining prerequisites separately.
- [ ] BRARTEFACTS-EX1: retain the assigned integration worktree; child worktrees use repository-local `tmp/`; root UAT remains untouched; rollback removes only unused child worktrees.
- [ ] BRARTEFACTS-EX2: conditional integration edits implement approved package, migration and auth bindings; preserve business state; recovery closes artifact admission and retains strict identity checks.
- [ ] BRARTEFACTS-EX3: add the H5 image entrypoint and opt-in routing/network render; A6 owns runtime deltas, A7 owns operations; recovery restores the existing denial Service without changing artifact data.
- [ ] Commit messages: one English Conventional Commit subject <=72 characters, no body or trailer.
- [x] Integration quality: declare existing Node runtime globals in the two H4 exchange qualification helpers; preserve lint rules, assertions and runtime behavior.
- [ ] OPEN D1: first proof is read-only by default; reader-authorized writes remain an extensible, operation-qualified objective.
- [ ] OPEN D2: technical example only by default; optional business sketch remains outside the principal total (+2-4 agent hours in the approved proposal).
- [ ] External waits: r2 candidate/signatures; compatible published artifacts/platform/mesh/mcp-auth tuple and provenance; RFC 8693 issuer/identity configuration; content DNS/TLS/network/resources; operator/CI and publication GO.
- [ ] Continue independent preparation during these waits; D1/D2 do not block implementation; do not claim affected acceptance before evidence.
- [ ] Unchanged ETA, hours: A1 Muse 5-8 / Sol 4-7 / reviews 1.5-2 each / correction 2-4 = 14-23.
- [ ] Unchanged ETA, hours: A2 Muse 3-4 / Sol 2-3 / reviews 1-1.5 each / correction 1-2 = 8-12.
- [ ] Unchanged ETA, hours: A3 Muse 1-2 / Sol 1-2 / reviews 0.75-1 each / correction 0.5-2 = 4-8.
- [ ] Unchanged ETA, hours: A4 Muse 3-5 / Sol 2-4 / reviews 1-1.5 each / correction 1-2 = 8-14.
- [ ] Unchanged ETA, hours: A5 Muse 2-4 / Sol 4-6 / reviews 1-1.5 each / correction 1-2 = 9-15.
- [ ] Unchanged ETA, hours: A6 Muse 5-8 / Sol 4-7 / reviews 1.5-2 each / correction 2-4 = 14-23.
- [ ] Unchanged ETA, hours: A7 Muse 0.5-1 / Sol 1.5-3 / reviews 0.5-0.75 each / correction 1-1.5 = 4-7.
- [ ] Total: 61-102 agent hours; active critical path 28.75-49.75 hours, rounded 29-50; review efforts overlap.
- [ ] Preserve the proposal's 2026-10-23 14:00 UTC origin: ideal bounds 2026-10-24 18:45 to 2026-10-25 15:45 UTC; favorable conditional proof 2026-10-25 00:00 UTC.
- [ ] Favorable scenario unchanged: candidate Oct 24 00:00; A1 ready 12:30; A4 ready 07:15; published tuple 12:00; A5 ready 20:30; A7 Oct 25 00:00 UTC.
- [ ] Calendar assumptions, resource availability and external arrivals are `unverified`; queues and further substantial correction add elapsed time.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: A1, A2 and A6 preparation in separate worktrees, followed by sequential shared-file integration.
- [ ] Create `tmp/artefacts-mcp-a1` / `feat/artefacts-mcp-a1`, `tmp/artefacts-mcp-a2` / `feat/artefacts-mcp-a2`, `tmp/artefacts-mcp-a6` / `feat/artefacts-mcp-a6` from the recorded plan-commit SHA.
- [ ] A1 publishes the provider-neutral profile/release/authority contract slice first; A6 prepares against that seam without waiting for the provider candidate.
- [ ] Activation order: A2 -> A3 -> A4 -> A5 -> A7; A5 also requires A1; A7 also requires A6.
- [ ] The ARTEFACTS Sol integrator owns shared files and this plan, subject to CT-1 across tracks and the exclusive H4 handoff below; lanes submit explicit shared-file deltas.
- [ ] Integrate coherent dependency tuples, SQL/journal entries and startup/auth hunks sequentially; preserve branch ancestry through merges, with no squash, rebase merge or cherry-pick.
- [ ] Never hand-resolve a lockfile or reconcile an auth conflict by dropping a guard; rerun affected gates after integration.
- [ ] CT-1 — BASE/ARTEFACTS shared-write rule: one conductor-recorded lease holder at a time edits `api/src/app.ts`, `api/src/index.ts` and `api/drizzle/**` across both tracks; include `auth.ts` if both tracks touch it. Neither lane's integrator has an independent concurrent write right.
- [ ] CT-2 — Each lease records holder, receiving branch/HEAD, both input SHAs, exact hunks, migration reservations, tests and resulting commit. The next holder acknowledges that receipt. Nonshared work continues; joining the histories uses merge commits, never whole-file ours/theirs or copied commits.
- [ ] CT-3 — Preserve both sets of mounts/startup dependencies and middleware order: content-host isolation first, control cookie guard, then authenticated business routes; keep H4 and H5 identities distinct. Requalify the named signals API adapter if BASE retires its route; do not reopen a retired route.
- [ ] CT-4 — Reserve `0022_facet_lot_cutover.sql` and `0023_facet_lot_versions_fence.sql` for BASE's pinned 6K import. Allocate artifact technical files from the next globally unreserved number, at least 0024; reservation alone is not migration-order proof. Preserve inherited SQL bytes and hashes.
- [ ] CT-5 — Use the existing common Drizzle journal/migrator. The lease holder assigns each unreleased suffix entry a unique tag and sequential idx, with when greater than the maximum existing journal/applied timestamp. Preserve the applied prefix; never renumber, retime or replace an applied/released entry or edit database migration history.
- [ ] CT-6 — BASE-first is permitted: append artifact entries after the fixed BASE prefix. ARTEFACTS-first is permitted without importing or applying 6K: release its technical suffix on the current baseline, then register still-unreleased BASE entries after that suffix, retaining 0022/0023 SQL bytes and their relative order. Their original lower timestamps must not be inserted behind an already-applied artifact suffix.
- [ ] CT-7 — Freeze one journal order before first persistent use across the target release chain. Reindex/retime only unpublished, unapplied suffix metadata, with provenance; a branch commit or disposable test DB is not a deployment release; BASE owns qualifying its migration assertions by relative prerequisite order rather than obsolete adjacency. If 6K metadata is already immutable, retain its prefix and refuse an incompatible combined upgrade; do not invent a history repair. Applied/deployed state is unverified until an operator receipt.
- [ ] CT-8 — Qualify a standalone delivery on fresh DB, its baseline upgrade and rerun using only its own migrations. Before a combined delivery, also qualify baseline-to-first-track-to-combined with its frozen journal: every expected SQL hash occurs once, none is skipped, technical/business data survive. Alternative orders need their own pre-release qualification. Serialize migration jobs per target DB; never wait for the other track to qualify a standalone delivery.
- [ ] CT-9 — After joining histories, test the exact combined SHA/image: both mount sets, auth/session and 6L2 regressions, BASE with artifacts off, artifacts without optional business capabilities, two-reader API proof and migration history. A shared-image update must retain already-delivered capabilities; no stale branch image may overwrite them. Schema coordination never requires 6K business activation or makes MCP/H5 a BASE prerequisite.
- [ ] H4 file ownership: Sol A2 alone applies/commits P4 deltas in `tools/h4-mcp.mk` under an exclusive lease; Muse A2 proposes hunks only. After accepted A2 HEAD is merged and acknowledged, ownership returns to the ARTEFACTS Sol integrator for A4/P6 and A5/P7; no overlapping edits.
- [x] A2 integration: approved source `b104ae90a28a5581e8eabd15f12acb58558d3396`; the ARTEFACTS Sol integrator acknowledges the P4 receipt and H4 SHA-256 `7c1f4c68f47929764cd0f37e60b0c9a7d719e40900a2634a98931655cca52e40`, resuming exclusive ownership for A4/P6 and A5/P7; P4 activation remains open.
- [x] A1 partial integration: approved source `f2b6c25cc9458ec285d6d4f620a55dad8c30f909` received on `e70651851104bbbc885c131164526dad3dee30f0` after both r3 approvals; CT-1 files and Track remain unchanged.
- [x] A6 partial integration: approved source `ad49cdd40584fa14ccba95fe94cab4f04184d788` merged under L4 after acknowledging BASE L3 receipt `4fc755e9`; inherited source lines are exempt from the authored 150-line limit, as explicitly authorized; reader activation remains open.
- [x] L4 app binding: apply A6's exact optional reader mount to `app.ts`; content dispatch stays before control/auth, absent reader remains closed; no startup/auth/Drizzle change.
- [x] API runner qualification: the full 307-file suite reproduces three CPU-contention deadlines, then passes with four workers; bound shared runner concurrency without changing test deadlines, assertions or exclusions.
- [ ] A1 acceptance remains open pending Sentropic r2; enabled `[missing-contract]` cases remain named failures and ordinary API collection keeps acceptance disabled by default. Proposed SQL/journal remain unregistered; CT-8/CT-9 remain unverified.

## UAT Management (in orchestration context)
- [ ] Automated acceptance uses synthetic readers/data and isolated stacks; no automated test targets root `ENV=dev`.
- [ ] No sub-branch UAT; integrated technical-page review only. Later owner UAT follows the fixed root URL/ports and commit-identical checkout rule.
- [ ] Publication and operational GO remain pending on concrete receipts; this plan authorizes preparation and implementation.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and parallel dispatch**
  - [ ] Read MASTER/workflow/subagents/testing and harness instructions; confirm branch, full base SHA and scoped ownership.
  - [ ] Reserve A1 ports API/UI/Maildev 18941/15941/11941, A2 18942/15942/11942, A6 18946/15946/11946; availability `unverified`.
  - [ ] Use `test-artefacts-mcp-a1`, `test-artefacts-mcp-a2`, `test-artefacts-mcp-a6` and A6 `e2e-artefacts-mcp-a6`; publish no DB/S3 host ports.
  - [ ] Commit this plan; record child BASE; create child worktrees; keep shared-file and realization updates single-writer.
- [ ] **Lot A1 — H3 and r2 provider**
  - [ ] Slices: contracts/profile; coherent dependencies; artifact migration increments; transaction authorization participant; provider quota/reservation bindings.
  - [ ] Slices: typed outcome and persistent ledger; atomic replacement of superseded paths; admission/ledger startup; PR908 helper bindings; qualification in small case groups.
  - [ ] Files: artifacts-host; control-route-startup; artifact SQL; PR908 acceptance/finalization/failure suites and existing artifact integration suites; technical SQL registration follows CT-1 through CT-9.
  - [ ] Acceptance: authorization after waits within finalization/replay; no refused durable success; persistent quotas and one-winner reservation races; consistent typed failures; restart and bounded preparation cleanup.
  - [ ] Gate: standalone artifact runner typecheck/lint/build-api, host/API integration suites and enabled real-provider acceptance; skipped or missing-contract cases cannot close A1.
- [ ] **Lot A2 — H4 P4 exchange**
  - [ ] Slices: dependency/auth upgrade; exchange client; returned-token validation; bounded cache; immutable per-request binding; removal of original-bearer fallback; issuer/operator proof.
  - [ ] Files: MCP auth/invocation/data-source/HTTP entry; new exchange modules/tests; discovery/session tests; H4 issuer runner authored as Muse deltas and applied by its current Sol owner.
  - [ ] Acceptance: verified human retained; exact API audience/workload/search scope; no raw MCP bearer in API, tool context or logs; public tools/stubs independent; cache and discovery qualified.
  - [ ] Gate: MCP unit/session/discovery suites, typecheck/lint/build; real isolated issuer exchange; published tuple and deployed exchange receipts remain explicit activation prerequisites.
- [ ] **Lot A3 — H4 P5 strict receiver**
  - [ ] Slices: reuse/update #865; audience/actor/profile/routes; browser-session regressions; exchange-first activation proof; strict-preserving recovery.
  - [ ] Files/tests: API config, OIDC, auth middleware and their tests; current #865 head/status `unverified`.
  - [ ] Acceptance: correct exchanged search works without cookies; both audience confusions fail; forbidden routes/methods fail; browser/public-route behavior preserved.
  - [ ] Gate: auth/OIDC/session and protected-signals regressions; A2 receiving-environment receipt and qualified strict recovery before activation.
- [ ] **Lot A4 — H4 P6 composition**
  - [ ] Slices: cluster-mesh adapter; twelve-tool bindings; session lifecycle; synthetic stdio boundary; account bindings; parity/image proof.
  - [ ] Files/tests: MCP registry/entrypoints/stateful host; existing baseline, session, request-isolation and registry suites; dedicated composition/image suites.
  - [ ] Acceptance: one dispatch/effect; twelve-tool parity and five stubs preserved; fresh request authority; failed binding stays closed; stdio cannot access real storage.
  - [ ] Gate: MCP suite, qualified tuple, isolated lifecycle/composition checks and actual runtime-image proof.
- [ ] **Lot A5 — H4 P7 four artifact tools**
  - [ ] Slices: full profile compilation; four-tool selection; common facade; guarded startup; HTTP/MCP parity; cross-process replay/conflict; restart/failures; published-byte qualification; receipt.
  - [ ] Files/tests: artifact MCP adapter, MCP artifact profile/config/composition, startup bindings; artifact-mcp-adapter and real-provider service E2E suites.
  - [ ] Acceptance: exactly twelve plus four tools; caller keys and ordered-content identity; shared ACL/quota/ledger semantics; denied finalization never replays a success; A1 prerequisites met.
  - [ ] Gate: enabled provider acceptance plus dedicated H4 composition E2E, package provenance and exact image/configuration receipts.
- [ ] **Lot A6 — H5 reader and API connector**
  - [ ] Slices: browser-bound init; atomic ticket; separate session/grant; release activation; content serving; named API operations; reader-context adaptation; renewal/revocation; isolation/refusals; minimal example.
  - [ ] Files/tests: API artifact content/reader modules; artifact-reader integration suites; dedicated browser runner; shared app/auth/SQL deltas follow CT-1 through CT-9.
  - [ ] A6 supplies `api/vitest.config.ts` exclusion `tests/e2e/artifacts-reader*.spec.ts`, preserving `configDefaults.exclude`; the ARTEFACTS Sol integrator commits it before browser specs enter either lane or integration HEAD. Playwright explicitly selects those files.
  - [x] Integrator applied A6's exclusion: both browser drafts disappear from discovery; all 277 ordinary API files and 2,658 test definitions remain collectible, with default exclusions preserved.
  - [ ] A6 runtime: `content-reader` mode -> `api/dist/artifacts/content-reader-server.js`; bundle its new source through `api/Dockerfile` and dispatch through `api/docker-entrypoint.sh`. Preserve `api`, independent `content-deny`, unknown-mode refusal and API content-host denial.
  - [x] Integrator applied A6's reader bundle/entrypoint deltas, with the mode comment/error listing updated; image qualification remains a separate executed gate.
  - [ ] Acceptance: publisher/workload/reader remain distinct; rights intersect profile/current reader/API checks; no arbitrary URL, identity or authority headers.
  - [ ] Acceptance: browser-bound <=60-second single-use ticket; separate secure cookies; release-bound grant; renewal rechecks authority; measured cutoff <=60 seconds; old tabs gain no newer profile.
  - [ ] Acceptance: real synthetic public Geo read and protected signals read by two readers; local refusal leaves publication, page opening and unrelated operations available.
  - [ ] Gate: prove Vitest collection excludes H5 browser specs, full ordinary API suite passes, and H5 Playwright lists and executes every required case; qualify final runtime-image modes and routing, plus content/auth regressions. H4 search tokens are not H5 reader grants.
- [ ] **Lot A7 — Integrated acceptance and operations**
  - [ ] Slices: MCP->page->API; two readers; status independence; release change; published-package acceptance; deployment order; recovery; evidence dossier.
  - [ ] Files/tests: integrated artifact E2E and isolated runners; stage receipts and operator runbook; A7 owns the opt-in preprod-h5 render and reader Deployment/Service/NetworkPolicies, applied to git by the ARTEFACTS Sol integrator.
  - [ ] Active path: both existing wildcard Ingress rules -> `radar-artifact-content-reader:http` -> image args `["content-reader"]`; preserve Host/TLS and never route content to UI or general API. Default/recovery render targets `radar-artifact-content-deny:http`.
  - [ ] Network/render gate: allow Traefik ingress, bounded DNS and fixed API/Geo/technical-storage egress with receiving-side rules; deny arbitrary destinations. Keep content-deny without credentials/egress. Prove deny -> reader -> deny on the final image and isolated routing fixture; actual DNS/TLS/cluster receipts remain pending.
  - [ ] Acceptance: existing MCP connection publishes and opens the page, protected reads identify each reader, forgery/revocation/expiry deny, closed status capability leaves core artifacts and Geo working.
  - [ ] Acceptance: restart/replay and quota races hold across processes; recovery preserves strict identity and artifact data; deployment order respects shared-image coupling.
  - [ ] Gate: integrated tests on the exact published tuple/image, CT-8/CT-9 after shared fusion, H5 active/recovery render and image proofs; two independent reviews, corrections and revalidation; external operational evidence explicitly recorded.
- [ ] **Docs consolidation**
  - [ ] Consolidate operator guidance, exact commands, package/image/config digests, per-case evidence, open decisions and remaining external waits.
  - [ ] Reconcile lane checkboxes into this plan and realization state once; conductor updates roadmap status operationally without redesigning scope.
- [ ] **Merge and close**
  - [ ] Sol delivers base-relative verified bundles and reports; review the exact integrated HEAD and obtain required CI evidence.
  - [ ] Preserve source branches; merge commits only; do not claim activation from a code merge.
  - [ ] Teardown each isolated project with down -v --remove-orphans and inspect zero remaining resources.
  - [ ] Close only evidenced items and archive this plan under plan/done after branch merge.
