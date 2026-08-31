# Feature: LOT 1 — V1 source pv-mentions (avis → DesignationEvent, retrait Bylaw-from-avis)

## Objective
Spec D-A TRANCHÉ (`SPEC_EVOL_AVIS_MOTION_CYCLE_VIE.md`) : **un avis de motion = DesignationEvent (subtype avis_motion), PAS un Bylaw. Le Bylaw n'existe qu'à l'ADOPTION.** Corrige la cause-source de « 026-508 » (l'avis créait un Bylaw = faux règlement ferme). Complémentaire au serving Lot A (#542 mergé) : Lot A MARQUE (anticipation) ; Lot B ne CRÉE plus le mauvais nœud à la source.

## Mesuré (avant changement)
- `api/src/services/exploitation/pv-mentions.ts` (109 l.) : boucle **Bylaw** (l.62-70) émet 1 Bylaw PAR `detection.reglementNumbers` (inconditionnel) + **DesignationEvent** (l.78-106) émis si `changementZonage` (avis+règlement+zonage).
- `detectZonageChange` (`packages/radar-sources/src/sources/proces-verbaux-parser.ts`) = détecteur **AVIS-DE-MOTION** : `reglementNumbers` peuplé UNIQUEMENT en contexte avis/zonage (une motion non-zonage n'y contribue pas, l.1227-1228). ⟹ **tous** les `reglementNumbers` = numéros d'avis-contexte → la boucle Bylaw crée toujours un Bylaw pour un AVIS (faux) + double-émission quand `changementZonage=true`.
- Retour détecteur : `avisDeMotion`, `reglementNumbers`, `changementZonage`, `zoneRefs`. **Pas de flag adoption/entrée-vigueur distinct** dans le PV parser (l'adoption finale = `avis-publics-generic.ts` « entrée en vigueur + zonage »). Donc pv-mentions ne voit QUE des avis.
- `MentionNode` (`mentions.ts`) : {id, type, label, normalized_terms, source_refs, zoneRefs?, reglementNumbers?}. **Pas de subtype/statut/etape/cibleReglementNumero** aujourd'hui.

## Scope / Guardrails
- **Allowed** : `api/src/services/exploitation/pv-mentions.ts` (+ `.test.ts`) ; possiblement `mentions.ts` (si subtype/cible à ajouter au MentionNode DesignationEvent) ; tests recon. `plan/BRANCH_lot1-pv-mentions.md`.
- **Forbidden** : Makefile, docker-compose*, rules/**, `ui/**` (=vues), `packages/radar-domain/.../entities.ts`. `proces-verbaux-parser.ts` (le détecteur) = consommer, pas réécrire (sauf si un flag manque VRAIMENT — mesurer, escalader i-arch).
- Make-only ENV-last + down -v. `make lint` avant push. Directive : jamais terme proscrit (factuel). Rebase jamais cherry-pick.

## À EXPLORER (1re étape impl — avant d'écrire les tests a/b)
- **Où se fait la recon/merge mentions→graph_nodes** (merge par terme/cible-n°) : quel service transforme MentionNode → OntoDesignationEvent/OntoBylaw + lie avis→adoption (`lifecycle_predecessor` / `cibleReglementNumero`) ? (grep : mentions→graphify projection, reconciliation par normalized_terms.) Nécessaire pour tests recon (a) merge-par-cible-n° et (b) chaîne avis→adoption liée.
- Consommateurs actuels du **Bylaw-from-avis** émis par pv-mentions (qui casse si on le retire ?) : grep type "Bylaw" côté mentions/graphify + tests. Retirer proprement (0 régression).

## Lot-based plan (test-first)
- [x] **B.0 — explorer recon layer** : `pvMentions`←`mentions.ts:334`(extractMentions) ; recon `reconcile.ts` merge SAME-TYPE par `type::city::term` (Bylaw/DesignationEvent ne fusionnent PAS entre eux) ; DesignationEvent consommé `signals.ts`. Bylaw-from-avis (pv-mentions l.65) distinct des Bylaws avis-publics/règlement-urbanisme (mentions.ts l.150/275, hors scope). Chaîne avis→adoption = couche graphify `reglement-lifecycle-projection.ts` (Lot A), pas la couche mention. AUCUN consommateur test dépend du Bylaw-from-avis (130 tests exploitation verts après retrait).
- [x] **B.1 — retrait Bylaw-from-avis** : pv-mentions n'émet PLUS de Bylaw (boucle l.62-70 retirée) ; seul le **DesignationEvent (avis_motion)** émis, portant `reglementNumbers` (cible) + `zoneRefs`. Header + docstring maj. mentions.test.ts 45/45.
- [x] **B.2 — 3 tests recon BLOQUANTS (R6)** — TOUS verts : (c) **0 double-émission** (mentions.test.ts Saint-Constant + Saint-Damase : avis → 0 Bylaw, n° uniquement sur le DesignationEvent). (a) **merge multi-source → 1 DesignationEvent par cible-n°** (reconcile.test.ts : 2 avis même n° → 1 canonique validated ; n° distinct reste séparé, 0 sur-merge). (b) **avis→adoption liée** (reconcile.test.ts : DesignationEvent avis + Bylaw adoption même n° NE fusionnent PAS (types distincts, 0 candidat cross-type) mais partagent la cible-n° = substrat du lien graphify downstream). reconcile 14/14.
- **⟹ Lot B COMPLET** — prêt pour vérif finale + PR séparée.
- [ ] **Final gate** : `make lint`+typecheck+test-api (down -v) → PR SÉPARÉE → i-arch #1 + i-cond #2. NE PAS self-merge.

## Feedback Loop
- Base : main à jour post-#542 (`50f5931`). Branche `feat/lot1-pv-mentions`.
- Coord vues : Lot B ne touche pas l'UI ; le hide-72 reste `isReglementAvisOnly` (Lot C). Lot B réduit à la SOURCE le nombre d'avis-only mal-typés (moins de Bylaw-from-avis à cacher).

## Commit discipline
1 lot/commit, selective add, update checkboxes, trailers Co-Authored-By Claude Opus 4.8 + Claude-Session, `make commit` (+ trailers dans MSG).
