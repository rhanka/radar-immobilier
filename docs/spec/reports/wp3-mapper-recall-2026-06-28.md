# WP3 — Mesure du rappel du mapper signal↔zone (réel, 2026-06-28)

> Tâche #74. **Mesure réelle**, chiffres exacts, zéro extrapolation. Pas de Track, pas de git.
> Méthode reproductible (commandes bornées) en fin de document.

## TL;DR

- **Rappel LIVE (mapper tel quel) : 52 / 110 codes désignés = 47,3 %** sur les
  **55 villes** où (a) un signal/événement désigne une zone *et* (b) une collection
  `qc-zonage-<slug>` est servie. **28 / 55 villes** ont un rappel complet, **32 / 55**
  ont ≥ 1 appariement.
- **Un seul fix immo trivial et vérifié** (lire les champs de zone non-candidats)
  monte le rappel à **63 / 110 = 57,3 %** (+9,1 pts) et débloque **rimouski 0→5/5**,
  **saint-hyacinthe 0→4/4**, **hampstead 0→2/3**.
- **L'hypothèse « zéro de tête » est RÉFUTÉE** : 0 cas sur 58 non-appariés.
  Partout où le code existe des deux côtés, le padding est **identique**
  (chambly `C-020`↔`C-020`, rimouski `C-062`↔`C-062`, st-hyacinthe `H-01`↔`H01`).
  Le suspect « C-020 vs C-20 » n'existe pas dans la donnée réelle.
- Répartition des **58 codes non-appariés (LIVE)** : **champ-non-lu 11 (19,0 %)**,
  **format-zéro-tête 0 (0,0 %)**, **écart-schéma 10 (17,2 %)**, **gap-data 37 (63,8 %)**.
- Le gros du déficit (**~81 %** des non-matchs) n'est **pas** normalisable côté immo :
  c'est de l'**extraction graphify trop grossière** ou des **données/couches geo
  divergentes** — pas un bug de `zoneRefComparableKey`.

---

## 1. Périmètre mesuré (compté, pas estimé)

| Élément | Valeur | Source |
|---|---|---|
| Graphes S3 scannés (`graph/<city>/latest.json`) | **1009** | `s5cmd ls`+`cp`, bucket `radar-immobilier-docs-pocs` |
| Villes dont ≥1 nœud Signal/DesignationEvent/Bylaw/Zone porte un code de zone | **357** | scan champs `zone_ref`/`zone_cible`/`code` |
| Codes de zone distincts cités (toutes villes) | **1036** | idem |
| Collections `qc-zonage-*` servies | **512** | `GET api.geo.sent-tech.ca/collections?f=json` |
| Villes citantes **avec** collection exacte `qc-zonage-<slug>` servie | **82** | intersection |
| … dont ≥1 code **désigné par Signal/DesignationEvent/Bylaw** | **55** | périmètre de mesure du rappel |
| Codes désignés distincts mesurés | **110** | — |

> Note de périmètre : sur les 512 collections `qc-zonage-*`, ~200 sont des couches
> ArcGIS ré-attribuées (`-arcgis`, `-affectation…`, `-piia`, schémas SAD, etc.) que
> **le mapper ne requête jamais** (il construit `qc-zonage-${citySlug}` en dur). Le
> rappel se mesure donc sur les collections exactes `qc-zonage-<slug>` uniquement.
>
> Aucune troncature de pagination : pour les 82 collections, `numberMatched ==
> numberReturned` (max = saguenay, 2838 features) ; `limit=5000` couvre tout.

---

## 2. Rappel global

**Dénominateur = codes désignés par un signal** (champs structurés
`zone_ref`/`zoneRef`/`zone`/`zone_cible` sur Signal/DesignationEvent/Bylaw — ce que
le mapper extrait via `extractSignalZoneRefs`). C'est la définition stricte de
« zones citées par les signaux ».

| Mesure | LIVE (mapper tel quel) | Après fix immo (champs non-lus) |
|---|---|---|
| **Codes appariés** | **52 / 110 = 47,3 %** | **63 / 110 = 57,3 %** |
| Villes rappel complet | 28 / 55 | 30 / 55 |
| Villes ≥1 appariement | 32 / 55 | 35 / 55 |

