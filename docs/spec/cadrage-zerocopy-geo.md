# Cadrage — Architecture ZERO-COPY pour les données géo (lots / zones)

> **Statut** : cadrage architectural (spec). Aucun code ici — ce document arbitre le design
> et sert de brief aux lots de migration.
> **Date** : 2026-06-20. **Auteur** : rhanka.
> **Périmètre** : remplacer la duplication actuelle des lots/zones `geo` → PostgreSQL immo
> (`lot_versions` / `zone_versions`) par une architecture **zero-copy** qui s'appuie sur `geo`
> comme **source de vérité unique**, à l'échelle des **1102 villes** (lots province-wide) +
> ~300 collections zones, soit des **millions de lots**.
> **Loi 25** : données cadastrales/zonage publiques uniquement (`NO_LOT`, géométrie, code de zone).
> Aucune PII propriétaire ne transite ni n'est stockée.

---

## 0. TL;DR — recommandation

**Reco (1 phrase)** : `geo` publie un **lakehouse GeoParquet sur S3** (lots + zones partitionnés par
ville, plus un **index léger lot/zone → bbox+centroïde+clé normalisée**) et sert le **rendu via
PMTiles** ; immo consomme en **zero-copy** par **DuckDB** (prédicat pushdown sur S3, jointure
signal↔lot analytique) et ne garde en Postgres que ses **arêtes de résolution** (`geo_resolutions`,
quelques Ko/ville), jamais les géométries.

Décisions :

| # | Décision | Conséquence |
|---|---|---|
| **D1** | **Source de vérité = `geo`** ; immo ne copie **aucune géométrie** en PG. `lot_versions.geom` / `zone_versions.geom` sont **dépréciés** (gardés en transition derrière un flag). | Suppression du pull OGC→PG |
| **D2** | **Rendu carte** = **PMTiles** servis par `geo` (un fichier par ville ou province-wide), lus directement par MapLibre via `pmtiles://`. immo ne sert plus de GeoJSON massif depuis PG. | `/geo/features/:city` devient un proxy de styles/refs, pas un dump de polygones |
| **D3** | **Jointure mapper (point dur)** = **clé textuelle normalisée**, pas spatiale. `geo` publie un **index GeoParquet** `(city_slug, no_lot_norm, code_norm, bbox, centroid, feature_id)`. immo joint `signal.no_lot_norm`/`zone_ref_norm` ↔ cet index **en DuckDB**, zero-copy, sans charger les polygones. | `geo_resolutions.target_id` = `feature_id` stable publié par `geo` |
| **D4** | **Moteur de requête** = **DuckDB embarqué dans l'API immo** (extension `httpfs` + `spatial` + lecture Parquet/Iceberg sur S3), pas de service Trino. | Zéro infra serveur supplémentaire |
| **D5** | **Fraîcheur** = `geo` expose un **manifeste versionné** (`snapshot_id` + `etag` par ville) ; immo lit toujours le snapshot courant, cache HTTP par etag. Pas de job de pull. | Fraîcheur quasi-temps-réel, pilotée par `geo` |
| **D6** | **Format de sortie `geo`** = **GeoParquet** (idéalement tables **Iceberg** pour le versioning/partition pruning) + **PMTiles** + **manifeste JSON**. C'est ce que `geo` doit produire. | Voir §6 « Ce que geo doit changer » |

---

## 1. Problème — pourquoi le pull-PG actuel est mal designé

### 1.1 État actuel (baseline)

```
api.geo.sent-tech.ca (OGC API Features)        s3://sentropic-geo/ (brut)
        │  GET /collections/qc-lots-<city>/items?limit=10000&offset=N
        ▼
  api/src/services/geo/ogc-pull.ts  ──(SELECT-then-INSERT/UPDATE par batch 500)──►
        │
        ▼
  PostgreSQL immo (PostGIS)
    • lot_versions   (geom geometry(4326), no_lot, no_lot_norm, city_slug, geom_source, …)
    • zone_versions  (geom geometry(4326), code_affiche, code_norm, city_slug, kind, …)
        │
        ├──► RENDU   : api/src/services/geo/geo-features.ts → ST_AsGeoJSON → /api/geo/features/:city
        └──► MAPPER  : api/src/services/geo/resolve-refs.ts → jointure code_norm/no_lot_norm
                       → geo_resolutions(node_id, relation_type, target_id=canonical_id, …)
```

