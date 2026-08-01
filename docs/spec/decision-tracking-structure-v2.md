# Décision-dossier — Structure de tracking stable v2 (9 WP)

- **Date** : 2026-08-01
- **Rôle** : architect (design/doc)
- **Statut** : structure **validée par le propriétaire**, écriture Track **en attente de déblocage** (§7)
- **Supersède** : `docs/spec/decision-tracking-structure-v1.md` §2 (6 WP) et §8 (taxonomie 29 sous-items)
- **Track CLI de référence** : `@sentropic/track` **0.90.1**

---

## 1. Motif du changement

`WP3.4` (« Métriques rappel/précision & parité Steve ») se confondait à l'oral et à l'écrit avec
**`graphify 3.4`** (version du pipeline d'annotation). Deux objets sans rapport partageaient la même
chaîne `3.4`.

**Règle de nommage adoptée (v2)** :

1. **Une version porte toujours son artefact** — `graphify v3.4`, `ontologie v2.2`. Jamais un numéro nu.
2. **`WPx.y` ne désigne qu'un sous-WP** — jamais une version, jamais un lot, jamais un millésime.

Conséquence structurelle : les métriques sortent de WP3 et deviennent **WP5 RECETTE**, un WP de plein
droit ; le vivier B′ sort de l'extraction et devient **WP3** ; un **WP8 SPEC & CONTRATS** est créé.

---

## 2. Structure cible — 9 WP

| WP | Titre | Sous-WP |
|---|---|---|
| **WP1** | DATA — sources & substrat | 1.1 Liste villes & périmètre · 1.2 Recueil texte (PV/avis/YouTube) · 1.3 Zones, grilles & lots (servis par geo) |
| **WP2** | EXTRACTION — annotation & ontologie | 2.1 Pipeline annotation `graphify v3.4` · 2.2 Citations / grounding / page-bbox · 2.3 Entités & ontologie · 2.4 Orchestration à l'échelle |
| **WP3** | VIVIER — classification & filtre B′ | 3.1 Axes z / r / p · 3.2 Instruments & lexique · 3.3 Exclusions & éligibilité résidentielle · 3.4 Compteurs & parité serveur/client |
| **WP4** | RÉCONCILIATION & PREUVE | 4.1 Niveau 1 signal × PDF · 4.2 Niveau 2 signal × zone · 4.3 Niveau 3 signal × zone × grille × lot · 4.4 Preuve & provenance geo |
| **WP5** | RECETTE — mesure & parité Steve | 5.1 Rejeu sur corpus de production · 5.2 Rappel / précision · 5.3 Parité tableau Steve · 5.4 Budget de sortants |
| **WP6** | PRODUIT — app radar client | 6.1 Vue Signaux · 6.2 Vue Opportunités · 6.3 Vue Évaluation + fiche lot · 6.4 Vue Sources · 6.5 Marques / notes / filtres · 6.6 Exports · 6.7 Viewer de preuve PDF |
| **WP7** | PLATEFORME & DÉPLOIEMENT | 7.1 Auth & session · 7.2 MCP immo · 7.3 Persistance S3-first / rebuild · 7.4 Scale & agents remote · 7.5 CD & déploiement · 7.6 Chat-ui / llm-mesh |
| **WP8** | SPEC & CONTRATS | 8.1 Spec du vivier B′ · 8.2 Contrat geo (frontière, preuve, jointure) · 8.3 Ontologie & versions · 8.4 Critères de recette · 8.5 Décision-dossiers |
| **WP9** | GOUVERNANCE — pilotage & reporting | 9.1 Structure track & WP · 9.2 Reporting multi-échelle · 9.3 Kanban / projection · 9.4 Remote → h2a |

## 3. Correspondance ancien → nouveau

| Ancien | ID Track (v1) | Devient |
|---|---|---|
| WP1 DATA — sources & substrat | `01KW775D02BW0DRNEA8RP6BTG8` | **WP1** (inchangé) |
| WP2 EXTRACTION — signaux & ontologie | `01KW775D4QVAD4V4Z0JKAME5TZ` | **WP2** (annotation) **+ WP3** (le vivier B′ en sort) |
| WP3.1 / 3.2 / 3.3 — niveaux de réconciliation | `01KW775D96JRBM3RKN6D4CZ8W2` | **WP4.1 / 4.2 / 4.3** |
| **WP3.4 Métriques rappel/précision & parité Steve** | `01KW7HWC4PDZD7V50HTY6QY2HS` | **WP5** — promu WP de plein droit |
| WP4 PRODUIT — app radar client | `01KW775DDRD2FE8XRV3CXE7NF6` | **WP6** |
| WP5 PLATEFORME & SCALE | `01KW775DJE2BJ28ZKPANYHY3S6` | **WP7** |
| WP6 GOUVERNANCE | `01KW775DPR13V8Q1B2GNM7WSDX` | **WP9** |
| *(n'existait pas)* | — | **WP8 SPEC & CONTRATS** — neuf |

---

## 4. Contraintes du CLI Track 0.90.1 découvertes (structurantes)

Trois contraintes réelles, vérifiées dans `@sentropic/track@0.90.1`, conditionnent la mise en œuvre.

### 4.1 `item reparent` **interdit** le déplacement cross-workspace

`track.js:222` — `cannot reparent across workspaces: item X is in "a", parent Y is in "b"`.
Les 120 items hors WP vivent dans ~20 workspaces (`reorientation`, `frontA-viz`, `wp5-ontology`,
`evdoc-branch-*`, `carte-signaux-parite`…). **`item reparent` est donc inutilisable ici.**

### 4.2 `restructure apply --plan` est la voie autorisée

`track restructure apply --plan <plan.json>` est *« the AUTHORIZED cross-workspace move »* (DESIGN R2/C4).
Elle ne lève **que** la garde cross-workspace ; toutes les autres gardes tournent. Forme du plan :

```json
{
  "restructureRef": "docs/spec/decision-tracking-structure-v2.md",
  "baseline": { "streamLength": <N>, "lastContentHash": "sha256:…" },
  "edges": [ { "itemId": "01…", "parentId": "01…" } ]
}
```

Garanties : `planHash` content-addressed · `clientToken = f(planHash,itemId)` (rejeu = no-op) ·
dry-run cycle/role-nesting **avant** tout append · gate post-apply (intention, closure, zéro orphelin
hors plan) · **baseline anti-TOCTOU obligatoire**.

> La `baseline` épingle `streamLength` + `lastContentHash`. **Tout événement ajouté au journal entre
> le calcul du plan et son application invalide le plan** (`baseline precondition failed — re-plan`).
> C'est la raison technique pour laquelle le blocage §7 doit être tranché *avant* de calculer le plan.

### 4.3 Les titres d'items sont **immuables** — la renumérotation passe par `item assign-code`

Il n'existe **aucun** verbe de retitrage dans le CLI. Le seul levier d'affichage est
`track item assign-code <itemId> --code <c>`, qui pose un **code d'affichage durable** sur un
role-container ; le rollup le rend **verbatim** à la place du `WP<n>` positionnel dérivé du ULID.

Sans code, la numérotation est **dérivée de l'ordre ULID** : les 3 WP neufs (ULID postérieurs)
prendraient WP7/WP8/WP9 et les anciens garderaient WP1…WP6. **Les codes sont donc obligatoires.**

---

## 5. Mise en œuvre recommandée — option « hybride »

Le retitrage étant impossible, trois options ont été pesées :

| Option | Description | Verdict |
|---|---|---|
| A | Coder les 6 WP existants (WP3→`WP4`, WP4→`WP6`, WP5→`WP7`, WP6→`WP9`) | **Rejetée** — 4 WP sur 9 afficheraient un code contredisant leur propre titre (« WP3 · RÉCONCILIATION » affiché `WP4`). Exactement l'ambiguïté qu'on supprime. |
| B | Créer 9 WP neufs, annuler les 6 anciens | Rejetée — churn maximal, perd 2 identités inutilement. |
| **C** | **Garder WP1 et WP2 (numéro inchangé) ; créer 7 WP neufs correctement titrés ; annuler les 4 anciens renumérotés une fois vidés** | **Retenue** — aucun titre ne contredit son code, churn minimal. |

**Séquence d'exécution (option C)** :

1. `track item new --kind feature --role workpackage --title "WP3 · VIVIER — classification & filtre B′" --workspace wp3-vivier` — idem WP4, WP5, WP6, WP7, WP8, WP9.
2. `track item assign-code <id> --code WP1` … `--code WP9` sur les 9 racines (stabilise l'affichage indépendamment des ULID).
3. Créer les sous-WP manquants (WP3.1–3.4, WP5.1–5.4, WP8.1–8.5) dans le workspace de leur WP parent.
4. Calculer `plan.json` (baseline lue à cet instant) et `track restructure apply --plan plan.json` :
   - déplacement des **33 sous-WP v1** vers leur nouveau WP (§3) ;
   - rattachement des **65 racines hors WP** (§6) ;
5. `track item realize <id> cancelled` sur les 4 anciens WP vidés (WP3/WP4/WP5/WP6 v1).
6. Vérification : `track validate` · `track audit` · `track report --wp --sub-wp` · total d'items **identique**.

---

## 6. Rattachement des 120 items hors WP — 65 arêtes

`hors WP` pesait **118 items sur 151** au reporting (120 items bruts, 2 annulés exclus du dénominateur).

**Principe** : le rollup attribue un item au **plus haut ancêtre `role:workpackage`**. Déplacer la
**racine d'un sous-arbre déplace tout le sous-arbre**. 65 arêtes suffisent donc pour couvrir 120 items
— et l'arborescence interne existante (lots L1–L6, A.1.1–A.1.4, CS-*, defects DS…) est **préservée
telle quelle**, pas aplatie.

Couverture vérifiée : **120/120, zéro item non couvert, zéro identifiant inconnu.**

| WP cible | Items gagnés | Racines rattachées (extrait significatif) |
|---|---|---|
| **WP1** DATA | 20 | `WP A.2 — Data: identification progressive` (+10 : A.2.1 villes/périmètre, A.2.2 scraper PV, A.2.3 YouTube, Sources *) · `WP4 — Sources #2-5` (+4) · WP4-A · WP4-B · Ciblage CiblagePlan · geo sert superficie/adresse/code postal |
| **WP2** EXTRACTION | 17 | Graphify v2.3 · Graphify evidence contract (+2) · Parsing graphify PV · Entités additionnelles ontologie · Orchestration remote 3272 docs · Pipeline exploitation · Reliquats grounding citations · Consolidation couche preuve · Graphify legacy (annulé) |
| **WP3** VIVIER | 4 | `Remove the hallucinated multifamily 4+ signal filter` (+3) — filtre B′ / éligibilité |
| **WP4** RÉCONCILIATION | 20 | `WP B — Vertical profond geo (zone→lot)` (+2 : WPB-E2E 33, Geo propriétaires) · `Evidence-backed signal document cards` (+7) · Studio réconciliation + write-core · Ownership geo preuve PDF · Consensus reversal immo→geo · item geoproof |
| **WP5** RECETTE | 3 | CS-L6 (maquette substrat réel Netlify Steve, 4 villes) · Script bootstrap simulation · Vue Sources — validation exhaustive de couverture |
| **WP6** PRODUIT | 31 | `WP A.1 — Visualisation géographique-centrique` (+4 : Vues Signaux/Opportunités/Évaluation/Sources) · `P1 DS alignment` (+6 **défauts DS** : header non canonique, police non chargée app-wide, filtres Signaux non cochés, état non persisté, taille police, déclarations font hors tokens) · `P2 Selection bucket UX` (+2) · `P3 Zones and lots display` (+3) · **CS-L1, CS-L2, CS-L3, CS-L4, CS-L5** · CS-P1, CS-P2 (+1) · DS redesign · P4 Data quality view · Viewer PDF surlignage bbox |
| **WP7** PLATEFORME | 21 | `WP Persistance S3-first` (+6 : **lots L1–L6**) · `WP A.3 — Infrastructure data & agents` (+4) · Auth durable Sentropic · P5 Admin validation view · Déploiement k8s · graphify → DB graphe Postgres · Mount S3 SCW · CS-P3 (sync + AUTH) · chat.test.ts clés provider |
| **WP8** SPEC | 1 | `Réorientation « Grand filet »` (racine, une fois ses 13 enfants redistribués) → 8.5 décision-dossiers |
| **WP9** GOUVERNANCE | 3 | Recalage Track (drift/consolidation) · Backlog ↔ track · Backlog actualisation live |

**Arbitrages notables**

- **CS-L1…CS-L5 → WP6**, conformément au mapping v1 (l'ancien WP4.5 portait explicitement « CS-L3–L5 »).
  **CS-L6 → WP5** : c'est un rejeu sur substrat réel de Steve, donc de la recette, pas du produit.
- **CS-P3 → WP7** (backend sync temps réel + AUTH) et non WP6.6 : c'est de l'infrastructure.
- **`WP B` (vertical geo zone→lot) → WP4.3** : c'est la chaîne de réconciliation niveau 3, pas de la data.
- Les 6 **défauts DS** restent groupés sous `P1 DS alignment` et suivent leur parent vers WP6.
- L'item `geoproof-branch-…` → WP4.4 : il provient d'événements non commités (§7).

**Aucun item laissé hors WP.** Les 2 items annulés (`A.2.5 Captcha→Obscura`, `Graphify legacy redo
OBSOLÈTE`) sont **rattachés quand même** — ils suivent leur parent (resp. WP A.2 → WP1, et WP2) et
restent comptés `DROPPED`, donc exclus du dénominateur. Aucun rattachement forcé n'a été nécessaire :
les deux ont un foyer naturel par filiation.

---

## 7. Blocage — écriture Track non effectuée

Au 2026-08-01, `.track/` du checkout principal porte **9 événements non commités** (journal à 658
événements contre 649 sur `origin/main`), produits le **2026-07-24** par une **autre session** :
création de l'item « Immo ↔ Geo : preuves auditables pour zones et lots » + import de
`plan/GEOPROOF-BRANCH_feat-immo-proof-provenance-link.md`.

Constats :

- `track validate` → **OK, 658 événements, integrity + desync clean** (le journal n'est pas corrompu) ;
- **aucun écrivain actif** (mtime 8 jours, aucun processus, aucun lock) ;
- la branche correspondante `feat/immo-proof-provenance-link` est **déjà fusionnée dans `main` (PR #420)** :
  ces événements sont le **reliquat track d'une session terminée**, pas un travail en cours.

`.track/events.jsonl` étant **append-only et mono-fichier**, il est **impossible de commiter la
réorganisation sans embarquer ces 9 événements d'autrui** dans le même commit. S'y ajoute la
contrainte §4.2 : la `baseline` du plan épingle le journal, donc la question doit être tranchée
**avant** de calculer le plan.

**Décision demandée au propriétaire** — préco : **(a)**.

- **(a) Recommandé** — commiter d'abord les 9 événements dans un commit séparé et honnête
  (`chore(track): commit des événements en attente de la session geoproof (PR #420)`), puis appliquer
  la réorganisation dans un second commit. Provenance préservée, baseline propre.
- (b) Les inclure dans le commit de réorganisation — provenance brouillée, non recommandé.
- (c) Les écarter — à exclure : leur PR est déjà fusionnée, le journal perdrait la trace d'un travail livré.