**Vue « modelled » (contexte)** : si on inclut aussi les nœuds `Zone` modélisés par
graphify (codes plus fins que le `zone_ref` du signal), le rappel est **117 / 189 =
61,9 %**. C'est plus haut parce que les nœuds Zone portent parfois le code de
grille précis (`H1-30`) là où le signal ne cite que la famille (`H1`).

> Rapprochement avec la mesure préliminaire « 0/3 » : cette mesure-là est obsolète
> (antérieure à la flexibilité de nom de champ). La mesure réelle large donne 47,3 %
> codes / 32 villes avec ≥1 match — **et chambly `C-020` matche bien aujourd'hui**.

---

## 3. Tableau par ville (périmètre 55)

`servi` = nb de features servies ; `champ` = champ réellement utilisé (ou
`AUCUN→<champ réel>` quand le mapper ne lit rien) ; `grille` = champ lien-grille.

| ville | cités | servi | champ | grille | match LIVE | après fix | cause |
|---|---|---|---|---|---|---|---|
| bedford--brome-missisquoi--2 | 1 | 73 | `zone_code` | - | 1/1 | 1/1 | - |
| chambly | 1 | 246 | `NumZone` | LienGrille | 1/1 | 1/1 | - |
| cheneville | 1 | 21 | `zone_code` | - | 1/1 | 1/1 | - |
| clermont--charlevoix-est | 1 | 108 | `zone_code` | - | 1/1 | 1/1 | - |
| coaticook | 2 | 178 | `zone_code` | Grille | 2/2 | 2/2 | - |
| compton | 2 | 92 | `zone_code` | Grille | 2/2 | 2/2 | - |
| contrecoeur | 3 | 164 | `zone_code` | - | 3/3 | 3/3 | - |
| la-sarre | 1 | 132 | `zone_code` | - | 1/1 | 1/1 | - |
| lac-brome | 4 | 194 | `zone_code` | - | 4/4 | 4/4 | - |
| lavenir | 1 | 68 | `zone_code` | - | 1/1 | 1/1 | - |
| levis | 4 | 1716 | `zone_code` | - | 4/4 | 4/4 | - |
| neuville | 1 | 127 | `zone_code` | - | 1/1 | 1/1 | - |
| notre-dame-de-lourdes--joliette | 1 | 43 | `zone_code` | - | 1/1 | 1/1 | - |
| notre-dame-du-bon-conseil--drummond | 1 | 44 | `zone_code` | - | 1/1 | 1/1 | - |
| orford | 3 | 126 | `zone_code` | - | 3/3 | 3/3 | - |
| pierreville | 1 | 63 | `zone_code` | - | 1/1 | 1/1 | - |
| portneuf | 2 | 161 | `zone_code` | - | 2/2 | 2/2 | - |
| potton | 4 | 113 | `zone_code` | - | 4/4 | 4/4 | - |
| saint-alban | 1 | 100 | `zone_code` | - | 1/1 | 1/1 | - |
| saint-francois-du-lac | 2 | 63 | `zone_code` | - | 2/2 | 2/2 | - |
| saint-gilbert | 1 | 29 | `zone_code` | - | 1/1 | 1/1 | - |
| saint-jean-baptiste | 2 | 58 | `zone_code` | - | 2/2 | 2/2 | - |
| saint-joachim-de-shefford | 2 | 38 | `zone_code` | - | 2/2 | 2/2 | - |
| saint-marc-des-carrieres | 1 | 116 | `zone_code` | - | 1/1 | 1/1 | - |
| saint-ours | 1 | 49 | `zone_code` | - | 1/1 | 1/1 | - |
| sainte-perpetue--nicolet-yamaska | 1 | 25 | `zone_code` | - | 1/1 | 1/1 | - |
| salaberry-de-valleyfield | 1 | 640 | `zone_code` | - | 1/1 | 1/1 | - |
| waterloo | 1 | 118 | `zone_code` | - | 1/1 | 1/1 | - |
| amos | 5 | 39 | `zone_code` | - | **0/5** | 0/5 | gap-data |
| beaupre | 1 | 0 | `AUCUN→Zone` | - | **0/1** | 0/1 | gap-data (couche affectation) |
| charlemagne | 5 | 1 | `zone_code` | - | **0/5** | 0/5 | gap-data (1 seule zone `URB`) |
| cowansville | 3 | 239 | `zone_code` | - | 1/3 | 1/3 | gap-data |
| hampstead | 3 | 0 | `AUCUN→Zone` | - | **0/3** | **2/3** | champ-non-lu + gap |
| nicolet | 1 | 183 | `zone_code` | - | **0/1** | 0/1 | gap-data (grille `H01-xxx`) |
| notre-dame-du-bon-conseil--drummond--2 | 1 | 12 | `zone_code` | - | **0/1** | 0/1 | écart-schéma (grille grossière) |
| repentigny | 1 | 8 | `zone_code` | - | **0/1** | 0/1 | gap-data (grille `AGF/URB`) |
| rimouski | 5 | 0 | `AUCUN→NO_ZONAGE` | URL_GRILLE | **0/5** | **5/5** | champ-non-lu |
| rosemere | 1 | 102 | `zone_code` | - | **0/1** | 0/1 | gap-data (`C-18` absent) |
| saguenay | 2 | 2838 | `code` | - | **0/2** | 0/2 | écart-schéma + gap |
| saint-amable | 2 | 104 | `zone_code` | - | 1/2 | 1/2 | gap-data (`CEN-183` absent) |
| saint-cyrille-de-wendover | 3 | 17 | `zone_code` | - | **0/3** | 0/3 | écart-schéma (grille mono-lettre) |
| saint-felix-de-kingsey | 1 | 8 | `zone_code` | - | **0/1** | 0/1 | écart-schéma (grille mono-lettre) |
| saint-frederic | 2 | 6 | `zone_code` | - | **0/2** | 0/2 | gap-data (zones **proposées** A16/I93) |
| saint-hyacinthe | 4 | 0 | `AUCUN→ETIQUETTE` | GRILLE_URL | **0/4** | **4/4** | champ-non-lu (champ composite) |
| saint-joseph-de-kamouraska | 1 | 15 | `zone_code` | - | **0/1** | 0/1 | gap-data (extraction `13m et 15rzi`) |
| saint-lin-laurentides | 4 | 115 | `zone_code` | - | **0/4** | 0/4 | gap-data (famille vs sous-zone `H1-x`) |
| saint-mathias-sur-richelieu | 1 | 78 | `zone_code` | - | **0/1** | 0/1 | gap-data (`R-0` improbable) |
| saint-raphael | 1 | 64 | `code` | - | **0/1** | 0/1 | gap-data (grille = numéros de lot) |
| saint-raymond | 4 | 350 | `zone_code` | - | 2/4 | 2/4 | gap-data (`HC-14`,`RU-30` absents) |
| saint-tite-des-caps | 2 | 0 | `AUCUN→Zone` | - | **0/2** | 0/2 | gap-data (couche affectation) |
| sainte-cecile-de-milton | 2 | 32 | `zone_code` | - | 1/2 | 1/2 | gap-data (`RE-9` absent) |
| shawinigan | 2 | 0 | `AUCUN→zone_` | - | **0/2** | 0/2 | gap-data (grille `H-5xxx`) |
| shefford | 4 | 64 | `zone_code` | - | **0/4** | 0/4 | écart-schéma (grille numérique pure) |
| stratford | 1 | 50 | `zone_code` | - | **0/1** | 0/1 | gap-data (`RU-13` absent) |
| warden | 1 | 4 | `zone_code` | - | **0/1** | 0/1 | gap-data (pas de famille `H`) |