`canonical_id` est dérivé **localement** par immo : `ogc:lots:<city>:<no_lot_norm>`,
`ogc:zones:<city>:<code_norm>` (cf. `ogc-pull.ts` `lotCanonicalId`/`zoneCanonicalId`).

### 1.2 Pourquoi c'est mal designé

1. **Duplication massive** : `geo` détient déjà toutes les géométries ; les recopier dans PG
   double le stockage (millions de polygones, géométrie cadastrale lourde) et impose un index
   GiST province-wide côté immo. À l'échelle 1102 villes c'est plusieurs Go de géométrie dupliquée.
2. **Divergence / staleness** : le pull est un instantané. Dès que `geo` corrige un lot, immo est
   périmé jusqu'au prochain pull. La « source de vérité » est de facto dédoublée.
3. **Couplage au format OGC items** : `ogc-pull.ts` est codé en dur sur la pagination
   `?limit=10000&offset=N` et le shape `properties.NO_LOT`. Si `geo` change sa sortie (ce qu'il
   **veut** faire), le pull casse.
4. **Coût d'upsert O(n) par feature** : la stratégie `SELECT … WHERE no_lot=$1 … LIMIT 1` puis
   INSERT/UPDATE est un aller-retour PG **par lot**. Province-wide = millions d'A/R → pull lent,
   bloquant, et qui ne passe pas à l'échelle des 1102 villes.
5. **`canonical_id` inventé côté immo** : immo fabrique l'identité du lot/zone. Si `geo` publie ses
   propres `feature_id`, on a deux identités concurrentes pour la même entité.

### 1.3 Ce qu'on veut

- **immo = pur consommateur** de `geo`. Zéro géométrie en PG.
- Rendu carte rapide à l'échelle masse (PMTiles).
- Jointure signal↔lot/zone **analytique** sans rapatrier la géo.
- Fraîcheur pilotée par `geo`, identité (`feature_id`) **possédée par `geo`**.

---

## 2. Contraintes réelles (non négociables)

| # | Contrainte | Détail |
|---|---|---|
| **C1 — Rendu** | MapLibre doit afficher rapidement les polygones lots/zones d'une ville. | Aujourd'hui `/geo/features/:city` lit PG (`ST_AsGeoJSON`). Cible = **PMTiles** servis par `geo`, lus par MapLibre. |
| **C2 — Mapper (jointure)** | Résoudre `Signal`/`DesignationEvent` (props `zone_ref` / `no_lot`) → polygone géo, par `city_slug` + code/no_lot, pour highlight + scoring. | Aujourd'hui jointure SQL PG locale. En zero-copy : jointure analytique **sans copier la géo en PG**. C'est le point dur (§5). |
| **C3 — Vérité = geo** | `geo` est la source de vérité ; immo est consommateur. **`geo` peut changer son format de sortie.** | Formats évoqués par le principal : **S3 indexé type Iceberg / Parquet / Avro** (multi-format, indexable). |
| **C4 — Échelle** | ~1102 villes lots, ~300+ collections zones, **millions de lots**. | Interdit toute approche qui charge tout en mémoire ou en PG. Exige du **partition pruning** + **predicate pushdown**. |
| **C5 — Loi 25** | Données publiques uniquement. | GeoParquet/PMTiles ne contiennent que cadastre/zonage public, jamais de rôle propriétaire. |

---

## 3. Options étudiées (≥4) — description

### Option A — **Lakehouse S3 (GeoParquet / Iceberg) + DuckDB embarqué** *(recommandée)*

