# WP1 — État des DONNÉES par source × focus (substrat)

> **Mandat** : répondre « où on en est sur la data » (réunion mardi).
> **Auteur** : subagent WP1 (DATA). **Date** : 2026-06-28. **Mode** : lecture seule
> (aucune stack, aucun commit, aucune branche, Track non muté).
> **Mesures** :
> - S3 graphes : audit frais `tmp/drumbeats/2.3-fresh/graph-versions.tsv`,
>   **2026-06-28 09:01 -04:00** (1010 villes catées via `s5cmd cat .../latest.json | jq .ontology_version`).
> - API geo OGC `https://api.geo.sent-tech.ca/collections?f=json` : **interrogée live
>   2026-06-28** (HTTP 200, 2 695 collections, 1.86 Mo). Comptage joignable par slug.
> - Registre villes : `packages/radar-sources/src/geo/municipalities.qc.json` (1106 records).
> - RACI : `docs/spec/data-division-immo-geo.md` (proposition rhanka 2026-06-21, **non
>   ratifiée live avec geo**, h2a quiet) + décision proprio `docs/spec/decision-proprietaires-lots-geo-loi25.md`.

---

## 0. Définition des deux focus

| Focus | Définition | Nombre | Source canonique |
|---|---|---|---|
| **focus:30** | villes démo prioritaires = `priorityRank` 1→30 (CMM / Rive-Sud / West Island, proches Montréal) | **30** | `municipalities.qc.json` champ `priorityRank` |
| **focus:1104** | couverture provinciale = registre complet **moins** exclues | **1104** | `1106 total − 2 exclues (Montréal, Laval, excluded:true)` |

Repères du registre : total **1106**, exclues **2**, dépriorisées (pop>100k) **9**,
éligibles **1104** (tous `priorityRank` 1..1104).

---

## 1. Matrice condensée source × focus

Légende statut : ✅ présent · 🟡 partiel · ❌ manquant. RACI = owner **cible** (data-division §2).

| Source (ligne) | focus:30 | focus:1104 | Source de vérité | Owner cible (R/A) | Statut honnête |
|---|---|---|---|---|---|
| **villes (geo)** registre | ✅ 30/30 | ✅ 1104/1104 | `municipalities.qc.json` + OGC `qc-municipalites` | **geo** (cible) / immo (actuel) | fait — statique régénérable |
| **pv** (graphe exploité, toutes versions) | 🟡 27/30 | 🟡 **1007/1104 (91,2 %)** | S3 `graph/<city>/latest.json` | **immo** (R/A), geo C (OCR) | fait pour 91 %, 97 villes 0 graphe |
| **pv** — dont **v2.3** (cible courante) | 🟡 25/30 | 🟡 **976/1104 (88,4 %)** | idem (`ontology_version`) | immo | 88 % migrées, 31 encore v2.2 |
| **zones — désignations** (`zone_ref`/`reglement` sur Signal/DesignationEvent) | 🟡 spot-check | 🟡 partiel, **non recensé** | S3 graph `properties.zone_ref` | **immo** (mapper sémantique) | hétérogène (Delson 4, Longueuil 0) — pas de census |
| **zones — géo** (polygones zonage) | 🟡 **2/30** | 🟡 **211/1104 (19,1 %)** joignables | OGC `qc-zonage-<slug>` | **geo** (R/A), immo C | gros trou : 211 propres + 295 fragments bruts non normalisés |
| **zones — grilles** (usages/normes/affectations) | ❌ 0 | ❌ 0 structuré | — (absente) | geo? / immo? non spécifié | non-disponible : pas de couche dédiée |
| **lots — cadastre/géo** (polygones + `NO_LOT`) | ✅ **30/30** | ✅ **1102/1104 (99,8 %)** | OGC `qc-lots-<slug>` | **geo** (R/A), immo C | fait — adapters immo supprimés, immo consomme |
| **lots — refs en PV** (`no_lot` sur signaux) | 🟡 spot-check | 🟡 partiel, **non recensé** | S3 graph `properties.no_lot` | **immo** (mapper) | hétérogène (Delson 8, Longueuil 0) |
| **lots — proprio** (propriétaire) | ❌ 0 | ❌ 0 | — | **geo** (transféré, accès contrôlé) | bloqué par design — Loi 25, décision 2026-06-27 |

---

## 2. Détail focus:30 (rang prioritaire)

graphe **27/30** · v2.3 **25/30** · lots **30/30** · zonage joignable **2/30**.

