# Design — Indicateurs de cohérence E2E par ville (vue Sources) — volet OPUS 4.8

> Volet OPUS 4.8 d'un double consensus (le volet codex 5.5 est produit en
> parallèle : `DESIGN_E2E_CONSISTENCY_SOURCES_codex.md`). Le conducteur
> réconcilie les deux en une conception unique à valider avant implémentation.

## 1. Couverture vs cohérence (le vrai sujet)

La vue Sources mesure aujourd'hui la **COUVERTURE** : chaque couche est-elle
présente pour la ville ? (PV, signaux, zones, normes, lots, TOD, + les nouveaux
champs lot superficie/adresse/CP). C'est **présence/absence par couche**.

Le principal demande la **COHÉRENCE DES MAPPINGS** : les couches se **joignent**-elles ?
Un signal désigne-t-il une zone qui **existe et est servie** ? Une zone a-t-elle
**sa** grille ? Un lot est-il rattaché à une zone servie ? C'est la **chaîne E2E**,
pas la présence isolée. Une ville peut être « tout servi » en couverture mais
**rompue** en cohérence (ex. signaux qui pointent des zones non servies).

## 2. Le DAG E2E et la métrique par arête

Chaîne de vérité : **PV → Signal → Zone → Grille → Lot** (+ TOD ; superficie/adresse
= attributs de complétude du lot).

| Arête | Métrique (nom UI neutre) | Numérateur / Dénominateur | Type |
|---|---|---|---|
| PV → Signal | **Signaux sourcés** | signaux avec citation vérifiable dans un PV collecté / total signaux | rappel |
| Signal → Zone | **Signaux rattachés à une zone** | signaux dont ≥1 zone désignée est SERVIE par geo / signaux qui désignent une zone | rappel (mapper #74) |
| Signal → Zone | **Rattachement fiable** | rattachements par arête-graphe (confiance 0.9) / rattachements totaux (vs repli texte 0.35) | précision |
| Zone → Grille | **Zones avec grille** | zones servies portant ≥1 norme (hauteur/densité/marges…) / zones servies | rappel |
| Zone → Lot | **Lots rattachés à une zone** | lots dont `zone_code` ∈ zones servies / lots servis | rappel |
| Lot (attrs) | **Complétude lot** | lots avec superficie/adresse/CP / lots | rappel (déjà en couverture) |

Deux natures à NE PAS confondre :
- **RAPPEL** = « combien de la chaîne est câblé » (couverture de la jointure).
- **PRÉCISION** = « les câblages sont-ils justes » (arête-graphe fiable vs repli
  texte faible confiance). Le mapper #74 produit les deux ; la vue doit les
  distinguer (un 100 % de rappel par repli texte à 0.35 n'est pas de la cohérence).

## 3. Calcul par ville (sources réelles, honnête sur le coût)

- **PV↔signaux (grounding)** : déjà mesuré (`signals.withCitation` de
  `source-coverage.ts`) → réutiliser, **live**.
- **Signal↔zone (rappel/précision)** : c'est la sortie du **mapper #74**
  (`run-geo-mapper.ts` / `measure-geo-mapping.ts`, via `priority-resolver` :
  graph-edge conf 0.9 vs text-fallback 0.35). **BATCH, pas live** → servir la
  DERNIÈRE mesure datée par ville (ne pas recalculer à chaque affichage).
- **Zone↔grille** : geo OGC `qc-zonage-<slug>` (présence de normes sur la zone)
  ou `qc-zonage-norms-<slug>` → % zones avec norme. **Calculable via échantillon
  OGC borné**, comme la couverture actuelle.
- **Zone↔lot** : geo OGC `qc-lots-<slug>` → % lots dont `zone_code` ∈ ensemble
  des `zone_code` servis en zonage. Échantillon OGC borné.
- Marquer **« estimé »** tout ce qui vient d'un échantillon ; **daté** ce qui
  vient d'un batch (mapper). Jamais de valeur inventée (verbatim-or-null).

## 4. Score E2E par ville — le maillon faible, pas une moyenne

**Décision de conception forte : PAS de score composite moyenné.** Moyenner
les arêtes masque un maillon rompu (une ville à 100 % partout sauf zone↔grille=0
n'est pas « 80 % E2E », elle est **rompue à la grille**).

- Afficher le **VECTEUR** : une barre/valeur par arête (4-5 lignes).
- Dériver un **statut E2E tri-état** = le **pire maillon servi** (même logique
  que le « pire statut honnête » de la couverture, cf. `computeCoverageStatus`) :
  E2E « Complet » seulement si toutes les arêtes de la chaîne tiennent ; sinon
  **« Rompu à <arête> »** (ex. Mont-Tremblant → « Rompu à zone↔grille : aucune
  grille »).
- **Aligner sur les axes** : le vrai KPI de maturité = le **statut E2E des 30
  villes du focus** (z∩m∩p) — c'est le « 33/30 » rendu en cohérence, pas juste
  en couverture. Un agrégat province (X villes E2E-complètes / 1104) complète.

## 5. Intégration UI (scorecard + Console)

- **Scorecard** (`SourceScorecard.svelte`) : sous la section couverture actuelle,
  une section **« Cohérence E2E »** avec une ligne par jointure :
  « Signaux sourcés X% · Signaux rattachés à une zone X% (dont fiables Y%) ·
  Zones avec grille X% · Lots rattachés à une zone X% », + un **bandeau maillon
  rompu** mis en avant. Le « Prochaine étape » existant devient **dérivé du
  maillon rompu** (MT → « compléter les grilles, attendu de geo »).
- **Console** (`SourceConsole.svelte`) : colonnes de cohérence (ou un badge/statut
  E2E) + **tri par maillon faible** (voir d'un coup les villes E2E-rompues).
- **Copy neutre, zéro jargon** : « signaux rattachés à une zone » (pas « mapper »),
  « zones avec grille » (pas « join zone↔norms »). Anti-survente : afficher le
  rappel ET la précision quand la précision est basse (repli texte).

## 6. Faisabilité, coût, risques

**Faisable court terme (API couverture existante + échantillon OGC)** :
zone↔grille, zone↔lot, PV↔signaux (déjà mesuré).

**Dépend du mapper #74 (batch)** : signal↔zone rappel/précision → servir la
dernière mesure, prévoir un job de rafraîchissement ; ne pas bloquer la vue.

**Risques à cadrer** :
1. **Dénominateurs multiples** — ne jamais mélanger « tous signaux » et « signaux
   prioritaires z∩m∩p » ; chaque taux dit son dénominateur.
2. **Faux positifs du repli texte** (confiance 0.35) — un rattachement texte n'est
   PAS de la cohérence forte ; séparer graph-edge (0.9) de text-fallback.
3. **Échantillonnage OGC** — borné → marquer « estimé », ou passer par un agrégat
   serveur si le coût le permet.
4. **Score trompeur** — refuser la moyenne composite (maillon faible only).
5. **Fraîcheur hétérogène** — le mapper (batch daté) et la couverture (live) n'ont
   pas la même fraîcheur ; l'afficher.

## 7. Ce que ça donnerait sur Mont-Tremblant (exemple)

PV✓ · Signaux sourcés 100% (13/13 citation) · Signaux rattachés à une zone ? (mapper)
· **Zones avec grille 0% (aucune grille publiée)** · Lots rattachés à une zone ?
→ **Statut E2E : rompu à « zones↔grille »**, prochaine étape « compléter les grilles
(attendu de geo, ré-acquisition millésime) ». Exactement ce que le principal veut
voir d'un coup d'œil, par ville.
