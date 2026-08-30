# Feature: Règlement lifecycle projection (in-memory pilot)

## Objective
Pure `projectZoningEvents(ZoningEvent[]) → OntoNode[]` that derives statut / relations (replaces/amends/lifecycle_predecessor) / en_vigueur-3-states / bitemporal from a MOCKED geo `ZoningEvent` feed, per frozen contract `5f7ca0a9` §1–§6, against the merged immo ontology (#532). Anti-invention: verbatim-or-unknown, flagged-never-guessed. **In-memory + tests ONLY — no preprod/prod publish** (i-arch/i-cond gate).

## Scope / Guardrails
- Output = in-memory nodes + tests only. NO graph publish (publish = later increment, live-feed + recall≥95%, owner-gated).
- ZONAGE in-scope. PLAN = mechanical fixture, frozen until owner §1 family decision (kept as anti-invention fixture, not served in-scope).
- CONSUME merged ontology (`radar-domain/.../reglement-lifecycle.ts`, `entities.ts`) — do NOT modify the schemas.
- Feed not live → local mock ZoningEvent type matching geo-archi's confirmed emitted shape (cible=null outside avis; immo never sees emitted typed relations/lifecycle_stage).
- Make-only, `ENV=<env>` last arg. All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed**:
  - `api/src/services/graph/reglement-lifecycle-projection.ts`
  - `api/src/services/graph/reglement-lifecycle-projection.test.ts`
  - `api/src/services/graph/reglement-lifecycle-projection.fixture.ts`
  - `api/src/services/graph/zoning-event-mock.ts` (local mock input type/builder — until geo emits a shared type)
  - `plan/NN-BRANCH_reglement-projection.md`
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`, `CLAUDE.md`/`AGENTS.md`, `packages/radar-domain/src/schemas/ontology/**` (consume, never modify), any preprod/prod publish path.
- **Conditional**: none expected. Exceptions via `BRxx-EXn` in Feedback Loop.

## Orchestration Mode
- [x] Mono-branch (single logical feature, one final test cycle). Rationale: one cohesive pure-projection module, no independent CI needed.

## Lot-based plan
- [x] **Lot 1 — mock input + fixtures.** `zoning-event-mock.ts` (ZoningEvent type/builder = geo-archi confirmed shape) + `.fixture.ts` (sainte-martine multi-stage 2025-492 2e-projet→adoption, 2026-511 avis→2e-projet; cowansville 1841-52 adoption; candiac 5000-076 second_projet no-cible; **plan-mislabel fixture 2026-509**). Test: fixtures conform to shape (cible=null outside avis).
- [x] **Lot 2 — node creation + statut (D3/D4).** document_type→node (avis/projet→DesignationEvent; adoption→Bylaw; entree_en_vigueur→UPDATE Bylaw; abrogation→state+replaces). statut=RegulatoryStageKind (premier/second→1er/2e-projet PRIMARY deterministic; unknown-doctype→null+flagged; content→null). cible only on avis. Tests: each mapping; unknown→flagged; content→null.
- [x] **Lot 3 — relation typing (D5, safety-critical).** libellé→replaces(abroge et remplace)·amends(modifiant/modification au) certain; ambiguous→uncertain+flagged; unknown-verb→§9 raw+ignored; target n° from libellé; fromLibelle=verbatim. Tests + NEG: **ambigu-never-auto-amends**; unknown-verb-ignored.
- [ ] **Lot 4 — predecessor + bitemporal (D6/D8).** lifecycle_predecessor by n°-INTERSECTION (§5, stage-order, fromLibelle=null); validTo closed at successor arrival. Tests + NEG: **replaces-uncertain-does-NOT-close-base validTo** (only certain-replaces closes — D5 guard WIRED).
- [ ] **Lot 5 — en_vigueur 3-states (D7, safety-critical).** verbatim(date served) | derived(delay stated VERBATIM, cited {trigger,date,delay-source,computed}) | unknown. Gate: derive only absent {suspensive, abrogation, certain-replaces}; uncertain-replaces→pending. abrogation=replaces+validTo (NOT abandonne). Tests + NEG: **delay-absent→unknown-not-derived**; **abrogation≠abandonne**; NO hardcoded delay table.
- [ ] **Lot 6 — plan/zonage passthrough (D9).** document_type verbatim passthrough (evidence); NO speculative type_instrument field (pre-owner-§1). Test + NEG: **plan-mislabel (2026-509) NOT projected as zonage**.
- [ ] **Final gate.** `harness verify --category unit` green (incl the 6 negative tests) → `harness verify --category static` → PR → i-arch reviewer #1 (verifies D5-guard-wired, D7-no-delay-table, doctype-passthrough, 6 neg-tests green) + i-cond gate #2.

## Feedback Loop
- (blockers/decisions recorded here as they arise)

## Commit discipline
One logical change per lot; ≤~10-15 files, <150 lines/commit; selective `git add <files>`; `make commit MSG="type: …"`; update BRANCH.md checkboxes within each commit. Worktree = repo-local `./tmp/reglement-projection` off main #532 (`172f7b57`).
