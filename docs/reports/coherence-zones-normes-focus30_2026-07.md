# Cohérence E2E — zones ↔ grilles (normes) sur le focus-30 — juillet 2026

**Mesure LIVE** de l'API geo OGC (`api.geo.sent-tech.ca`) le 2026-07-10, sur les 31 villes du focus (villes portant un signal prioritaire z∩m∩p). Pour chaque ville : ensemble des `zone_code` servis en zonage (`qc-zonage-<slug>`) vs ensemble des `zone_code` portant une grille de normes (`qc-zonage-norms-<slug>`), et taux de recouvrement **zone↔grille** = codes communs / codes de zonage.

> **Anti-invention** : on mesure le recouvrement de codes réel, pas une promesse. Un taux bas = la grille servie ne correspond pas aux zones servies (millésime disjoint), OU la grille est absente, OU le zonage est absent.

## Verdict

**La cohérence zone↔grille est le maillon le plus faible du focus.** Sur 31 villes : **9 OK** (≥50 % des zones ont leur grille), **9 partielles**, **6 avec grille servie mais 0 % mappé** (millésime disjoint), **5 sans grille**, **2 sans zonage**. Seules ~9/31 villes ont une chaîne zone→grille exploitable.

## Mont-Tremblant — confirmé cassé

| Élément | Valeur |
|---|---|
| Zones servies (codes) | **626** — série `RA-4xx / CA-3xx / CV-3xx / TO-6xx` |
| Lots avec `zone_code` | **100 %** (ex. `TO-618-1`) |
| Grille servie (codes) | **54** — série `RA-1xx / TM-1xx / VA-1xx` |
| Codes communs zone∩grille | **51 / 626** |
| **Taux zone↔grille** | **8 %** |
| Normes foldées sur lots (échantillon) | **0 %** |

**Diagnostic** : le SIG zonage servi de Mont-Tremblant (millésime récent, codes `RA-4xx`…) et la grille de normes extraite (millésime ancien, codes `RA-1xx`…) sont **deux millésimes différents** → quasi aucune zone servie n'a de norme applicable. C'est un **trou de données à ré-acquérir côté geo** (SIG municipal réel à re-sourcer, comme repentigny/beaupré l'ont été), pas un bug d'affichage immo. L'application doit afficher **honnêtement** « grille non mappée » plutôt qu'une fausse valeur.

## Table complète (31 villes)

| Ville | zones (codes) | grille (codes) | communs | zone↔grille | note |
|---|---:|---:|---:|---:|---|
|  mont-tremblant |  626 |  54 |  51 |  8% |  partiel |
|  saint-frederic |  6 |  ABSENTE |  0 |  0% |  grille absente |
|  saint-mathieu-de-beloeil |  54 |  39 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  sainte-catherine |  190 |  50 |  43 |  23% |  partiel |
|  saint-amable |  104 |  111 |  95 |  91% |  ok |
|  rimouski |  1067 |  8 |  6 |  1% |  partiel |
|  rosemere |  102 |  7 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  saint-raymond |  350 |  342 |  323 |  92% |  ok |
|  champlain |  65 |  ABSENTE |  0 |  0% |  grille absente |
|  saint-come-liniere |  77 |  1 |  1 |  1% |  partiel |
|  coaticook |  178 |  ABSENTE |  0 |  0% |  grille absente |
|  mont-saint-hilaire |  240 |  250 |  237 |  99% |  ok |
|  saint-stanislas-de-kostka |  48 |  63 |  47 |  98% |  ok |
|  cowansville |  239 |  243 |  233 |  97% |  ok |
|  levis |  1716 |  30 |  29 |  2% |  partiel |
|  petite-riviere-saint-francois |  127 |  ABSENTE |  0 |  0% |  grille absente |
|  plaisance |  53 |  30 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  saint-raphael |  64 |  93 |  3 |  5% |  partiel |
|  alma |  0 |  ABSENTE |  0 |  - |  zonage absent |
|  chelsea |  164 |  223 |  154 |  94% |  ok |
|  hemmingford--les-jardins-de-napierville--2 |  38 |  3 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  saint-boniface |  0 |  ABSENTE |  0 |  - |  zonage absent |
|  saint-charles-borromee |  136 |  13 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  sainte-cecile-de-milton |  32 |  1 |  1 |  3% |  partiel |
|  la-sarre |  132 |  77 |  76 |  58% |  ok |
|  notre-dame-de-lourdes--lerable |  38 |  ABSENTE |  0 |  0% |  grille absente |
|  preissac |  25 |  36 |  12 |  48% |  partiel |
|  saint-gilbert |  29 |  22 |  20 |  69% |  ok |
|  sutton |  217 |  46 |  0 |  0% |  0% mappé (millésime disjoint?) |
|  neuville |  127 |  109 |  77 |  61% |  ok |
|  stratford |  50 |  86 |  7 |  14% |  partiel |

## Lecture par catégorie

- **OK (≥50 %)** : saint-raymond (92 %), mont-saint-hilaire (99 %), saint-stanislas-de-kostka (98 %), cowansville (97 %), chelsea (94 %), saint-amable (91 %), saint-gilbert (69 %), neuville (61 %), la-sarre (58 %).
- **Partiel (<50 %)** : mont-tremblant (8 %), sainte-catherine (23 %), stratford (14 %), saint-raphael (5 %), levis (2 %), rimouski (1 %), saint-come-liniere (1 %), sainte-cecile-de-milton (3 %), preissac (48 %).
- **Grille servie mais 0 % mappé (millésime disjoint)** : saint-mathieu-de-beloeil, rosemere, plaisance, hemmingford, saint-charles-borromee, sutton.
- **Grille absente** : saint-frederic, champlain, coaticook, petite-riviere-saint-francois, notre-dame-de-lourdes.
- **Zonage absent** : alma, saint-boniface.

## Actions

1. **Geo (prio)** : ré-acquérir le SIG zonage au bon millésime pour les villes « millésime disjoint » (mont-tremblant en tête) + servir la grille pour les 5 « grille absente ». Backlog transmis.
2. **Immo** : afficher honnêtement l'état zone↔grille (mappée / non mappée / absente) au lieu d'une norme vide silencieuse ; consommer `qc-zonage-norms-<slug>` seulement quand les codes matchent.
3. **Nuance de comptage** : le listing OGC brut sur-compte les zones (variantes `-arcgis`, dépôts multi-sources) ; le vrai « munis avec zones exploitables » est plus bas que le nombre de collections. À aligner avec le décompte autoritatif geo.

*Mesure : `api.geo.sent-tech.ca` OGC, 2026-07-10. Échantillon lots MT = 60. Codes normalisés en majuscules.*