---

## 4. Catalogue collection → champ (livrable)

### 4.1 Champ de code de zone (sur les 82 collections servies du périmètre)

| Champ réellement porteur du code | Nb collections | Lu par le mapper aujourd'hui ? |
|---|---|---|
| `zone_code` | 70 | **oui** |
| `code` | 5 (saguenay, saint-damien-de-buckland, saint-henri, saint-raphael, sainte-claire) | **oui** |
| `NumZone` | 1 (chambly) | **oui** |
| **`Zone`** (majuscule, reste minuscule) | hampstead | **non** (seuls `ZONE`/`Zonage` sont candidats) |
| **`NO_ZONAGE`** | rimouski | **non** |
| **`NUM_ZONE` / `ETIQUETTE`** (composite `"<id>  <CODE>"`) | saint-hyacinthe | **non** |
| **`zone_`** (souligné final) | shawinigan | **non** |
| `Zone` **vide** (couche affectation) | beaupre, saint-tite-des-caps | n/a (champ vide) |

> Le mapper (`zones-client.ts → normalizeOgcZoneFeature`) teste déjà 13 candidats
> (`code, Code, zoneCode, zone_code, ZONE, Zonage, zonage, NumZone, num_zone,
> No_zone, no_zone, code_affiche, codeAffiche`). Les 5 variantes ci-dessus (en gras)
> tombent à travers, **par sensibilité à la casse** principalement.

