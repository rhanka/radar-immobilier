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
- [x] **Lot 6 — en_vigueur 3-states (D7, safety-critical) + suspensive gate (§2.1) + abrogation.** verbatim(date served) | derived(delay stated VERBATIM) | unknown. Gate: derive only absent {suspensive (registre-referendaire/retrait/echec-referendaire/refus-mrc), abrogation, certain-replaces}. Suspensive co-séance (shared rawRef+date) → en_vigueur UNKNOWN (never in-force). abrogation=replaces+validTo (NOT abandonne). Tests + NEG: **delay-absent→unknown-not-derived**; **abrogation≠abandonne**; **en_vigueur=UNKNOWN under unresolved suspensive**; NO hardcoded delay table.
- [x] **Lot 7 — statut refinement (i-arch correction A).** deriveStatut: `type` exact-match (registre-referendaire/consultation-publique, #535 subtypes) → that stage; case-marker (derogation/ppcmoi) → statut=N-A(null) not-flagged, DesignationEvent SURVIVES (subtype ppcmoi/minor-variance), never dropped. Registre NODE wired (subtype=statut=registre-referendaire) + Rule-B séance attachment (shared rawRef → 1 bylaw=uncertain+flagged link; several=UNKNOWN, never guessed). BR01 RESOLVED by #535 (`ca8004a`). Tests + NEG: **case-marker not dropped (node present, statut N-A)**; **registre-referendaire NOT N-A/null**.
- [ ] **Final gate.** `harness verify --category unit` green (incl all negative tests) → `harness verify --category static` → PR → i-arch reviewer #1 + i-cond gate #2. Registre-node negative contingent on i-arch subtype (else fast-follow flagged).

## Feedback Loop
- **i-arch correction A/B (2026-08-30)** — cycle suspensives (registre-referendaire) cross the type_instrument frontier (geo emits document_type=null, type=registre-referendaire, reglement_number=[]). Wired: deriveStatut exact-match `type`→RegulatoryStageKind (Lot 7); en_vigueur gate must consider suspensives even at typeInstrument=unknown (Lot 6); case-marker events SURVIVE as DesignationEvent nodes (statut=N-A), never dropped (Lot 7). `document_type` becomes nullable in the mock input (Lot 6/7).
- **BR01 (RESOLVED by #535 `ca8004a`)** — suspensive registre-referendaire node subtype. Escalated to i-arch (schema owner); i-arch added `registre-referendaire` + `consultation-publique` to `DesignationEventSubtype` (verified RegulatoryStage.bylawId is a mandatory FK → a non-attached suspensive must float as a DesignationEvent needing a subtype). Registre node wired in Lot 7.
- **PR #536 gate review (2026-08-30)** — i-arch review #1 APPROVE + i-cond gate #2 APPROVE, one merge-blocker: **#2 validate OUTPUT nodes against the ontology schema** ((a) parse each projected node via OntoBylaw/OntoDesignationEvent — contract-core anti-regression; (b) `rawRefOf` fail-loud so it never emits an empty rawRef). Bundled the endorsed **#1(a)** cleanup: the en_vigueur "suspensive gate" was dead code (matched the adoption's rawRef; a real registre is a prior séance) — removed `SUSPENSIVE_TYPES` + the inert calc, documented the invariant (in-force asserted ONLY by a served entree_en_vigueur; a served date ⇒ suspensive resolved → env wins, else unknown), reframed the negative + added "served-date-wins" to exercise the semantics. Fast-follow (tracked, non-blocking): #3 typeLibelle bare-n° recall-gap (left conservative — anti-invention-safe per i-arch), #4 SUSPENSIVE_TYPES (moot, removed).

## Commit discipline
One logical change per lot; ≤~10-15 files, <150 lines/commit; selective `git add <files>`; `make commit MSG="type: …"`; update BRANCH.md checkboxes within each commit. Worktree = repo-local `./tmp/reglement-projection` off main #532 (`172f7b57`).
