# Feature: Règlement lifecycle projection (in-memory pilot)

## Objective
Pure `projectZoningEvents(ZoningEvent[]) → OntoNode[]` that derives statut / relations (replaces/amends/lifecycle_predecessor) / en_vigueur-3-states / bitemporal from a MOCKED geo `ZoningEvent` feed, per frozen contract `5f7ca0a9` §1–§6, against the merged immo ontology (#532). Anti-invention: verbatim-or-unknown, flagged-never-guessed. **In-memory + tests ONLY — no preprod/prod publish** (i-arch/i-cond gate).

## Scope / Guardrails
- Output = in-memory nodes + tests only. NO graph publish (publish = later increment, live-feed + recall≥95%, owner-gated).
- ZONAGE in-scope. PLAN handled as a DISTINCT instrument axis (typeInstrument=plan-urbanisme, #534/owner §1 tranché) — projected but NEVER typed as a zonage change (anti-mislabel).
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
- [x] **Lot 4 — predecessor + bitemporal (D6/D8).** lifecycle_predecessor by n°-INTERSECTION (§5, stage-order, fromLibelle=null); validTo closed at successor arrival. Tests + NEG: **replaces-uncertain-does-NOT-close-base validTo** (only certain-replaces closes — D5 guard WIRED).
- [x] **Lot 5 — #534 fold: typeInstrument passthrough (§10).** geo declares type_instrument (verbatim known/§9/"unknown"/null); immo carries it VERBATIM on both nodes (Bylaw+DesignationEvent), never classifies. Orthogonal to document_type (regime). Owner §1 tranché (#534) → plan handled as a DISTINCT instrument axis, not zonage. Tests + NEG: **plan-mislabel (2026-509) projects typeInstrument=plan-urbanisme NOT zonage**; unknown/absent passes through as-is.
- [ ] **Lot 6 — en_vigueur 3-states (D7, safety-critical) + suspensive gate (§2.1) + abrogation.** verbatim(date served) | derived(delay stated VERBATIM) | unknown. Gate: derive only absent {suspensive (registre-referendaire/retrait/echec-referendaire/refus-mrc), abrogation, certain-replaces}. Suspensive co-séance (shared rawRef+date) → en_vigueur UNKNOWN (never in-force). abrogation=replaces+validTo (NOT abandonne). Tests + NEG: **delay-absent→unknown-not-derived**; **abrogation≠abandonne**; **en_vigueur=UNKNOWN under unresolved suspensive**; NO hardcoded delay table.
- [ ] **Lot 7 — statut refinement (i-arch correction A).** deriveStatut: `type` exact-match ∈ RegulatoryStageKind (registre-referendaire) → that stage; case-marker (derogation/ppcmoi) → statut=N-A(null) not-flagged, DesignationEvent SURVIVES (subtype ppcmoi/minor-variance), never dropped. Suspensive registre NODE = pending i-arch DesignationEventSubtype decision (BR01 below). Tests + NEG: **case-marker not dropped (node present, statut N-A)**; **registre-referendaire NOT N-A/null** (contingent on subtype).
- [ ] **Final gate.** `harness verify --category unit` green (incl all negative tests) → `harness verify --category static` → PR → i-arch reviewer #1 + i-cond gate #2. Registre-node negative contingent on i-arch subtype (else fast-follow flagged).

## Feedback Loop
- **i-arch correction A/B (2026-08-30)** — cycle suspensives (registre-referendaire) cross the type_instrument frontier (geo emits document_type=null, type=registre-referendaire, reglement_number=[]). Wired: deriveStatut exact-match `type`→RegulatoryStageKind (Lot 7); en_vigueur gate must consider suspensives even at typeInstrument=unknown (Lot 6); case-marker events SURVIVE as DesignationEvent nodes (statut=N-A), never dropped (Lot 7). `document_type` becomes nullable in the mock input (Lot 6/7).
- **BR01 (open) — suspensive registre-referendaire node subtype.** A registre node needs a `DesignationEventSubtype`; the enum has no suspensive/generic-stage value (only avis-motion/projet-reglement), and typeInstrument is orthogonal (no stage subtype). Escalated to i-arch (schema owner, #532/LOT 1.a): either (a) add a stage subtype, or (b) bless another representation. NOT self-resolved (out of lane / anti-invention). Registre-node + its "registre≠N-A/null" negative are contingent on this; else fast-follow after the core PR. i-cond holds the ETA with this dependency flagged.

## Commit discipline
One logical change per lot; ≤~10-15 files, <150 lines/commit; selective `git add <files>`; `make commit MSG="type: …"`; update BRANCH.md checkboxes within each commit. Worktree = repo-local `./tmp/reglement-projection` off main #532 (`172f7b57`).