### 4.2 Champ lien-grille (livrable demandé)

Le nom du lien-grille est **hétérogène** et **non lu** par le mapper (la couche
zonage n'expose pas le lien actuellement) :

| Collection | Champ lien-grille |
|---|---|
| chambly | `LienGrille` |
| rimouski | `URL_GRILLE` |
| saint-hyacinthe | `GRILLE_URL` |
| coaticook, compton | `Grille` |

Les autres collections du périmètre n'ont **aucun** champ lien-grille.

---

## 5. Répartition des causes (58 codes non-appariés LIVE)

| Cause | Codes | % | Fixable côté… |
|---|---|---|---|
| **champ-non-lu** | 11 | **19,0 %** | **immo (trivial, vérifié)** |
| **format-zéro-tête** | 0 | **0,0 %** | — (hypothèse réfutée) |
| **écart-schéma** | 10 | 17,2 % | graphify / geo |
| **gap-data** | 37 | 63,8 % | graphify (extraction) / geo (données) |

Règle de classement (déterministe, documentée pour audit) :
1. **champ-non-lu** = le mapper lit `null` (champ non candidat) mais la collection
   porte bien le code sous un autre champ — **vérifié** : lire ce champ apparie.
2. **format-zéro-tête** = clés comparables ne différant que par des zéros de tête.
3. **écart-schéma** = la grille servie encode la **même** zone autrement : grille
   **numérique pure** (lettre retirée : shefford `13`↔`R-3` ; saguenay `124`↔`124-P`)
   ou grille **mono-lettre grossière** (`R`,`I`,`AP` au lieu de `R-2`,`I-1`,`AP-3`).
4. **gap-data** = la zone citée est **absente** de la grille servie sous toute forme
   (zone proposée, mauvaise couche servie, granularité famille↔sous-zone, ou code
   d'extraction erroné). Choix **conservateur** : tout cas limite est classé
   gap-data plutôt qu'écart-schéma, pour ne pas sur-vendre une fixabilité.

### Détail champ-non-lu (11 codes — tous récupérables)
- **rimouski** `A-9003, A-9145, C-062, C-384, H-312` → champ `NO_ZONAGE` (0→5/5).
- **saint-hyacinthe** `H-01, H-23, H-24, M-03` → 2e token de `ETIQUETTE` (0→4/4).
- **hampstead** `RA-2, RB-6` → champ `Zone` (0→2/3 ; `I-11` reste un gap réel).

### Détail écart-schéma (10 codes)
shefford `AF-13,R-3,RV-2,RV-3` (grille = nombres nus `1..36`) ; saint-cyrille-de-wendover
`R-2,R-3,R-23` (grille mono-lettre `R,C,P,…`) ; saint-felix-de-kingsey `I-1` (mono-lettre) ;
notre-dame-du-bon-conseil--drummond--2 `AP-3` (grille grossière) ; saguenay `124-P`
(grille numérique, `124` servi).

### Nature des gap-data (37 codes) — split utile
- **Extraction graphify grossière/erronée** (~14) : `H1`,`H3` (saint-lin, shawinigan,
  warden, repentigny, nicolet) cités comme famille alors que la grille porte la
  sous-zone `H1-x`/`H01-xxx`/`H-5xxx` ; `R-0` (improbable) ; `13m et 15rzi`
  (texte non parsé) ; `C2-11` (amos). → **à signaler à graphify**.
- **Mauvaise couche / grille geo absente** (~10) : beaupre & saint-tite-des-caps
  (couche **affectation** vide, pas la grille) ; charlemagne (1 zone `URB`) ;
  saint-raphael (`code` = numéros de lot, pas des zones) ; repentigny (grille
  `AGF/URB/IND-A`). → **à signaler à geo**.
- **Zones réellement absentes / proposées** (~13) : saint-frederic `A16/I93`
  (**zones à créer** par le règlement 419-26 — non-match **attendu**, déjà géré par
  `mergeDesignatedZones` côté UI) ; rosemere `C-18`, saint-amable `CEN-183`,
  saint-raymond `HC-14/RU-30`, stratford `RU-13`, sainte-cecile `RE-9`,
  cowansville `C53/Rc-23`… (codes voisins servis, code exact absent → vrai trou).

---

## 6. Trois fixes à plus fort levier

### Fix 1 — Lire les champs de zone non-candidats (immo, trivial, vérifié) ⭐
**Levier : +11 codes, +9,1 pts (47,3 % → 57,3 %), 3 villes débloquées.**
Dans `ui/src/lib/maps/zones-client.ts`, fonction `normalizeOgcZoneFeature`, étendre
la liste de candidats `firstString([...])`. **L'ordre compte** (premier non-vide
gagne) :

```ts
const code = firstString([
  properties.code, properties.Code, properties.zoneCode, properties.zone_code,
  properties.ZONE, properties.Zonage, properties.zonage,
  properties.Zone,        // ← AJOUT (hampstead ; majuscule-tête)
  properties.NO_ZONAGE,   // ← AJOUT (rimouski)
  properties.zone_,       // ← AJOUT (shawinigan — débloque la lecture, voir caveat)
  properties.NumZone, properties.num_zone, properties.NUM_ZONE, // ← NUM_ZONE pour casse
  properties.No_zone, properties.no_zone,
  properties.Code_zone,   // ← AJOUT en DERNIER (hampstead grossier RA/RB ; ne doit
                          //    PAS précéder Zone sinon il écrase RA-2 par RA)
  properties.code_affiche, properties.codeAffiche,
]);
```
Caveats à ne pas rater (raison du « non commit » ici, à valider en revue) :
- **saint-hyacinthe** : `NUM_ZONE` est un **ID numérique** (`10001`), PAS le code.
  Le code est le **2e token de `ETIQUETTE`** (`"10003  H01"`→`H01`) → nécessite un
  **parse dédié**, pas un simple candidat. (+4 codes une fois fait.)
- **shawinigan** : ajouter `zone_` fait *lire* la grille mais le rappel reste 0
  (grille `H-5xxx` ≠ `H1/H3` cités → gap, voir Fix 2).
- `Zone` avant `Code_zone` impératif (sinon hampstead régresse).

### Fix 2 — Aligner la granularité d'extraction de zone (graphify)
**Levier : ~14 codes gap-data dus à une extraction trop grossière/tronquée.**
graphify émet souvent la **famille** (`H1`, `H3`, `R-2`) ou un texte non parsé
(`13m et 15rzi`, `R-0`, `C2-11`) là où la grille servie porte le **code précis**
(`H1-30`, `H01-104`, `H-5012`). À signaler à graphify : extraire le code de grille
**complet** (lettre + secteur + numéro), et/ou exposer côté geo un mapping
famille↔sous-zones pour un rabattement contrôlé. Bénéfice partiellement déjà visible
via les nœuds `Zone` (rappel modelled 61,9 % > 47,3 %).

### Fix 3 — Corriger les collections geo « mauvaise couche » (geo)
**Levier : ~10 codes + crédibilité de la carte.**
Plusieurs `qc-zonage-<slug>` ne sont **pas** la grille de zonage :
- **beaupre**, **saint-tite-des-caps** : couche **affectation / plan d'urbanisme**
  (champ `Zone` vide ; `Affectatio = "Agricole dynamique"…`) — aucun code de grille.
- **saint-raphael** : champ `code` = `788, 789, 1134…` (numéros de lot, pas de zones).
- **charlemagne** : 1 seule feature `URB`. **repentigny** : grille `AGF/URB/IND-A`.
À signaler à geo : remplacer ces collections par la vraie grille de zonage
municipale, ou ne pas les exposer sous le préfixe `qc-zonage-` (faux positif de
couverture).

---

## 7. Conclusion anti-survente

- Le **join et la normalisation côté immo sont sains** : 28/55 villes en rappel
  complet, et le seul correctif immo (champs non-lus) est **borné, sûr et vérifié**
  (+9,1 pts). `zoneRefComparableKey` n'est **pas** le coupable.
- **L'hypothèse « zéro de tête » est fausse** sur la donnée réelle (0/58).
- **Le plafond de rappel atteignable côté immo seul est ~57 %.** Passer au-delà exige
  un travail **graphify** (granularité d'extraction) et **geo** (couches correctes) —
  ~81 % des non-matchs sont là, pas dans le mapper.

---

## Annexe — Méthode reproductible (commandes bornées)

```bash
# Graphes (creds .env SCRAPE_S3_*) — 1009 latest.json
export PATH="$PWD/tmp/bin:$PATH"; set -a; source .env; set +a
export AWS_ACCESS_KEY_ID="$SCRAPE_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SCRAPE_S3_SECRET_KEY"
s5cmd --endpoint-url https://s3.fr-par.scw.cloud ls   s3://radar-immobilier-docs-pocs/graph/
s5cmd --endpoint-url https://s3.fr-par.scw.cloud run  dl.txt   # cp .../graph/<city>/latest.json

# Collections servies (512 qc-zonage-*)
curl -s --max-time 20 "https://api.geo.sent-tech.ca/collections?f=json"

# Codes servis via le passthrough radar (champ + codes), limit=5000, --max-time 90
curl -s "http://localhost:3000/api/geo/collections/qc-zonage-<slug>/items?limit=5000"
```
Schéma nœud graphe : `node.type ∈ {Signal,DesignationEvent,Bylaw,Zone}`,
`node.properties.{zone_ref, zone_cible, code}`. Normalisation de comparaison
identique au runtime : `zoneRefComparableKey` (majuscule, demi-cadratin→ASCII,
suffixe secteur retiré, espaces **et** tirets supprimés ; **pas** de strip des
zéros de tête).

---

## 6. Re-mesure GLOBALE finale (2026-06-29, après fixes immo + geo)

Mesure live authoritative sur les 55 villes d'intersection, logique de champ finale
(`zone_code` > `ZONE/Zone/Zonage/NO_ZONAGE/zone_` > `ETIQUETTE` composite > `code/Code`
générique > ids séquentiels `NumZone/NUM_ZONE`) :

**RAPPEL GLOBAL = 71/120 = 59,2 %** — 31 villes rappel complet, 36 villes ≥1 match,
19 à zéro.

Progression : 47,3 % (mesure initiale) → 59,2 %. Apports :
- **immo** (commités) : `zone_code` priorité 1, `NO_ZONAGE`/`ETIQUETTE`/`Zone`/`zone_` lus,
  ordre code-réglementaire-avant-ids-séquentiels, `code` générique après OBJECTID.
  Récupéré : rimouski 0→5/5, saint-hyacinthe 0→4/4, hampstead 0→2/3, saint-raphael 0→1/1.
- **geo** : ajout `zone_code` normalisé sur villes Lot A (copy brut), flags des couches
  affectation/admin (beaupre, saint-tite, charlemagne, saint-cyrille, saint-felix, shefford,
  saguenay, notre-dame--2) = pas la vraie grille → acquisition future.

Plafond atteint des deux côtés. Prochain gain rappel = (a) acquisition des vraies grilles
réglementaires (~8 villes affectation, geo futur) + (b) granularité extraction graphify
(#68 : famille `H1` vs sous-zone `H1-30`, zones proposées).
