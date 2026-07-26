# SPEC EVOL v2 — Filtrage, vivier d'opportunités & complément geo

**Statut** : à challenger (codex 5.5-xhigh) → figer → implémenter. Décision de fond déjà actée (score par critères data-gated, score fitté jeté).
**Principe** : vivier honnête de **densification résidentielle**, sans gate hallucinant, **sans silence** ; score **gaté sur la donnée** ; **A/B ancien↔nouveau conservé** (rollback trivial). Vision de Steve : « détecter tout ce qui indique qu'une ville **augmente la densité permise** ».

## BLOC FILTRAGE (1-2-3, immo + graphify) — livré en un bloc, comparable A/B

### 1. Contrat de classification canonique (serveur immo) — remplace `subsetCounts {z,m,p}`
- **Compteurs NOMMÉS** (fin de l'explosion combinatoire) : `qualified` (zonage résidentiel), `residentialUnknown` (indéterminé, GARDÉ), `excludedByReason` (non-résidentiel franc, PIIA non pertinent…), `stageCounts` (par étape).
- **Classification TRI-ÉTAT** par axe, avec **source + confiance + preuve** :
  - `zonage` ∈ {oui, non, **indéterminé**}  (ne plus faire disparaître les `category=null` sous un booléen)
  - `residentiel` ∈ {oui, non, **indéterminé**}
  - `effet_densifiant` ∈ {oui, non, **inconnu**}  (inconnu tant que geo n'a pas confirmé le Δ grille)
- **Instrument** (rezonage / PPCMOI / PIIA / dérogation / refonte / plan_urbanisme) **SÉPARÉ** de **étape** (avis_motion → projet → consultation → second_projet → adoption → entrée_vigueur) **SÉPARÉ** de **historique d'étapes**. **Ne plus utiliser `etape` comme repli de détection du zonage** (champ corrompu — finding challenge).
- **Règle de tri DÉTERMINISTE (sans score)** : `éligibilité → preuve d'effet densifiant → étape (précocité) → type (PPCMOI/refonte) → qualité de preuve → fraîcheur → id stable`. **Chaque remontée affiche SA raison.**
- **Ancien contrat `z/m/p` gardé en parallèle** (calculé aussi) → A/B.

### 2. graphify 3.4 (immo, opéré par le conducteur) — anti-silence
- **Numérotation (décision propriétaire)** : conserver `ontology_version` **2.3** pour le contrat existant et identifier explicitement la passe avec `graphify_pass: "3.4"`. Le mapping normatif est donc **Graphify 3.4 → ontology 2.3** ; il s'agit d'une passe d'enrichissement, pas d'une migration de contrat. Les champs ajoutés et le manifeste sont décrits dans `radar/ontology/graphify-output-contract.md`.
- **2 modes** : incrémental (**snapshot COMPLET baseline+patch**, jamais delta partiel — le projecteur `upsertGraphAtomic` **supprime les nœuds absents du snapshot par ville**, garde-fou = gate de complétude/rollback) + full cumulatif (ré-extraction raw, `ontology_version` uniforme, fait foi).
- **Deltas 3.4** : reclasser les **1533 `category=null`** ; poser `instrument`, `usage_dominant`, `effet_densifiant=inconnu` (rempli par geo ensuite), **étape propre + historique**, scanner **PV-complet (#368)** (récupère points secondaires/annexes → anti-silence).
- **Legacy Filter A release gate**: a Graphify 3.4 cutover is prohibited until every requirement in the [Graphify 3.4 addendum](../reports/consensus/graphify-3.4-legacy-filter-a-addendum.md) is green: the recreated HEAD inventory, golden fixtures, and full, incremental, projection, and UI receipts must prove the unchanged legacy `z|m|p` contract.

#### CRITÈRES D'ACCEPTATION Lot 2 — REJOUABILITÉ (constat code 2026-07-13, à combler)
État actuel mesuré : **deux chemins disjoints**. `graphify run` (depuis raw, LLM) ne produit que le **socle v2.0** ; les enrichissements (`tools/graphify-v23/`) sont un **transform baseline→baseline** qui **exige un baseline** (`worker.sh` exit 1 sans) et **préserve** les champs antérieurs au lieu de les re-dériver. **Il n'existe AUCUNE entrée unique `raw → schéma courant` ; le full cumulatif est un mode CIBLE, pas construit.**
1. **Producteurs réexécutables depuis raw** pour les champs plats v2.2 (`zone_ref`/`no_lot`/`reglement_number`) — **TROU DUR** : seule la logique de *préservation* existe aujourd'hui, pas de script qui les reconstruit depuis le PV. (`etape` est déjà re-dérivable par heuristique déterministe `inferEtape`.)
2. **Entrée cumulative unique `raw → 3.4`** (mode « full ») : socle + toutes les couches en **une passe**, sans dépendre d'un graphe antérieur.
3. **Projection shadow + bascule atomique** (le projecteur destructif ne doit jamais écrire à moitié).
4. **Gate de rejouabilité** : perdre les annotations → replay depuis raw → **graphe ÉQUIVALENT** (IDENTIQUE sur champs déterministes : `etape`, `zone_ref`, remap d'arêtes, ids clés-métier ; ÉQUIVALENT sur champs LLM : `description`, socle from-raw) + **convergence incrémental↔full**.
- **Acquis en place** (ne pas re-construire) : **ids = clés métier stables** (PK texte déterministe, pas d'UUID aléatoire côté nœuds) ; **projecteur = snapshot complet par ville + gate de complétude**.
- **Gates jq** : `null-category=0`, contrat respecté, **ids stables**, **convergence incrémental↔full**, **rejouabilité prouvée** (replay d'une ville-témoin depuis raw = équivalent).

### 3. Filtre UI (immo)
- **En-tête fixe non décochable** : « Périmètre : zonage résidentiel » (indéterminé GARDÉ + badge « usage à confirmer »).
- **Type** : PIIA non-pertinent exclu ; **PIIA lié** à un projet résidentiel = gardé, badge « PIIA lié / confiance faible » ; **dérogation** = rang selon **motif** (inconnu → indéterminé ; +logement prouvé → pas bas).
- **Axe Anticipation** ordonné (défaut pré-adoption ; tardifs accessibles/triables).
- **Badges haute-valeur** (RANKING, jamais gate) : **Refonte détectée** (neutre tant que Δ non prouvé), **PPCMOI**.
- **Toggle « Ancien mode / Nouveau mode »** (A/B) ; **parité compteurs serveur/rail/panneau testée** (cas : résidentiel connu, non-résidentiel, indéterminé, PIIA densifiant, dérogation densifiante, PPCMOI, second projet, consultation, étapes multiples).
- Retrait du filtre **multi4** (fix intérimaire déjà lancé).

## COMPLÉMENT GEO (4) — données additionnelles pour le tri réel + scoring
Sur le **vivier candidat** (≈30 focus villes d'abord, extensible) :
- **(a) effet densifiant = Δ grille** : densité autorisée **AVANT↔APRÈS** sur la **zone touchée**. Dépend du **mapper signal↔zone (#74)** + les **2 millésimes de grille**. → remplit `effet_densifiant`. **C'est le critère central de Steve.**
- **(b) exploitabilité foncière** : lot subdivisible, superficie, **évaluation municipale** (rôle).
- **(c) propriétaire** : rôle + Registraire (cadre conformité **D7**).
- Chaque donnée servie avec **millésime + provenance** (leçon Mont-Tremblant : « servi pour le bon millésime »).

## SCORING (5) — gaté, non figé
Par critères, data-gated, **abstention + couverture**, `inconnu ≠ favorable`. Agrège une fois (4) servi. À figer après.

## A/B + ROLLBACK
- **Filtrage** : feature-flag `mode=ancien|nouveau`, **même donnée**.
- **Données** : graphify 3.4 **projection shadow** + **bascule atomique**.
- **Évaluation objective** : contre les **marques de la carte de Steve** (favori/en vente/sollicité sur Delson/Ste-Catherine/St-Constant/Candiac) **+** les **30 notes** — rappel, précision@K, taux d'abstention, **zéro « inconnu rendu favorable »** (cible).

## CIBLE IMMÉDIATE geo
Les ~30 focus villes (zonage résidentiel à signaux) **resteront** dans le nouveau filtre → geo **démarre dès maintenant** le complément (4a Δ densité + 4b foncier) dessus.