| rang | ville | graphe | lots | zonage |
|---|---|---|---|---|
| 1-6 | westmount, saint-lambert, hampstead, mont-royal, montreal-ouest, cote-saint-luc | v2.3 | Y | — |
| 7 | **longueuil** | v2.3 | Y | **Y** |
| 8 | **brossard** | **NONE** | Y | — |
| 9-15 | sainte-catherine, la-prairie, delson, candiac, montreal-est, boucherville, dorval | v2.3 | Y | — |
| 16 | **lile-dorval** | **NONE** | Y | — |
| 17 | **saint-constant** | **v2.2** | Y | — |
| 18-21 | saint-bruno-de-montarville, carignan, dollard-des-ormeaux, pointe-claire | v2.3 | Y | — |
| 22 | **saint-philippe** | **v2.2** | Y | — |
| 23-27 | saint-mathieu, chateauguay, sainte-julie, saint-basile-le-grand, chambly | v2.3 | Y | — |
| 28 | **rosemere** | v2.3 | Y | **Y** |
| 29 | varennes | v2.3 | Y | — |
| 30 | **kirkland** | **NONE** | Y | — |

Trous focus:30 — graphe absent : **brossard, lile-dorval, kirkland** ; encore v2.2 :
**saint-constant, saint-philippe** ; zonage absent : **28/30** (seuls longueuil + rosemere).

---

## 3. Couverture focus:1104 (chiffres exacts)

| Mesure | Valeur | Méthode (reproductible) |
|---|---|---|
| Villes éligibles | 1104 | `municipalities.qc.json` non `excluded` |
| Graphe S3 (toute version) | **1007** (91,2 %) | hash-join `graph-versions.tsv` ∩ éligibles |
| dont v2.3 | **976** (88,4 %) | `ontology_version=="2.3"` |
| dont v2.2 (à migrer) | **31** | `ontology_version=="2.2"` |
| **Sans aucun graphe** | **97** (8,8 %) | éligibles ∖ graphe |
| Graphes S3 hors slug éligible | 3 | `graph` (parasite), `hemmingford`, `saint-damase` (slugs MRC-dédoublonnés) |
| **Lots** `qc-lots-<slug>` joignables | **1102** (99,8 %) | collections OGC ∩ éligibles ; 0 mismatch |
| Éligibles sans lots | 2 | **austin, saint-marc-du-lac-long** |
| **Zonage** `qc-zonage-<slug>` joignables | **211** (19,1 %) | collections OGC ∩ éligibles |
| Collections `qc-zonage-*` totales | 506 | dont **295 fragments bruts** non normalisés (ex. `arcgis-longueuil-zonage-agricole`, `a-lachance-zonage-…`) |
| Collections « slug nu » (harvest brut/ville) | 1083 | 1080 ∩ lots-cities — dump intermédiaire, ≠ couche propre |
| Province-level geo | qc-municipalites, qc-mrc, qc-regions, qc-cadastre-* | OGC |

Note v2.3 : l'ancien `2.3-completude-1105-FRESH.md` indiquait `missing_v23=451` —
**artefact de collation** (tri JS code-point vs `comm` octet). Le hash-join recalculé
ici donne **976 v2.3 / 1104** (manquantes = 128 : 97 sans graphe + 31 v2.2).

### Désignations / refs en PV (spot-check, NON censusé)

Échantillon de 3 graphes v2.3 (`properties` sur Signal+DesignationEvent) :

| ville | nodes | DesignationEvents | zone_ref | no_lot | reglement | etape |
|---|---|---|---|---|---|---|
| salaberry-de-valleyfield | 23 | 9 | 1 | 0 | 0 | 13 |
| longueuil | 23 | 3 | 0 | 0 | 0 | 4 |
| delson | 60 | 12 | 4 | 8 | 5 | 17 |

→ `etape` (v2.1) bien peuplé partout ; **`zone_ref`/`no_lot`/`reglement_number`
hétérogènes** (conforme cadrage §1 : extraction texte ~30 %). Le census exact des
1010 graphes n'a pas été fait (coût : 1010 téléchargements).

---

## 4. RACI synthétique (geo par défaut, immo sur la sémantique texte)

