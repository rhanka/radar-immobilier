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
- [x] **Lot A.2 — persist @ matérialisation (P2)** : `graph-store`/`buildNodeRow` appelle `deriveRegulatoryStatus({statut, etape})` → persiste `props.properties.regulatoryStatus` (gate `etape!=null || statut!=null` ; PAS dans DEGRADATION_SENSITIVE_KEYS car dérivé/recomputé ; fail-safe déplacé au READ consommateur). Commit `75d4f9e`, 117/117. Findings validés i-arch.
- [~] **Lot A.3 — sérialiser (R5)** : `regulatoryStatus`+`etape` dans le payload de graph-signals + geo-features + vivier-v2 + export-designation-events + MCP tools. ⚠ invariant REVERSE (i-arch) : agréger PAR règlement/zone (firm iff ≥1 nœud firm) via helper partagé.
  - [x] **A.3a — helpers partagés `@radar/domain` (single-source R5)** : `readRegulatoryStatus` (locus lecture UNIQUE : champ persisté sinon fallback deriveRegulatoryStatus legacy) + `aggregateRegulatoryStatus` (firm iff ≥1 nœud firm ; résout reverse-bug). 7 tests, typecheck OK.
  - [x] **A.3b** — graph-signals.ts : `regulatoryStatus`+`etape` en champs 1re-classe du `GraphSignalCard` (via readRegulatoryStatus ; champ persisté LU tel quel, jamais re-classifié). 4 tests, graph-signals 19/19, make typecheck green.
  - [x] **A.3c** — geo-features.ts : opportunité (per-node `regulatoryStatus` via readRegulatoryStatus) + zone-map (nouveau champ `regulatoryStatus` AGRÉGÉ via aggregateRegulatoryStatus = firm iff ≥1 nœud firm ; `anticipation=etapes[0]` conservé, vues remplace en A.4). Logique couverte par units A.3a ; **test DB end-to-end zone-agrégat/reverse = A.5** (D5-reverse i-arch). typecheck green, route-test 7/7.
  - [ ] **A.3d** — vivier-v2.ts + export-designation-events.ts + immo-mcp/*.
- [ ] **Lot A.4 — UI (D3, owner P4 = CACHER les AVIS-ONLY)** : ⚠ **2 mécanismes SÉPARÉS (i-arch/i-cond catch anti-sur-hide)** :
  - **(1) `regulatoryStatus` (firm|anticipation) = axe MARQUAGE / invariant serving** — persisté/servi (A.2/A.3), aucun consommateur ne montre une anticipation comme firm. PAS le hide.
  - **(2) HIDE-drawer = la règle AVIS-ONLY de #538** (`isReglementAvisOnly` : avis_motion présent + AUCUN stade ferme {premier_projet, second_projet, projet_reglement, consultation_publique, adoption, entree_vigueur} + pas inconnu → cache), pilotée par le **`statut`/`etape` AUTORITATIF** (plus propre que le keyword #537/#538). Cache **EXACTEMENT les 72 avis-only** (fixture i-arch), **projet-stage TOUJOURS montré** (owner « règlement réel dès le projet »). **NE PAS cacher sur `regulatoryStatus=anticipation`** (inclut projet/consultation/registre → sur-hide = régression).
  - Owner P4 = CACHER (option 1 §1) tant que vrais règlements pas bien scrappés ; « montrer-anticipation » (option 2) = DIFFÉRÉ (futur, gaté sources réelles geo §3/§4). Besoin : **prédicat exact `isReglementAvisOnly` + fixture-72 (i-arch)**.
- [ ] **Lot A.5 — tests systémiques (D5 / P3 check-archi 2-faces)** : (i) grep/lint « `deriveRegulatoryStatus`=seul classifieur, 0 logique indépendante » ; (ii) « chaque nœud servi PORTE `regulatoryStatus` » ; + « 2026-509 avis JAMAIS firm sur CHAQUE consommateur » + reverse (adoption→firm) ; + **case-marker (piia/derogation) NI firm-règlement NI anticipation-règlement** (routé vue-cas-séparée hors-drawer ; l'archi-vue le route même si deriveRegulatoryStatus retourne « anticipation » safe-not-firm).
- [ ] **Lot B — V1 source `pv-mentions` (co-livré A, recon-guardé D4/R6)** : avis→DesignationEvent (retrait Bylaw-from-avis) + **3 tests recon BLOQUANTS** : (a) merge multi-source→DesignationEvent par cible-n° ; (b) chaîne avis→adoption liée ; (c) 0 double-émission.
- [ ] **Lot C — retrait LOGIQUE-keyword #537/#538 (GATÉ P4 ; owner=HIDE avis-only)** : retirer la logique-keyword de #537/#538 ; le **hide-behavior avis-only PERSISTE** (repris par la règle `isReglementAvisOnly` pilotée `statut`/`etape` autoritatif) → **ZÉRO réapparition** des 72, projet-stage toujours montré, zéro régression visible. Gate P4 : (i) **re-seed-72 couvre** ; (ii) **hide-équivalence EXACTE** — le durable cache EXACTEMENT les 72 (fixture i-arch), **0 drift vs #538**, projet-stage montré. Jamais avant re-seed (anti-GAP).
- [ ] **Final gate** : `make lint`+typecheck+test-api (down -v) → PR → **i-arch #1** (3 tests recon, check-archi 2-faces, locus persist P2, Lot C gaté P4) + **i-cond #2**. NE PAS self-merge.

## Feedback Loop
- D-B (geo `document_type` contract) = frontière geo-cond/geo-archi V34 (pending).
- Base worktree off #540 branch (48e376e) ; rebase onto main post-#540-merge.

## Commit discipline
1 lot/commit, selective add, update checkboxes, trailers Co-Authored-By Claude Opus 4.8 + Claude-Session, `make commit`.