`geo` écrit des tables **GeoParquet** partitionnées par ville/MRC sur `s3://sentropic-geo/lakehouse/`
(idéalement gérées en **Iceberg** pour snapshots + partition pruning). immo embarque **DuckDB**
(`httpfs` + `spatial` + `iceberg`) dans l'API et requête en zero-copy : `SELECT … FROM
read_parquet('s3://…/lots/city_slug=delson/*.parquet') WHERE no_lot_norm = ?`. Le predicate pushdown
+ partition pruning ne lit que les fragments nécessaires.

- **Rendu** : PMTiles (servis par `geo`, cf. Option B — complémentaire, pas alternatif).
- **Mapper** : jointure DuckDB `signaux_parquet ⨝ lots_index_parquet` sur `(city_slug, no_lot_norm)`
  — **sans jamais charger les géométries** (l'index ne porte que bbox/centroïde/clé, §5).
- **Jointure des signaux** : deux variantes (§5.2) — (a) immo exporte ses signaux/refs en Parquet sur
  S3 et DuckDB joint tout sur S3 ; (b) **DuckDB ATTACH Postgres** (`postgres_scanner`) + S3 dans la
  même requête → joint `geo_resolutions`/nœuds PG ↔ index lot S3 sans ETL.

### Option B — **PMTiles (rendu) + index léger GeoParquet (mapper)**

Découpe le problème en deux flux distincts :
- **Rendu** : `geo` génère des **PMTiles** (un fichier immuable, range-requests HTTP). MapLibre lit
  `pmtiles://https://geo…/qc-lots.pmtiles` directement. Zéro géométrie en PG, rendu masse natif.