| Flux | R/A cible | Justification | État réel |
|---|---|---|---|
| Registre villes | **geo** | donnée géo pure (mrc/coord/pop) ; immo garde overlay `priorityRank`/`excluded` | porté par immo, **délégation non ratifiée** (h2a quiet) |
| Scraping PV + détection sémantique avis-motion→règlement→zonage | **immo** | cœur produit, anti-invention, indélégable | actif, 91 % couverture |
| Mapper résolution (texte→`zone_ref`/`no_lot`/`etape`) | **immo** | jointure temporelle as-of-date | actif, taux résolution partiel |
| Acquisition LOTS (cadastre allégé) | **geo** | couche provinciale générique | **fait** (adapters immo supprimés, OGC consommé) |
| Acquisition ZONES (polygones) | **geo** | scrapers plateformes géo génériques | partiel (211 propres, harvest brut non normalisé) |
| Grilles usages/affectations | non tranché | n'existe pas en couche structurée | **absent** |
| Proprio de lot | **geo** (accès contrôlé) | Loi 25, payant/captcha, séparé des couches publiques | **bloqué par design** (décision 2026-06-27) |
| OCR PV scannés / géoréf plans | **geo** (primitive) / immo (orchestration) | geo a vision/RANSAC ; stub immo non câblé | non câblé |

---

## 5. Les 3 plus gros trous DATA

1. **ZONAGE quasi absent et non normalisé** — seulement **211/1104 (19 %)** villes ont
   une couche zonage joignable, et **2/30 seulement** en focus démo (longueuil, rosemere).
   295 collections `qc-zonage-*` sont des fragments bruts ArcGIS/CKAN non réduits à
   1/ville. C'est le trou structurant : sans zonage, le signal « changement de zonage »
   n'a pas de polygone cible sur 81 % du territoire et 93 % de la démo. **Owner = geo.**
2. **PV : 97 villes éligibles (8,8 %) sans aucun graphe + 31 encore v2.2** — dont
   **3 villes démo** sans graphe (brossard, lile-dorval, kirkland) et 2 démo en v2.2
   (saint-constant, saint-philippe). Sur la démo, 5/30 ne sont pas en v2.3. **Owner = immo.**
3. **GRILLES (usages/normes) inexistantes + PROPRIO bloqué** — aucune couche structurée
   grille des usages/affectations (0/1104) ; le propriétaire de lot est bloqué par design
   (Loi 25) et transféré à geo en accès contrôlé non encore implémenté. La sémantique fine
   (densité permise, usages) manque ; les désignations `zone_ref`/`no_lot` dans les graphes
   restent hétérogènes (non recensées, ~30 %).

---

## 6. Commandes de mesure (reproductibles)

```bash
cd /home/antoinefa/src/radar-immobilier
set -a; . ./.env; set +a
export AWS_ACCESS_KEY_ID="$SCRAPE_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$SCRAPE_S3_SECRET_KEY"
S5=tmp/bin/s5cmd; EP="$SCRAPE_S3_ENDPOINT"; B="$SCRAPE_S3_BUCKET"

# PV / graphe : version par ville (cher : 1 cat/ville)
$S5 --endpoint-url "$EP" ls "s3://$B/graph/" | awk '{print $NF}' | sed 's#/##' | sort -u > /tmp/gc.txt
: > /tmp/gv.tsv; while read -r c; do v=$($S5 --endpoint-url "$EP" cat "s3://$B/graph/$c/latest.json" \
  | jq -r '.ontology_version // "?"'); printf '%s\t%s\n' "$c" "$v" >> /tmp/gv.tsv; done < /tmp/gc.txt

# Zones / lots : collections OGC geo (live, rapide)
curl -s "https://api.geo.sent-tech.ca/collections?f=json" | jq -r '.collections[].id' > /tmp/coll.txt
grep -c '^qc-lots-'   /tmp/coll.txt   # 1102
grep -c '^qc-zonage-' /tmp/coll.txt   # 506 (dont ~295 bruts)

# Cible éligible + focus30
node -e 'const m=require("./packages/radar-sources/src/geo/municipalities.qc.json");\
for(const x of m)if(!x.excluded)console.log(x.slug)' > /tmp/elig.txt          # 1104
node -e 'const m=require("./packages/radar-sources/src/geo/municipalities.qc.json");\
for(const x of m)if(x.priorityRank<=30)console.log(x.slug)' > /tmp/f30.txt     # 30

# Couverture (hash-join, robuste collation) — ex. lots ∩ éligibles
grep '^qc-lots-' /tmp/coll.txt | sed 's/^qc-lots-//' \
  | awk 'NR==FNR{e[$1]=1;next}{if($1 in e)c++}END{print c"/1104"}' /tmp/elig.txt -
```
