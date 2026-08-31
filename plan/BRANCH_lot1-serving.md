# Feature: LOT 1 serving — avis=anticipation ≠ règlement ferme (« 026-508 »)

## Objective
Invariant §3 : **UNE seule dérivation ferme/anticipation (`deriveRegulatoryStatus`), PERSISTÉE sur graph_nodes, LUE par TOUS les consommateurs ; aucun ne re-classifie ; fail-safe jamais-firm-sans-preuve.** ⟹ aucun consommateur ne peut servir un avis comme ferme. Design-first CLOS (i-arch gate #1 approuvé, 8 raffinements ; owner : D4 co-livrés+3-tests / D5 systémique). Spec : `scratchpad/SPEC_EVOL_LOT1_SERVING_avis-anticipation.md`.

## Scope / Guardrails
- Base = P1 #540 (`regulatoryStatus` sur OntoBylaw/OntoDesignationEvent). Rebase sur main post-merge #540.
- `deriveRegulatoryStatus` = LE classifieur unique (`@radar/domain`). PERSIST à la matérialisation (`upsertGraphAtomic`), PAS serve-time (P2). Consommateurs LISENT le champ.
- Make-only ENV-last + down -v. `make lint` avant push. Directive : jamais terme proscrit (factuel).

## Branch Scope Boundaries
- **Allowed** : `packages/radar-domain/.../reglement-lifecycle.ts` (deriveRegulatoryStatus) + `.test.ts` ; `api/src/services/graph/graph-store.ts` (persist @ matérialisation + supersède deriveEtape) ; `api/src/routes/graph-signals.ts` + `api/src/services/geo/geo-features.ts` + `api/src/services/graph/vivier-v2.ts` + `api/.../export-designation-events.ts` + `packages/immo-mcp/src/*` (sérialiser R5) ; `api/.../exploitation/pv-mentions.ts` (Lot B) ; `ui/.../geo-categories.ts` (lit-champ D3) ; tests systémiques ; `plan/BRANCH_lot1-serving.md`.
- **Forbidden** : Makefile, docker-compose*, rules/**, `packages/radar-domain/.../entities.ts` (P1 = fait par i-arch #540). Ontologie schema hors regulatoryStatus (consommer).

## Lot-based plan
- [x] **Lot A step-0 (i-arch, #540)** — champ `regulatoryStatus` ontologie. PRÉREQUIS fait.
- [~] **Lot A.1 — `deriveRegulatoryStatus` (LE classifieur, `@radar/domain`)** : firm iff statut∈{adopte,entree-vigueur} → sinon etape legacy → jamais keyword → aucune preuve=anticipation fail-safe. Tests D1/D2 + **négatif fail-safe** (aucune preuve→anticipation). ✅ écrit (fn + 6 tests).
- [ ] **Lot A.2 — persist @ matérialisation (P2)** : `graph-store`/`upsertGraphAtomic` appelle `deriveRegulatoryStatus(node)` → écrit `regulatoryStatus`. + **supersède `deriveEtape` (D2)** (retrait keyword-lumping).
- [ ] **Lot A.3 — sérialiser (R5)** : `regulatoryStatus` dans le payload de graph-signals + geo-features + vivier-v2 + export-designation-events + MCP tools.
- [ ] **Lot A.4 — UI (D3)** : `geo-categories.ts` LIT `regulatoryStatus` servi ; présente avis-only en **anticipation-DISTINCT** (marqueur/section), JAMAIS firm ; retrait du hardcode-lump. **⚠ PIN owner-UX-sign-off (montrer-anticipation ≠ cacher, P4-jonction) AVANT ce lot** (surfacé i-cond→owner ; le durable MONTRE les avis que l'interim #537 cachait = intent D-A option-2, pas régression).
- [ ] **Lot A.5 — tests systémiques (D5 / P3 check-archi 2-faces)** : (i) grep/lint « `deriveRegulatoryStatus`=seul classifieur, 0 logique indépendante » ; (ii) « chaque nœud servi PORTE `regulatoryStatus` » ; + « 2026-509 avis JAMAIS firm sur CHAQUE consommateur » + reverse (adoption→firm) ; + **case-marker (piia/derogation) NI firm-règlement NI anticipation-règlement** (routé vue-cas-séparée hors-drawer ; l'archi-vue le route même si deriveRegulatoryStatus retourne « anticipation » safe-not-firm).
- [ ] **Lot B — V1 source `pv-mentions` (co-livré A, recon-guardé D4/R6)** : avis→DesignationEvent (retrait Bylaw-from-avis) + **3 tests recon BLOQUANTS** : (a) merge multi-source→DesignationEvent par cible-n° ; (b) chaîne avis→adoption liée ; (c) 0 double-émission.
- [ ] **Lot C — retrait interim #537/#538 (GATÉ P4, 3 conditions)** : (i) **re-seed vérifié** couvrant les 72 avis-only (fixture i-arch) ; (ii) **presentation-équivalence** — geo-categories présente les avis-only réapparus en anticipation-DISTINCT, JAMAIS firm ; (iii) **owner-UX-sign-off** (montrer≠cacher). Jamais avant (anti-GAP + anti-régression-UX).
- [ ] **Final gate** : `make lint`+typecheck+test-api (down -v) → PR → **i-arch #1** (3 tests recon, check-archi 2-faces, locus persist P2, Lot C gaté P4) + **i-cond #2**. NE PAS self-merge.

## Feedback Loop
- D-B (geo `document_type` contract) = frontière geo-cond/geo-archi V34 (pending).
- Base worktree off #540 branch (48e376e) ; rebase onto main post-#540-merge.

## Commit discipline
1 lot/commit, selective add, update checkboxes, trailers Co-Authored-By Claude Opus 4.8 + Claude-Session, `make commit`.