- **Mapper** : `geo` publie un **index léger** `(city_slug, no_lot_norm, code_norm, bbox, centroid,
  feature_id)` en GeoParquet (sans les polygones complets). immo joint sur cet index (DuckDB ou même
  un petit cache PG **de l'index seul**, quelques Mo). Highlight = on renvoie le `feature_id` à
  MapLibre qui le met en surbrillance dans la couche PMTiles (feature-state).

C'est en réalité **le sous-ensemble « comment » de l'Option A** : A = le moteur (DuckDB/Iceberg),
B = la forme des artefacts (PMTiles + index). La reco combine les deux.

### Option C — **PostGIS Foreign Data Wrapper** (`parquet_fdw` / `ogr_fdw` / `duckdb_fdw`)

PG « voit » les Parquet S3 comme des **tables externes** : `CREATE FOREIGN TABLE lots_ext … SERVER
parquet_srv OPTIONS (filename 's3://…')`. Zero-copy au sens « pas de copie physique » — les requêtes
SQL existantes (`resolve-refs.ts`, `geo-features.ts`) marchent presque sans changement.

- **Rendu** : possible (`ST_AsGeoJSON` sur foreign table) mais relit S3 à chaque requête → lent à
  l'échelle masse ; PMTiles reste nécessaire pour le rendu.
- **Mapper** : jointure SQL native PG ↔ foreign table.
- **Limite** : `parquet_fdw`/`duckdb_fdw` sont des extensions **non standard** à compiler/maintenir
  dans l'image PG ; pushdown des prédicats partiel ; pas de support Iceberg natif fiable ; ops fragile.

### Option D — **API live OGC + cache HTTP** (mode actuel sans persistance PG)

immo appelle l'OGC API `geo` en direct au moment du rendu/mapper, avec un cache HTTP (etag/CDN).
C'est le pull actuel **sans l'étape PG**.

- **Rendu** : `GET /collections/qc-lots-<city>/items` à la volée → **trop lent** pour une ville de
  milliers de lots (pagination 10k, latence réseau), et **404/429 sous charge**.
- **Mapper** : **impossible analytiquement** — l'OGC API filtre par bbox/CQL, pas une jointure
  `no_lot_norm` massive ; il faudrait paginer toute la ville pour chaque résolution. Pas de pushdown.
- **Verdict** : insuffisant — gardé seulement comme **fallback ponctuel** (détail d'un seul lot).

### Option E — **Statu quo amélioré (pull-PG)** *(baseline de comparaison)*

On garde le pull OGC→PG mais on l'optimise : `COPY` au lieu d'`INSERT` ligne-à-ligne, upsert par
`ON CONFLICT`, pull incrémental par etag. Reste une **duplication** ; ne résout ni C3 (vérité
dédoublée) ni le couplage au format OGC. Sert uniquement de mètre-étalon de coût/effort.

---

## 4. Tableau comparatif

Légende : ★★★ excellent · ★★ correct · ★ faible.

| Critère | **A. Lakehouse+DuckDB** (reco) | **B. PMTiles+index** (inclus dans A) | **C. PostGIS FDW** | **D. API live+cache** | **E. Statu quo+ (pull-PG)** |
|---|---|---|---|---|---|
| **Rendu carte (masse)** | ★★★ via PMTiles | ★★★ PMTiles natif MapLibre | ★ relit S3/req, lent | ★ pagination live, 404 sous charge | ★★ GeoJSON PG (lourd, lent à l'échelle) |
| **Jointure mapper (zero-copy)** | ★★★ DuckDB pushdown sur index | ★★★ jointure sur index léger | ★★ SQL PG ↔ foreign table (pushdown partiel) | ✗ pas de jointure analytique | ★★★ SQL PG (mais sur copie) |
| **Fraîcheur** | ★★★ snapshot `geo` + etag | ★★★ etag PMTiles/index | ★★ relecture S3 (cache à gérer) | ★★★ live | ★ instantané périmé entre pulls |
| **Coût stockage immo** | ★★★ ~0 (index Ko/ville en cache) | ★★★ ~0 | ★★★ ~0 (zero-copy) | ★★★ ~0 | ★ Go de géo dupliquée + index GiST |
| **Coût requête / latence** | ★★ DuckDB S3 (1er hit froid ; cache chaud OK) | ★★★ range-request CDN | ★ relit Parquet/req | ✗ pagination réseau | ★★★ PG local (mais coût pull amont) |
| **Effort migration** | ★★ moyen (embarquer DuckDB + réécrire mapper/rendu) | ★★ moyen | ★★ (FDW à compiler/maintenir) | ★★★ faible (retirer le PG) | ★★★ quasi nul |
| **Dépendance `geo` (ce que geo doit produire)** | GeoParquet+Iceberg, index, PMTiles, manifeste | PMTiles + index GeoParquet | Parquet stable (schéma figé) | OGC API stable | OGC API stable |
| **Robustesse à un changement de format `geo` (C3)** | ★★★ (contrat = manifeste, pas le shape brut) | ★★★ | ★ (schéma Parquet figé dans FDW) | ★ (couplé au shape OGC) | ✗ (couplé au shape OGC, déjà cassant) |
| **Passage à l'échelle 1102 villes** | ★★★ partition pruning | ★★★ | ★★ | ✗ | ★ (pull O(n) ingérable) |
| **Infra supplémentaire** | aucune (DuckDB embarqué) | aucune | extension PG non standard | aucune | aucune |

**Lecture** : A+B (combinés) dominent sur rendu, jointure zero-copy, échelle et robustesse au
changement de format. C est séduisant (SQL inchangé) mais paye un coût ops (extension PG non standard,
pas d'Iceberg fiable). D est éliminé pour le mapper. E ne résout aucun des problèmes de fond.

---

## 5. Le point dur — jointure mapper signal↔lot/zone en zero-copy

C'est **le** problème de design. Le rendu (PMTiles) est résolu de façon évidente ; la jointure ne l'est
pas, car les **signaux vivent en PG/SCW** (graphify) tandis que la **géo vit sur S3** (geo).

### 5.1 Pourquoi la jointure est dure

- Aujourd'hui la jointure est **purement textuelle** : `resolve-refs.ts` matche
  `zone_versions.code_norm = normalize(zone_ref)` et `lot_versions.no_lot_norm = normalize(no_lot)`,
  **dans la même table PG** que les signaux. Facile, mais ça suppose la géo copiée en PG.
- En zero-copy, un côté (signaux) est en PG, l'autre (lots/zones) est sur S3. Il faut une jointure
  **cross-store** sans rapatrier les millions de polygones.
- Charger les géométries pour joindre serait absurde : la jointure ne porte **que sur la clé**
  (`no_lot_norm`, `code_norm`) ; la géométrie n'intervient qu'après, pour le **highlight visuel** et
  le scoring spatial éventuel.

### 5.2 Solution — index léger publié par `geo` + jointure DuckDB

**Idée clé** : on ne joint **jamais** sur la géométrie ; on joint sur la **clé normalisée**, puis on
référence le polygone par un **identifiant stable** (`feature_id`) que MapLibre sait surligner dans
la couche PMTiles.

`geo` publie un **index léger** (pas les polygones) en GeoParquet, partitionné par ville :

```
s3://sentropic-geo/lakehouse/index/lots/city_slug=<slug>/part-*.parquet
  feature_id      string   -- identité stable POSSÉDÉE par geo (remplace canonical_id inventé)
  city_slug       string
  no_lot          string   -- "6 057 912"
  no_lot_norm     string   -- "6057912"   (clé de jointure)
  bbox            double[4] -- xmin,ymin,xmax,ymax (pour fitBounds / pré-filtre)
  centroid        double[2] -- lon,lat (highlight point + scoring léger)
  snapshot_id     string   -- version geo
s3://sentropic-geo/lakehouse/index/zones/city_slug=<slug>/part-*.parquet
  feature_id, city_slug, code_affiche, code_norm, kind, bbox, centroid, snapshot_id
```

Cet index pèse quelques **dizaines de Ko par ville** (pas de polygones) → trivial à requêter, voire à
mettre en cache local.

**Jointure — deux variantes :**

- **Variante (a) — tout en DuckDB sur S3.** immo exporte périodiquement (ou à la volée) ses
  **refs de signaux** (`node_id, city_slug, no_lot_norm, zone_ref_norm`) en Parquet sur S3, puis :

  ```sql
  -- DuckDB embarqué dans l'API immo (httpfs + spatial)
  SELECT s.node_id, s.city_slug, l.feature_id, l.centroid
  FROM   read_parquet('s3://immo-refs/signaux/city_slug=delson/*.parquet') s
  JOIN   read_parquet('s3://sentropic-geo/lakehouse/index/lots/city_slug=delson/*.parquet') l
    ON   l.no_lot_norm = s.no_lot_norm
  WHERE  s.no_lot_norm IS NOT NULL;
  ```
  Partition pruning sur `city_slug=delson` → DuckDB ne lit qu'un fragment. Zero-copy total.

- **Variante (b) — DuckDB ATTACH Postgres + S3 (recommandée pour démarrer).** Pas d'export de
  signaux ; DuckDB lit PG **et** S3 dans la même requête via `postgres_scanner` :

  ```sql
  ATTACH 'postgres://…immo' AS pg (TYPE postgres, READ_ONLY);
  SELECT n.id AS node_id, n.city_slug, l.feature_id, l.centroid
  FROM   pg.graph_nodes n
  JOIN   read_parquet('s3://sentropic-geo/lakehouse/index/lots/city_slug=' || n.city_slug || '/*.parquet') l
    ON   l.no_lot_norm = pg_normalize(n.props->>'no_lot')
  WHERE  n.type IN ('Signal','DesignationEvent');
  ```
  Aucun ETL de signaux ; la jointure cross-store est faite par le moteur. C'est la variante la plus
  proche du `resolve-refs.ts` actuel, juste avec l'index S3 à la place de `lot_versions`.

**Ce qu'on persiste en PG** (et c'est tout) : la table `geo_resolutions` existante, où
`target_id` = **`feature_id` publié par `geo`** (au lieu du `canonical_id` inventé par immo). Quelques
Ko/ville d'arêtes — pas de géométrie. Le scoring et le rail signaux lisent `geo_resolutions` comme
aujourd'hui ; rien ne change côté consommateurs de la résolution.

### 5.3 Highlight visuel sans géométrie en PG

Quand l'UI sélectionne une zone/un signal résolu :
1. immo renvoie le **`feature_id`** (depuis `geo_resolutions`) + le **`bbox`/centroïde** (depuis
   l'index, déjà en cache).
2. MapLibre fait un `setFeatureState({ source, id: feature_id }, { highlighted: true })` sur la couche
   **PMTiles** → surbrillance native, sans jamais transporter le polygone via immo.
3. `fitBounds(bbox)` pour cadrer. Le polygone exact vient **uniquement** de PMTiles côté client.

C'est la pièce qui rend le zero-copy **complet** : la seule donnée géo qui transite par immo est
l'index léger (clé + bbox + centroïde + feature_id), jamais les polygones.

### 5.4 Cas du scoring spatial (`ST_Contains`, `ST_Area`, zone⊃lot)

Pour les rares besoins spatiaux (adresse→lot par `ST_Contains`, ratio de recouvrement zone⊃lot du
`zone_lots` view actuel), DuckDB `spatial` lit les **polygones GeoParquet** à la demande, par ville,
avec pré-filtre `bbox` depuis l'index. Pas de PostGIS province-wide. À l'échelle ville c'est borné et
rapide ; on ne matérialise jamais la province.

---

## 6. Ce que `geo` doit changer (côté sortie)

Le contrat immo↔geo passe du **shape brut OGC** à un **manifeste + artefacts versionnés**. Concrètement
`geo` doit produire :

1. **GeoParquet partitionné par ville** (idéalement **tables Iceberg** sur `s3://sentropic-geo/lakehouse/`) :
   - `lots/city_slug=<slug>/…parquet` : `feature_id, no_lot, no_lot_norm, city_slug, geometry, snapshot_id`.
   - `zones/city_slug=<slug>/…parquet` : `feature_id, code_affiche, code_norm, kind, city_slug, geometry, snapshot_id`.
   - `no_lot_norm`/`code_norm` **normalisés côté geo** avec la **même règle** que immo (espaces retirés,
     uppercase) — la normalisation devient un **contrat partagé**, pas une réimplémentation immo.
2. **Index léger GeoParquet** (sans polygones) : `index/lots/…` et `index/zones/…` (§5.2) —
   `feature_id, city_slug, *_norm, bbox, centroid, snapshot_id`. C'est ce qui rend la jointure
   triviale et bon marché.
3. **`feature_id` stable et possédé par `geo`** : identité unique par lot/zone, stable entre snapshots
   (remplace le `canonical_id` que immo fabrique aujourd'hui). C'est la clé de `geo_resolutions`.
4. **PMTiles pour le rendu** : `qc-lots-<city>.pmtiles` (ou province-wide tuilé) + `qc-zonage-<city>.pmtiles`,
   avec le **`feature_id`** comme `id` de feature de tuile (indispensable pour `setFeatureState`).
5. **Manifeste JSON versionné** : `s3://sentropic-geo/lakehouse/manifest.json` listant par ville le
   `snapshot_id`, l'`etag`, les URIs Parquet/index/PMTiles. immo lit le manifeste, **jamais** le shape
   brut → robuste si `geo` change son format interne (C3).
6. **Accès S3 en lecture** pour immo (clé scoped read-only sur `s3://sentropic-geo/lakehouse/`).

> Avro est mentionné par le principal : acceptable pour un **flux d'événements de mise à jour**
> (changelog « lot X modifié »), mais **pas** comme format de requête analytique — pour la jointure et
> le pushdown, **Parquet (colonne) > Avro (ligne)**. Reco : Parquet/Iceberg pour les tables + index,
> Avro éventuellement pour le CDC.

---

## 7. Plan de migration incrémental (depuis le pull-PG actuel)

Migration **par bandes**, réversible, sans casser la vue `/geo` existante. À chaque étape, immo reste
fonctionnel via un **flag** `GEO_BACKEND = pg | duckdb`.

| Étape | Contenu | Côté `geo` | Côté immo | Sortie |
|---|---|---|---|---|
| **M0 — Contrat** | Figer le contrat manifeste + `feature_id` + règle de normalisation partagée + schéma index/Parquet/PMTiles. | Spec format de sortie. | Spec consommation. | Doc contrat (SHA) |
| **M1 — Rendu PMTiles** | Brancher MapLibre sur les PMTiles `geo` ; `/geo/features/:city` ne sert plus les polygones, seulement styles + refs. **Garde le PG geom en fallback.** | Génère PMTiles/ville. | `GeoView` lit `pmtiles://` ; `geo-features.ts` arrête le dump GeoJSON polygones. | Rendu masse sans géo PG |
| **M2 — Index + DuckDB** | Embarquer DuckDB (`httpfs`+`spatial`+`postgres`) dans l'API. Réécrire `resolve-refs.ts` : jointure sur l'**index GeoParquet** (variante 5.2b ATTACH PG+S3). `geo_resolutions.target_id` = `feature_id`. | Publie l'index léger + manifeste. | Nouveau provider `geo-index-duckdb.ts` derrière `GEO_BACKEND=duckdb`. | Mapper zero-copy |
| **M3 — Bascule + dépréciation** | Basculer `GEO_BACKEND=duckdb` par défaut. **Arrêter le job de pull OGC→PG** (`pull-geo-ogc.ts`). Marquer `lot_versions.geom`/`zone_versions.geom` dépréciés. | — | Retirer `ogc-pull.ts` du cron ; migration de dépréciation des colonnes geom. | Zero-copy effectif |
| **M4 — Nettoyage** | Drop des colonnes géom + index GiST une fois la confiance acquise (snapshot de secours conservé). Spatial à la demande (DuckDB `spatial`) pour adresse→lot / zone⊃lot. | — | Migration drop geom ; `zone_lots` view → vue DuckDB à la demande. | Postgres allégé |

**Réversibilité** : tant que M4 n'est pas joué, repasser `GEO_BACKEND=pg` restaure le comportement
actuel (le pull et les colonnes geom existent encore). Aucune étape n'est irréversible avant M4.

**Effort indicatif** : M0 ~1 j-h · M1 ~3–4 j-h · M2 ~5–7 j-h (DuckDB embarqué + réécriture mapper) ·
M3 ~2 j-h · M4 ~1–2 j-h. **Total ~12–16 j-h** côté immo, en parallèle de la production des artefacts
côté `geo` (M0/M1/M2 sont les pré-requis `geo`).

---

## 8. Risques honnêtes

| Risque | Impact | Mitigation |
|---|---|---|
| DuckDB cold-start sur S3 (1er hit lent) | Latence mapper/scoring initial | Cache local de l'**index** (Ko/ville) ; partition pruning ; pré-chauffe par ville visitée |
| `geo` n'expose pas encore PMTiles/index/Iceberg | Bloque M1/M2 | M0 = contrat figé ; tant que non livré, `GEO_BACKEND=pg` reste actif (réversible) |
| Normalisation `no_lot_norm`/`code_norm` divergente entre geo et immo | Zéro match silencieux | Normalisation = **contrat partagé** testé des deux côtés (golden fixtures) |
| `feature_id` instable entre snapshots `geo` | `geo_resolutions` pointe dans le vide | Exiger un `feature_id` **stable** dans le contrat M0 ; sinon re-résoudre par clé au changement de snapshot |
| DuckDB `postgres_scanner` + S3 en prod (maturité ops) | Requêtes cross-store fragiles | Variante 5.2a (export refs en Parquet) en repli ; tests d'intégration sur stack `test-*` |
| Dépendance lecture S3 (`geo` indispo) | Mapper/rendu dégradés | Cache index + dernier snapshot PMTiles ; fallback `GEO_BACKEND=pg` |

---

## 9. Références

- Pull actuel (à retirer en M3) : `api/src/services/geo/ogc-pull.ts`, `api/src/scripts/pull-geo-ogc.ts`
- Rendu actuel (à rebrancher PMTiles en M1) : `api/src/services/geo/geo-features.ts`,
  `api/src/routes/geo-features.ts`
- Mapper actuel (à réécrire DuckDB en M2) : `api/src/services/geo/resolve-refs.ts`,
  `api/src/services/geo/extract-refs.ts`
- Schéma PG géo + résolutions : `api/drizzle/0007_geo_mapper.sql`, `api/src/db/schema.ts`
  (`zoneVersions`, `lotVersions`, `geoResolutions`)
- Cadrage géo-intégration (mapper V1 regex, palette, GeoDetailSchema) :
  `docs/spec/cadrage-geo-integration-mapper.md`
- Cadrage acquisition (mentionne déjà PMTiles + clé `NO_LOT` normalisée) :
  `docs/spec/cadrage-zones-lots-acquisition.md`
- Source de vérité géo : OGC API `https://api.geo.sent-tech.ca`, bucket `s3://sentropic-geo/`
