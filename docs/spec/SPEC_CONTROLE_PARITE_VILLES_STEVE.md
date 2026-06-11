# SPEC — Table de contrôle & cadre de PARITÉ sur les 4 villes de Steve

> Statut : **spec / cadrage**. Travail de SPEC uniquement (aucun code applicatif ;
> `detectZonageChange` et le store opérationnel restent **intacts**).
>
> **Décision produit amont (tranchée par l'utilisateur, 2026-06-11)** : on **importe** le corpus de
> l'équipe Steve, **mais dans une TABLE DE CONTRÔLE** (référence / *golden*), **pas** dans le store
> opérationnel des prospects. But : **vérification de PARITÉ** entre (a) la donnée de
> **référence** (importée de Steve) et (b) la donnée que **NOTRE pipeline scrape/dérive**. Les
> 4 villes de Steve deviennent des **points de contrôle**. Conséquence directe : on **priorise le
> scrape EN PROFONDEUR** de ces 4 villes pour reproduire la donnée de Steve et pouvoir la *diffّer*.
> Cette décision **résout l'encadré « DÉCISION EN ATTENTE »** de
> [`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`](SPEC_EVOL_INTEGRATION_CARTE_STEVE.md) §6.2.
>
> Entrées :
> - Corpus Steve : [`input/carte-steve/README.md`](input/carte-steve/README.md) (features + données
>   d'usage), [`input/carte-steve/tech/ARCHITECTURE.md`](input/carte-steve/tech/ARCHITECTURE.md)
>   (schéma JSON + Firestore), [`input/carte-steve/tech/analyse-donnees.json`](input/carte-steve/tech/analyse-donnees.json)
>   (compteurs réels par ville), [`input/carte-steve/tech/cities.json`](input/carte-steve/tech/cities.json)
>   (index des 4 villes).
> - Data model : [`SPEC_DESIGN_DATA_MODEL.md`](SPEC_DESIGN_DATA_MODEL.md) (entités load-bearing).
> - Intégration carte : [`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md`](SPEC_EVOL_INTEGRATION_CARTE_STEVE.md)
>   (§4.1 `ProspectMark`, §6 maquette, §6.2 mapping JSON→radar, §6.2.1 garde-fou).
> - Scoring / états : [`SPEC_EVOL_SOCLE_STATES_SCORING.md`](SPEC_EVOL_SOCLE_STATES_SCORING.md)
>   (score de potentiel par lot, pré-filtres §2.1, frontière réel §2.7, `non-disponible` §3.4.0).
> - Plan de scraping : [`SPEC_PLAN_SCRAPING.md`](SPEC_PLAN_SCRAPING.md) (sources, `CityProfile` §2.3).

## 0. Thèse en une phrase

Le corpus de Steve est une **vérité-terrain externe** : une équipe humaine a déjà *qualifié* 4 villes
(cadastre + rôle + zonage + TOD, et 5 247 marques de prospection à Sainte-Catherine). On l'**importe
en référence isolée** (« table de contrôle / golden »), puis on **mesure la parité** entre cette
référence et ce que **notre** pipeline produit en scrapant les **mêmes** 4 villes en profondeur.
La parité **mesure** le pipeline ; elle ne le **nourrit jamais** (séparation stricte, §3).

## 1. Les 4 villes de contrôle (golden cities)

Slugs exacts (source [`input/carte-steve/tech/cities.json`](input/carte-steve/tech/cities.json) +
[`tech/analyse-donnees.json`](input/carte-steve/tech/analyse-donnees.json)) — **toutes Roussillon /
CMM, Montérégie Rive-Sud** :

| Ville (slug) | Lots | Zones | TOD | Marques équipe (Firestore) | Couverture data Steve |
|---|---:|---:|---|---|---|
| `delson` | 3 213 | 101 | 4 polygones (1 443 lots TOD) | aucune | **complète** : 278 lots 4+, **130 priorité (4+∩TOD)**, descriptions de zone (Règl. 901) |
| `sainte-catherine` | 5 615 | 193 (dessinées éditeur) | 0 | **5 favoris, 5 043 non-retenus, 1 sollicité, 204 lettres, 1 pastille PPCMOI** | 868 lots 4+ ; grilles PDF par préfixe ; Règl. 2009-Z-00 ; zonage `data/sainte-catherine-zones.json` |
| `saint-constant` | 11 261 | 265 | 1 polygone (5 287 lots TOD) | aucune | rôle le plus riche ; 642 lots 4+ ; grilles par `_fallback_map` ; `zones_4plus` (26 codes) |
| `candiac` | 7 190 | 0 | 0 | aucune | **brut** : lots + rôle seuls, **aucun zonage ni TOD** (zones-json → 404) ; 9 lots 4+ |

Total : **27 279 lots** (README §Vue d'ensemble). Les compteurs `n_4plus`/`n_tod`/`n_prio` par ville
viennent de [`analyse-donnees.json`](input/carte-steve/tech/analyse-donnees.json) (vérité Steve, sert
de **cible de calibration** §4).

> **Codes MAMH non disponibles dans le corpus** : la rétrodoc Steve **ne porte pas** les codes
> géographiques MAMH des 4 villes (le plan ne connaît que `70052` Valleyfield —
> `SPEC_PLAN_SCRAPING.md` §A5). On **n'invente pas** ces codes (anti-invention,
> `SPEC_DESIGN_DATA_MODEL.md` §0.3) : ils sont à **résoudre** lors de l'enregistrement de chaque
> ville dans `CityProfile` (`SPEC_PLAN_SCRAPING.md` §2.3, champ `codeMamh`) — voir §6 mécanisme
> d'import. Tant que non résolus → `verification:"non-disponible"`.

## 2. Modèle « table de contrôle »

### 2.1 Principe — dataset de référence **isolé** du store opérationnel

La table de contrôle est un **dataset de référence parallèle** : elle **miroite** la fiche lot de
Steve (cadastre, rôle, zone, TOD, statut équipe) **sans** réutiliser les entités opérationnelles
`Lot`/`LotVersion`/`ProspectMark`/`DesignationEvent`. Deux entités nouvelles, **et seulement** de
contrôle :

- **`ControlLot`** = le miroir, par ville, d'un lot de la fiche Steve (substrat cadastre + rôle +
  zone + TOD + flags). Clé naturelle **`(citySlug, NO_LOT)`** — la même clé universelle QC que
  `Lot` (`SPEC_DESIGN_DATA_MODEL.md` §1.2, `noLot` = `NO_LOT` cadastral RL0103Ax).
- **`ControlMark`** = le miroir d'une marque d'équipe Firestore (`non-retenu`/`lettre`/`favori`/
  `sollicité`/`en-vente`) **telle qu'elle existe chez Steve**, attachée par `(citySlug, NO_LOT)`.

```ts
// === TABLE DE CONTRÔLE (référence golden Steve) — JAMAIS le store opérationnel ===

interface ControlLot {
  // --- identité (clé naturelle = la jointure de parité) ---
  citySlug: string;                 // "delson" | "sainte-catherine" | "saint-constant" | "candiac"
  noLot: string;                    // NO_LOT cadastral normalisé (espaces ôtés, §6 / §6.2 EVOL)

  // --- miroir cadastre (analyse-donnees.json : NO_LOT, superficie, geom) ---
  superficieM2: number | null;      // ← superficie_m2_calculee
  adresseCivique: string | null;    // ← adresse
  geomRef: GeoJSONGeometry | null;  // ← lots[].geometry (Polygon/MultiPolygon WGS84)

  // --- miroir rôle 2022 (Steve) ---
  usageCategorie: string | null;    // ← categorie (Résidentiel/Mixte/Industriel/…)
  cubf: string | null;              // ← cubf (5xxx ⇒ multi-logements)
  utilisation: string | null;       // ← utilisation ("Résidentiel 1 log.", …)
  anneeConstruction: string | null; // ← annee_construction
  nbLogementsRole: number | null;   // ← nb_logements_role
  nbEtages: string | null;          // ← nb_etages
  valTotale: number | null;         // ← val_totale
  valTerrain: number | null;        // ← val_terrain
  valBatiment: number | null;       // ← val_batiment
  facadeM: number | null;           // ← facade_m
  profondeurM: number | null;       // ← profondeur_m (souvent 0 → null)

  // --- miroir zone / TOD ---
  zoneCodeRef: string | null;       // ← zone ("H-322", "N/D", "")
  todRef: boolean;                  // ← tod (∈ périmètre TOD côté Steve)

  // --- flags DÉRIVÉS par Steve (cible de calibration, JAMAIS importés comme vérité radar) ---
  multifamilial4plusRef: boolean;   // ← multifamilial_4plus
  prioriteRef: boolean;             // ← priorite (= 4plus && tod, précalculé Steve)

  // --- provenance / honnêteté ---
  source: "carte-steve-control";    // jamais "real" du pipeline
  importedAt: string;               // ISO timestamp de l'import de contrôle
  verification: "fait" | "hypothese" | "non-disponible" | "simulé"; // §1.0 data model
}

interface ControlMark {
  citySlug: string;
  noLot: string;                    // attache à ControlLot par (citySlug, NO_LOT)
  status: "favori" | "non-retenu" | "sollicité" | "lettre" | "en-vente"; // marks Steve (ARCHITECTURE §Firebase)
  note?: string;                    // ← lot_notes[NO_LOT]
  prixDemande?: number;             // ← listings[NO_LOT].prix (si "en-vente")
  lienAnnonce?: string;             // ← listings[NO_LOT].url
  who: string; role: string;        // données D'ÉQUIPE Steve (jamais propriétaire — Loi 25, §2.4)
  source: "carte-steve-control";
  importedAt: string;
}
```

> **Note vocabulaire** : `ControlMark.status` reprend les **5 libellés bruts de Steve**
> (`non-retenu`, `lettre`…) — il ne **mappe pas** sur les `ProspectMark.status` radar
> (`écarté`, `lettre-envoyée`… — `SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §4.1). La table de contrôle
> conserve la **sémantique d'origine** (c'est une *référence*, pas une projection radar). Le mapping
> de libellés est appliqué **seulement** dans le rapport de parité, à des fins de comparaison (§4.3).

### 2.2 Articulation au data model existant (sans pollution)

| Entité de contrôle | Miroir de (data model) | Réutilise ? | Pollue ? |
|---|---|---|---|
| `ControlLot` (cadastre/rôle) | `Lot`/`LotVersion`, `Valuation` (§1.2/§1.4 `SPEC_DESIGN_DATA_MODEL.md`) | **non** (table séparée) | **non** |
| `ControlLot.zoneCodeRef`/`todRef` | `ZoneVersion.codeAffiche`, couche `requalification-tod` (§1.1) | **non** | **non** |
| `ControlMark` | `ProspectMark` (§4.1 EVOL) | **non** (sémantique Steve conservée) | **non** |
| — | `DesignationEvent` (§1.3) | **non** (aucun événement émis) | **non** |

- **Clé alignée, tables disjointes** : `ControlLot` partage la **clé naturelle** `(citySlug, noLot)`
  avec `Lot` (`SPEC_DESIGN_DATA_MODEL.md` §1.2) — c'est **exactement** ce qui rend le diff de parité
  possible (jointure §4.3) — **mais** c'est une **table physiquement distincte**. Aucune FK vers
  `Lot` : un `ControlLot` peut exister **avant** que notre pipeline ait créé le `Lot` correspondant
  (c'est même le cas attendu au démarrage : la référence précède le scrape).
- **Pas de bitemporalité** : la table de contrôle est un **snapshot daté** (`importedAt`), pas une
  entité bitemporelle versionnée (pas de `TemporalSpan` §1.0). On **ré-importe** un nouveau snapshot
  quand Steve fournit une mise à jour ; on ne **rejoue** pas d'historique.
- **Loi 25** : `ControlLot` = cadastre + rôle **publics** (NO_LOT seul, aucun propriétaire —
  `SPEC_DESIGN_DATA_MODEL.md` §0.3) ; `ControlMark` porte des **marques d'équipe** (`who`/`role` =
  l'équipe de Steve), **aucune PII de tiers**. C'est de la **donnée fournie par le client sur ses
  propres prospects**, conservée **en contrôle** : **jamais re-publiée** dans le flux opérationnel,
  jamais exposée comme `ProspectMark`. Si une mise à jour Steve venait à contenir une PII tierce
  (improbable : le JSON public n'en a pas), elle est **rejetée à l'import** (garde-fou §6.3).

### 2.3 Loi 25 / provenance — résumé

- **Origine** : corpus du client (Guillaume Chaperon / équipe Steve) sur **ses propres** prospects.
- **Contenu** : (a) cadastre MERN + rôle 2022 **publics** (JSON Netlify, README §Architecture) ;
  (b) marques d'équipe Firestore (`who`/`role` d'équipe, README §Données d'usage).
- **Usage** : **contrôle interne de parité uniquement** — lecture par le rapport de parité (§4),
  **jamais** re-publication, **jamais** insertion dans `ProspectMark`/`DesignationEvent`.
- **Anti-invention** : tout champ absent du corpus reste **`null`** + `verification:"non-disponible"`
  (`SPEC_DESIGN_DATA_MODEL.md` §0.3) — ex. code postal (absent du JSON, §6.3 EVOL), code MAMH (§1).

## 3. Séparation stricte contrôle ↔ opérationnel (garde-fou load-bearing)

C'est l'invariant **central** de cette spec (et le sens de la décision §6.2 EVOL) :

1. **Le détecteur est intact** : `detectZonageChange` et le pipeline de signaux **ne lisent jamais**
   `ControlLot`/`ControlMark`. La table de contrôle est **hors** du flux opérationnel.
2. **Pas de `ProspectMark`** : les 5 247 marques de Steve (5 043 non-retenus + 204 lettres + … à
   Sainte-Catherine) vivent en `ControlMark`, **jamais** en `ProspectMark` (§4.1 EVOL). Le store
   opérationnel n'est alimenté **que** par les décisions prises **dans** le radar.
3. **Pas de `DesignationEvent`** : l'import de contrôle **n'émet aucun** événement de désignation
   (§1.3 `SPEC_DESIGN_DATA_MODEL.md`).
4. **Frontière réel** : `ControlLot`/`ControlMark` portent `source:"carte-steve-control"` et **ne
   franchissent jamais** la frontière réel (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §2.7 : un datum de
   contrôle n'est ni `mode:"real"` du pipeline ni un `EvidenceItem` `verification:"simulé"` injecté
   dans un dossier réel). La table de contrôle est un **troisième espace**, à côté de `real` et
   `simulation`, lu **seulement** par le rapport de parité.
5. **Sens unique** : la parité **mesure** le pipeline (référence → diff → rapport). Elle ne
   **corrige** ni n'**alimente** jamais le pipeline automatiquement. Une divergence détectée produit
   un **constat** (rapport §4), pas une écriture dans le store opérationnel.

## 4. Métrique de PARITÉ (par ville, diffable)

### 4.1 Définition

Pour chaque ville de contrôle, on compare **`ControlLot`/`ControlMark`** (référence Steve) au
**`Lot`/`LotVersion`/`ZoneVersion`/`Valuation`/score de potentiel par lot** que **notre** pipeline a
produits en scrapant la même ville. La jointure est **`(citySlug, NO_LOT)`** (§4.3). Le résultat est
un **rapport de parité** versionnable et diffable, une **ligne par ville**.

### 4.2 Axes de couverture (le « combien on reproduit »)

| Métrique | Numérateur | Dénominateur | Source référence | Source radar |
|---|---|---|---|---|
| **Couverture lots (cadastre)** | lots radar matchés sur `NO_LOT` | lots `ControlLot` de la ville | `ControlLot` count | `Lot`/`LotVersion` (A6 cadastre-allégé / A4) |
| **Couverture zones** | lots dont `zoneCodeRef` == zone résolue radar | lots `ControlLot` avec `zoneCodeRef` non vide | `ControlLot.zoneCodeRef` | `lot_zone_resolution` → `ZoneVersion.codeAffiche` (§1.5) |
| **Champs rôle reproduits** | champs rôle (val_totale/terrain/bâtiment, usage, logements, étages, année) égaux à ± tolérance | champs rôle présents en référence | `ControlLot` (rôle Steve) | `Valuation` + `LotVersion.usageCode` (A5 rôle MAMH) |
| **Présence TOD** | lots dont `todRef` == appartenance TOD radar | lots `ControlLot` (toute la ville) | `ControlLot.todRef` | couche `requalification-tod` (A13 `aires-tod-pmad-cmm`, §4.0 EVOL) |
| **Reproduction des flags** | lots dont `prioriteRef`/`multifamilial4plusRef` == reproduction radar | lots `ControlLot` (toute la ville) | flags Steve (`analyse-donnees.json`) | score de potentiel par lot dérivé (§2 S-1 EVOL) |

> Les flags `multifamilial_4plus`/`tod`/`priorite` de Steve **ne sont pas importés comme vérité**
> (§6.2 EVOL : « ne pas importer comme vérité — recalculer ») : ils servent **uniquement** de
> **cible de calibration** (`ControlLot.*Ref`). La métrique « reproduction des flags » vérifie que
> notre **score de potentiel par lot** (`SPEC_EVOL_SOCLE_STATES_SCORING.md` § potentiel + pré-filtres
> §2.1) **retrouve** des priorités cohérentes avec Steve — pour Delson, cible **130 lots priorité,
> 278 lots 4+, 1 443 lots TOD** (`analyse-donnees.json`).

### 4.3 Delta de score & rapport diffable

- **Delta de score (potentiel par lot)** : pour les lots matchés, on compare notre **score de
  potentiel par lot** (dérivé `ZoneVersion.densiteLogHa`/usages ∩ TOD ∩ pré-filtres §2.1 — **pas**
  `OpportunityDossier.scoreGlobal`, §2 S-1 EVOL) au **proxy de priorité de Steve**
  (`prioriteRef`/`multifamilial4plusRef`). On ne compare **pas** un `/100` (banni, §2 S-1 EVOL) ;
  on compare des **ensembles** (lots priorité radar vs lots `prioriteRef`) + une **distribution**
  du score sur les lots `prioriteRef`. Sortie : matrice de confusion (vrais/faux positifs/négatifs)
  par ville.
- **Jointure de parité** : `JOIN ON (ControlLot.citySlug = Lot.citySlug AND ControlLot.noLot =
  Lot.noLot)` — `NO_LOT` **normalisé des deux côtés** (« 2 181 127 » → « 2181127 », §6.2 EVOL ;
  c'est le **même** `NO_LOT` cadastral invariant entre fixture et rôle MAMH, §6.3 EVOL « clé de
  mapping »). Les lots `ControlLot` **sans** `Lot` radar = **trou de couverture** (pipeline pas
  encore assez profond). Les lots `Lot` radar **sans** `ControlLot` = lots que Steve n'a pas (ex.
  `is_rue` exclus côté Steve — README §B2) → **signalés, non comptés** comme divergence.
- **Honnêteté `non-disponible`** : une métrique dont la **donnée radar manque** (ex. zones à Candiac,
  qui n'a **aucun zonage** côté Steve **ni** côté radar tant que non scrapé) est **`non-disponible`**,
  **pas** 0 % (`SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.4.0 : *unknown ≠ niveau bas*). Candiac est le
  **cas-test honnête** : couverture zones/TOD = `non-disponible` des deux côtés.
- **Rapport de parité diffable** : un artefact par ville (`parity/<citySlug>.json` + résumé Markdown),
  **versionnable**, recalculé à chaque run de pipeline. Forme indicative :

```jsonc
{
  "citySlug": "delson",
  "computedAt": "2026-…T…Z",
  "pipelineCommit": "<sha>",          // traçabilité : quelle version du pipeline mesurée
  "coverage": {
    // controlTotal = nb de ControlLot concernés ; les valeurs ci-dessous sont ILLUSTRATIVES
    // (état de départ, pipeline pas encore profond). lots = total ville (Delson 3213) ;
    // zones = ControlLot avec zoneCodeRef non vide ; tod/role = total ville.
    "lots":   { "matched": 0, "controlTotal": 3213, "pct": 0.0, "verification": "fait" },
    "zones":  { "matched": 0, "controlTotal": 0,    "pct": 0.0, "verification": "non-disponible" },
    "role":   { "matched": 0, "controlTotal": 3213, "pct": 0.0, "verification": "non-disponible" },
    "tod":    { "matched": 0, "controlTotal": 3213, "pct": 0.0, "verification": "non-disponible" }
  },
  "flagsParity": {                    // cible Steve (analyse-donnees.json) vs reproduction radar
    "priorite":  { "controlCount": 130,  "radarCount": 0, "truePos": 0, "falsePos": 0, "falseNeg": 130 },
    "fourPlus":  { "controlCount": 278,  "radarCount": 0 },
    "tod":       { "controlCount": 1443, "radarCount": 0 }
  },
  "marksControl": {                   // RÉFÉRENCE seulement (jamais ProspectMark) — Sainte-Catherine surtout
    "non-retenu": 0, "lettre": 0, "favori": 0, "sollicité": 0, "en-vente": 0
  }
}
```

> Les `0`/`pct: 0.0` ci-dessus sont l'**état de départ** (pipeline pas encore profond sur Delson) :
> le rapport **diff** entre run N et run N+1 montre la **progression** vers la parité. C'est la
> mesure de « est-ce qu'on reproduit Steve ? ».

## 5. Priorité de scrape PROFOND des 4 villes

### 5.1 Décision

Les 4 villes de contrôle (`delson`, `sainte-catherine`, `saint-constant`, `candiac`) passent **en
TÊTE** de la priorisation de scrape et **en PROFONDEUR** (toutes sources : PV/zonage, rôle, cadastre,
zones, TOD). **Objectif explicite : reproduire la référence Steve et mesurer la parité** (§4).
L'amendement est porté par [`SPEC_PLAN_SCRAPING.md`](SPEC_PLAN_SCRAPING.md) §2.4 (ci-dessous) — le
plan ne portait **aucune** notion de priorité par ville ni de « deep » (il était templé pour N villes
depuis Valleyfield `70052`, §2.1). On l'introduit.

### 5.2 Où marquer « contrôle-parité / deep » côté config

La priorité se déclare dans le **registre `CityProfile`** (`SPEC_PLAN_SCRAPING.md` §2.3 — le seul
lieu de config par ville, « aucune logique ville en dur ailleurs ») via **deux annotations
ajoutées** au `CityProfile` (amendement plan §2.4) :

- **`controlParity: true`** — la ville est un **point de contrôle** (a un `ControlLot`/`ControlMark`
  importé ; son rapport de parité est calculé).
- **`scrapeDepth: "deep"`** — toutes les `SourceBinding` de la ville sont attaquées (rôle, cadastre,
  zonage/PV, zones, TOD), **pas** un sous-ensemble. (Les villes du grand filet restent `"shallow"`
  par défaut : PV/avis pour la veille de signaux uniquement.)

Les 4 villes de Steve portent `controlParity: true` + `scrapeDepth: "deep"` ; elles passent **avant**
Valleyfield et le reste du backlog (`SPEC_PLAN_SCRAPING.md` §5) tant que la parité n'est pas atteinte.

### 5.3 Sources à attaquer en profondeur (rappel des bindings)

| Couche de parité | Source radar (id `SPEC_PLAN_SCRAPING.md`) | Tier | Note |
|---|---|---|---|
| Cadastre (lots, geom) | A6 `cadastre-allege` (+ A4 `donnees-quebec-catalog`) | A | `build-now`, REST stable |
| Rôle 2022 (valeurs/usage/logements/étages) | A5 `roles-evaluation-fonciere-mamh` | A | XML/CSV/GPKG MAMH par `codeMamh` (à résoudre §1) |
| Zonage (codes/densité/usages) + grilles | A2 `reglements-urbanisme-valleyfield`* + B2 `zonage-plans-grilles-valleyfield`* | A/B | **gap polygone de zone** = manque le plus structurant (`SPEC_PLAN_SCRAPING.md` §6) → fallback éditeur S-14 (§C / S-14 EVOL) |
| TOD (périmètres) | **A13 `aires-tod-pmad-cmm`** (à ajouter au plan, §4.0 EVOL) | A | open data CMM ; couvre les 4 villes (toutes CMM) |
| PV / changements de zonage | `proces-verbaux-*` / A1 `avis-publics-*` (généralisés par ville) | A/B | alimente Signaux (S-6 EVOL) — orthogonal à la parité cadastre/rôle/zone |

> *Les ids `*-valleyfield` du plan sont **templés pour N villes** (`SPEC_PLAN_SCRAPING.md` §2.1) :
> chaque ville de contrôle instancie son propre binding via `CityProfile.sources` (§2.3). On
> n'invente pas d'id par ville ici ; on l'instancie à l'attaque du palier.

### 5.4 Cible de parité par ville (ce qu'on cherche à reproduire)

- **Delson** (réf la plus riche) : reproduire 278 lots 4+, 1 443 TOD, **130 priorité** ; descriptions
  de zone (Règl. 901) → notre `ZoneVersion`. **Première cible** (data Steve complète = meilleur
  diff).
- **Saint-Constant** : 642 lots 4+, 1 polygone TOD (5 287 lots) ; rôle le plus riche → bon test des
  champs rôle.
- **Sainte-Catherine** : zonage **dessiné** (193 zones) → test du gap polygone (notre extraction vs
  numérisation manuelle Steve) ; **+ les marques d'équipe** (5 247) → seul jeu de `ControlMark`.
- **Candiac** : **aucun zonage ni TOD** → cas-test `non-disponible` honnête (zones/TOD `non-disponible`
  des deux côtés, §4.3).

## 6. Mécanisme d'import

### 6.1 Deux sources, deux chemins (honnêteté sur le scrapable)

| Volet | Source | Scrapable ? | Chemin |
|---|---|---|---|
| **(a) Substrat cadastre / rôle / zone / TOD** | JSON Netlify par ville `…/data/<slug>.json` | **OUI** (HTTP 200 vérifié, §6.1 EVOL) | `curl`/fetch + validation Zod → `ControlLot` (mapping §6.2) |
| **(a')** zones Sainte-Catherine | `…/data/sainte-catherine-zones.json` | **OUI** | idem → `ControlLot.zoneCodeRef` |
| **(b) Marques d'équipe (non-retenus / lettres / notes)** | Firestore `plateforme/<slug>` (`marks`/`lot_notes`/`listings`) | **NON garanti** | **nécessite un export fourni par Steve** (voir §6.4) |

### 6.2 Import du substrat (volet a) — scrapable

- **Lecture** : les JSON par ville sont **publics et téléchargeables** (`…/data/<slug>.json`, 6–24 Mo,
  GeoJSON WGS84 — `ARCHITECTURE.md` §fin). Schéma `{meta, lots, zones, tod, boundary}` + 22 propriétés
  de lot (§Propriétés d'un lot, ARCHITECTURE).
- **Mapping → `ControlLot`** : la table de §2.1 (chaque champ `← <champ JSON Steve>`). Réutilise la
  **normalisation `NO_LOT`** de `SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §6.2 (espaces ôtés).
- **Pas de PII** : les JSON ne contiennent que cadastre + rôle public + adresse, **aucun propriétaire**
  (§6.1 EVOL). **Pas de code postal** par lot (cache Firestore non exporté, §6.3 EVOL) →
  `ControlLot` n'a pas de code postal (cohérent avec la fiche maquette vide).
- **Stockage** : fixtures S3 `fixtures/carte-steve-control/<slug>.json`
  (`SPEC_PERSISTENCE_S3_FIRST.md` §layout `fixtures/`), **non committé** (volumétrie). Distinct du
  substrat de **maquette** CS-L6 (`fixtures/carte-steve/<slug>.json`, §6.1 EVOL) : même corpus,
  **deux usages** (démo UX vs contrôle de parité).

### 6.3 Garde-fous d'import

- **Validation Zod** avant insertion ; tout champ absent → `null` + `verification:"non-disponible"`.
- **Rejet PII tierce** : si un champ inattendu ressemblant à une PII de propriétaire apparaît dans une
  mise à jour Steve → **rejeté à l'import** (la table de contrôle ne porte que cadastre/rôle public +
  marques d'équipe, §2.2). Loi 25.
- **`source:"carte-steve-control"`** forcé → la frontière réel (§2.7 socle) **exclut** ces lignes.
- **Idempotence** : ré-importer une ville **remplace** son snapshot (`importedAt` mis à jour), ne
  duplique pas (clé `(citySlug, NO_LOT)`).

### 6.4 Import des marques d'équipe (volet b) — **nécessite un export fourni par Steve**

- **Constat honnête** : la rétrodoc a été faite en **lecture seule** ; la config Firestore est en
  clair côté client (`ARCHITECTURE.md` §Firebase) mais **lire le doc `plateforme/<slug>`
  programmatiquement n'est pas un chemin propre/garanti** (pas d'auth, ToS, fragilité). On **ne
  scrape pas** Firestore.
- **Chemin recommandé** : demander à Steve l'**export JSON natif de son outil** (« 💾 Exporter toutes
  mes données » — README §B4.3 : dump `marks`/`listings`/`lot_notes`/`pastilles`) → import en
  `ControlMark` (mapping §2.1). C'est **le** moyen propre d'obtenir les 5 247 marques de
  Sainte-Catherine.
- **À défaut d'export** : `ControlMark` reste **vide** pour la ville → la métrique `marksControl`
  est `non-disponible` (honnête), le reste de la parité (cadastre/rôle/zone/TOD) **n'en dépend pas**.

## 7. Items track

> **Outillage** : le workspace `track` est exposé en **lecture seule** (MCP `track_report`/`status`/
> `query`/`validate`/`canevas`… — pas de verbe de **création** d'item). Les items ci-dessous sont
> donc **listés ici** (et non créés via l'outil), à graner sous la racine **« Réorientation Grand
> filet »** (`01KTQP5EHKKMM5TSD4ZSE3CFZ2`, workspace `reorientation`), aux côtés des lots
> `CS-L1…CS-P3` existants (`SPEC_EVOL_INTEGRATION_CARTE_STEVE.md` §9.1). À créer dès qu'un verbe
> `track` d'écriture est disponible.

| Item (proposé) | Titre | Priorité | Réf | Dépendances |
|---|---|---|---|---|
| **CP-1** | Import **contrôle** : `ControlLot`/`ControlMark` depuis JSON Netlify (4 villes) + export Steve pour les marques | P0-contrôle | `docs/spec/SPEC_CONTROLE_PARITE_VILLES_STEVE.md §2/§6` | ⟂ CS-L6 (même corpus, usage distinct) |
| **CP-2** | **Scrape profond** des 4 villes (rôle A5 + cadastre A6 + zonage A2/B2 + zones + TOD A13) ; `CityProfile.controlParity/scrapeDepth` | P0-contrôle | `docs/spec/SPEC_CONTROLE_PARITE_VILLES_STEVE.md §5` + `SPEC_PLAN_SCRAPING.md §2.4` | dépend de A13 (§4.0 EVOL) ; gap polygone (§6 plan) |
| **CP-3** | **Rapport de parité** par ville (couverture + flags + delta score) — diffable, lecture seule | P0-contrôle | `docs/spec/SPEC_CONTROLE_PARITE_VILLES_STEVE.md §4` | dépend de **CP-1 + CP-2** (réf + pipeline pour diffّer) |

Chaque item portera `body: "ref docs/spec/SPEC_CONTROLE_PARITE_VILLES_STEVE.md §…"`. Parenté :
enfants de la racine `01KTQP5EHKKMM5TSD4ZSE3CFZ2` (workspace `reorientation`), comme `CS-L*`.

## 8. Récapitulatif

- **Décision** (§6.2 EVOL tranchée) : import du corpus Steve **en table de contrôle golden**, **pas**
  dans le store opérationnel ; parité **mesurée** sur 4 villes ; scrape **deep** priorisé.
- **Modèle** : `ControlLot` + `ControlMark`, clé `(citySlug, NO_LOT)`, miroir de la fiche Steve,
  **isolé** de `Lot`/`ProspectMark`/`DesignationEvent` (§3, garde-fou).
- **Métrique** : couverture (lots/zones/rôle/TOD) + reproduction des flags + delta de score de
  potentiel par lot ; rapport **diffable** par ville ; `non-disponible` honnête (Candiac = cas-test).
- **Priorité deep** : 4 villes en tête, `CityProfile.controlParity:true` + `scrapeDepth:"deep"`
  (`SPEC_PLAN_SCRAPING.md` §2.4).
- **Import** : substrat **scrapable** (JSON Netlify) ; marques **nécessitent un export Steve**.
- **Items track** : CP-1 (import contrôle), CP-2 (scrape deep), CP-3 (rapport parité) — listés (track
  lecture seule).
