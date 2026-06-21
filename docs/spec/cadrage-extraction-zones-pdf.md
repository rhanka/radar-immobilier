# Cadrage — Ré-extraction des ZONES de zonage depuis les PDF municipaux → GeoJSON

> **Statut** : cadrage R&D + POC de faisabilité (PAS la prod).
> **Auteur** : rhanka <fabien.antoine@m4x.org> · **Date** : 2026-06-18.
> **Objectif** : prouver et chiffrer un pipeline qui transforme les plans/grilles de zonage
> **PDF** des ~27 petites villes « PDF-only » (sans aucune source vectorielle ouverte) en
> collections `qc-zonage-<ville>` (polygones géoréférencés WGS84), pour débloquer la longue-traîne.
> **Loi 25** : zonage = donnée publique, zéro PII (les PDF traités ne contiennent aucune donnée personnelle).

---

## 0. TL;DR (résultat du cadrage)

- **Le geste manuel de Steve** (dessiner à la main les 193 zones de Sainte-Catherine dans un
  éditeur Leaflet.draw à partir des plans PDF, puis exporter en `sainte-catherine-zones.json`)
  **est automatisable** — totalement pour certains types de PDF, partiellement pour d'autres.
- **Découverte structurante** : une part significative des plans de zonage QC ne sont **pas des
  scans**. Ce sont des **exports SIG/CAO** (Esri ArcGIS Pro, AutoCAD, Illustrator) → soit des
  **GeoPDF géoréférencés**, soit des **PDF 100 % vectoriels** (polygones = paths extractibles).
  Le pire cas (scan raster pur sans géoréf) est **minoritaire** sur les plans récents.
- **POC réussi end-to-end** sur Saint-Amable (GeoPDF Esri) : géoréférencement automatique →
  extraction des 16 codes de zone (texte vectoriel) → reconstruction d'un polygone de zone
  (H-53) **calé sur le cadastre réel** → GeoJSON au format cible. Voir §6.
- **Levier cadastre confirmé et opérationnel** : le cadastre allégé MRNF (lots province-wide,
  EPSG:4326, clé `NO_LOT`) répond en live ; il sert d'**ancrage de calage** (georéf des PDF
  non géoréférencés) **et** de **support de matérialisation** (agréger les lots par zone).
- **Faisabilité honnête** : extraction **automatique fiable** des *codes de zone géoréférencés*
  (centroïdes) ; extraction **semi-automatique** des *contours exacts* (auto + revue humaine de
  10–30 min/ville). Taux attendu : §5.

---

## 1. Contexte et état des lieux du repo

### 1.1 Ce que fait déjà le projet (acquis)

| Brique | Fichier | Apport pour ce cadrage |
|---|---|---|
| **Cadastre allégé MRNF** (lots province-wide) | `packages/radar-sources/src/geo/cadastre-allege.ts` | Ancrage géoréférencé. Source : `geo.environnement.gouv.qc.ca/.../Cadastre_allege/MapServer/0`, EPSG:4326, clé `NO_LOT`. **Testé live 2026-06-18 : OK.** |
| **Zonage open-data ArcGIS** | `packages/radar-sources/src/geo/arcgis-zonage.ts` | Villes AVEC SIG ouvert (Longueuil, Sherbrooke, Shawinigan…). Hors scope ici (déjà couvert). |
| **Zonage open-data CKAN** | `packages/radar-sources/src/geo/ckan-zonage.ts` | 8 villes Données Québec. Hors scope. |
| **Parser règlements urbanisme** | `packages/radar-sources/src/sources/reglements-urbanisme-parser.ts` | Extrait `numéro de règlement` + `codes de zone` du texte. Réutilisable pour les **grilles**. |
| **Inventaire géo par ville** | `packages/radar-sources/src/geo/geo-source-inventory.data.ts` | Statut zonage/lots par ville (`availability`, `quality`). |
| **Ingestion OGC + PostGIS** | `api/src/services/geo/ogc-pull.ts`, `api/src/db/schema.ts` | Format cible : collections `qc-zonage-<ville>`, table `zone_versions` (`code_norm`, `code_affiche`, `kind`, `geom` en `geometry(Geometry,4326)`), bitemporel. |
| **Spikes antérieurs** | `.../_spikes/zonage-plans-grilles-valleyfield/README.md`, `.../_spikes/contraintes-geo-valleyfield.md` | Ont conclu « bloqué : plans = images scannées, vectorisation manuelle requise ». **Ce cadrage lève partiellement ce verdict** (cf. §2 : tous les plans ne sont pas des scans). |

### 1.2 La référence Steve (le geste à automatiser)

- `docs/spec/input/carte-steve/README.md` + `tech/ARCHITECTURE.md` : pour Delson/Saint-Constant,
  le zonage a été **numérisé en amont** (déjà vectoriel) ; pour **Sainte-Catherine**, les
  **193 zones ont été dessinées à la main** dans `editeur-zones.html` (Leaflet.draw) à partir
  des **plans de zonage PDF + grilles par préfixe H/C/I/M/P**, puis exportées en GeoJSON
  (`[{id, code, type, geojson}]`) déposé en `data/sainte-catherine-zones.json`.
- **C'est exactement ce qu'on automatise** : `PDF → polygones de zone (code + géométrie WGS84)`
  au format des collections `qc-zonage-<ville>`.

### 1.3 Format de sortie cible

```jsonc
// FeatureCollection -> collection qc-zonage-saint-amable -> table zone_versions
{
  "type": "Feature",
  "properties": {
    "zone_code": "H-53",          // -> code_affiche / code_norm (uppercase, trim)
    "kind": "H",                  // categorie (H/C/I/A/P/REC/CONS...) derivee de la couleur/prefixe
    "source": "geopdf-esri",      // provenance: geopdf-esri | pdf-vectoriel | scan-georef
    "confidence": "centroid|contour-auto|contour-revu"
  },
  "geometry": { "type": "MultiPolygon", "coordinates": [ /* WGS84 EPSG:4326 */ ] }
}
```

---

## 2. Typologie des PDF de zonage québécois

Testée sur PDF réels (Saint-Amable, Rosemère) + spikes Valleyfield. **Le type se détecte
automatiquement** (`gdalinfo` + `pdfimages -list` + `pdftocairo`/`pdftotext`), ce qui permet
d'**aiguiller** chaque ville vers la bonne branche du pipeline.

### Deux familles de documents

1. **Plan de zonage** (carte) : polygones de zones + codes au centroïde. → porte la **géométrie**.
2. **Grille de zonage** (tableau usages × zones) : 1 grille par zone ou par préfixe, lignes =
   usages autorisés, hauteurs, densité. → porte les **attributs** (pas la géométrie).
   Parsable en texte (`pdftotext` + `reglements-urbanisme-parser.ts`), difficulté moyenne.
   **Hors chemin critique géométrie**, mais enrichit le `kind`/densité des zones.

### Typologie des PLANS (le cœur du problème) — 4 types, du + facile au + dur

| # | Type | Détection auto | Géoréf | Géométrie zones | Effort | Exemple réel testé |
|--:|---|---|---|---|---|---|
| **T1** | **GeoPDF géoréférencé** (export Esri/QGIS) | `gdalinfo` → vrai `GeoTransform` + `NEATLINE` | ✅ **embarqué** | raster (aplats) + labels texte vectoriels | **Faible** | **Saint-Amable** : `Creator=Esri ArcGISPro 3.0.3`, EPSG:3857, GeoTransform présent ✅ |
| **T2** | **PDF 100 % vectoriel** (export CAO/Illustrator), NON géoréférencé | `pdfimages -list` → 0 image ; `pdftocairo -svg` → milliers de paths | ❌ à caler | ✅ **paths vectoriels** (polygones exacts) | **Faible-Moyen** | **Rosemère** : `Creator=AutoCAD 2022`, **0 image**, **25 182 paths** vectoriels, codes texte (C-154, H-150…) ✅ |
| **T3** | **PDF raster géoréférencé** (scan caré en GeoPDF) | `gdalinfo` → GeoTransform mais `pdfimages` → grande image | ✅ embarqué | raster pur (OCR) | **Moyen** | (cas mixte ; ex. feuillets compressés) |
| **T4** | **Scan raster pur** (image, sans géoréf) | `pdfimages` → 1 grande image, pas de texte, pas de GeoTransform | ❌ à caler (points de contrôle) | raster + **OCR** des codes | **Élevé** | **Valleyfield feuillets** (cf. spike) : images scannées, OCR + vectorisation manuelle requis |

**Constat clé vs spikes antérieurs** : les spikes Valleyfield avaient (légitimement) conclu « scan
non exploitable » **sur le cas Valleyfield (T4)**. Mais Saint-Amable est **T1** et Rosemère est
**T2** — deux cas **largement automatisables**. La répartition réelle T1/T2 vs T3/T4 sur les
27 villes conditionne le taux global (à inventorier, §7 lot 0).

---

## 3. Pipeline retenu

### 3.0 Vue d'ensemble (aiguillage par type)

```
PDF de zonage municipal
   │
   ├─ [detect] gdalinfo + pdfimages -list + pdftocairo
   │
   ├─ T1 GeoPDF géoréf  ─────────────► 3.A  (georéf embarqué + labels texte + couleur→catégorie)
   ├─ T2 PDF vectoriel  ─────────────► 3.B  (paths vectoriels + calage cadastre)
   ├─ T3 raster géoréf  ─────────────► 3.A' (georéf embarqué + OCR labels + segmentation raster)
   └─ T4 scan pur       ─────────────► 3.C  (calage par points de contrôle + OCR ; semi-manuel)
   │
   ▼
   Polygones de zone {code, kind, geometry WGS84}
   │  + grilles (attributs usages/densité) via 3.D
   ▼
   FeatureCollection → collection qc-zonage-<ville> → ogc-pull → zone_versions
```

### 3.A — T1 GeoPDF (chemin nominal, prouvé par le POC §6)

1. **Géoréférencement** : `gdalinfo` lit le `GeoTransform` (transformation affine pixel→monde,
   gère la **rotation** du plan) et la projection (EPSG:3857 pour Esri). Aucune intervention.
2. **Warp** : `gdal_translate PDF:1:<f>` → GeoTIFF, puis `gdalwarp -t_srs EPSG:4326` → raster WGS84.
3. **Extraction des labels** : `pdftotext -bbox` donne chaque code de zone (texte vectoriel) avec
   sa **bbox pixel** ; le centre de bbox → `GeoTransform` → **point-label géoréférencé (lon/lat)**.
   Filtrer la **légende** (codes sans tiret type `A1..A5` groupés dans un coin).
4. **Catégorie par couleur** : échantillonner la couleur d'**aplat** autour du label (mode des
   pixels, en excluant le texte noir et le blanc) → `kind` (jaune=H, rouge=C, vert=A, bleu=P…).
5. **Contour de zone** : voir §3.E (matérialisation). POC : agrégation de lots cadastraux.
6. **Sortie** : `{zone_code, kind, geometry}` WGS84.

### 3.B — T2 PDF vectoriel (Rosemère)

1. **Extraction des paths** : `pdftocairo -svg` (ou pdf.js `getOperatorList`, ou pdfminer
   `LTCurve`/`LTRect`) → tous les sous-chemins remplis = candidats polygones de zone.
   (Vérifié : Rosemère = 25 182 paths.) Filtrer par surface/fermeture/couleur d'aplat.
2. **Codes** : `pdftotext`/pdfminer donne les codes de zone (texte) avec position → étiquetage du
   polygone qui contient le label (point-in-polygon).
3. **Géoréférencement (le seul travail)** : le PDF CAO est en **coordonnées page**, pas monde.
   → **calage cadastre** : apparier 3–6 points de contrôle (coins de la ville, intersections de
   rues majeures, ou mieux : centroïdes de zones vs. centroïdes des **mêmes lots cadastraux**)
   et résoudre une **transformation affine/similitude** (helmert) ou **homographie** (4 points).
   Robuste car les paths sont exacts ; il suffit de bien caler.
4. **Sortie** : polygones **exacts** transformés en WGS84. (Type le plus précis une fois calé.)

### 3.A' — T3 raster géoréférencé

Identique à 3.A pour le géoréf (embarqué), mais **labels par OCR** (Tesseract `fra`, restreint à
la regex code de zone) au lieu du texte vectoriel, et contours par segmentation raster (§3.E.b).

### 3.C — T4 scan pur (le cas irréductiblement semi-manuel)

1. **Calage par points de contrôle** : `gdal_translate -gcp` (≥4 GCP saisis sur des repères
   identifiables) + `gdalwarp` (polynomial/TPS). Les GCP peuvent être **semi-assistés par le
   cadastre** (cliquer un coin de rue sur le scan, l'apparier au même coin dans le cadastre).
2. **OCR** des codes (Tesseract) ; **segmentation** des aplats (§3.E.b).
3. **Revue humaine obligatoire** (l'éditeur type Steve reste le fallback). Effort réel.

### 3.D — Grilles (attributs, parallèle au géométrique)

`pdftotext` + `reglements-urbanisme-parser.ts` (déjà au repo) sur les grilles → table
`zone × usages/hauteur/densité`. Jointure par `code_norm` sur les polygones de §3.A–C.
Alimente `kind`, densité (`densiteLogHa`), et le flag « 4+ logements » du scoring.

### 3.E — Matérialisation du CONTOUR de zone (le point dur, 3 options)

C'est l'étape qui sépare « code de zone géoréférencé » (facile) de « polygone exact » (dur).

| Option | Principe | Précision | Auto | Quand |
|---|---|---|---|---|
| **(a) Agrégation cadastre** (POC) | Classer chaque **lot** MERN par couleur=catégorie + Voronoï des labels contraint aux **liserés noirs** (line-of-sight), puis `ST_Union` | Moyenne (~70–85 % lots corrects, contour = bord des lots) | ✅ | T1/T3 ; quand on veut un contour aligné au cadastre |
| **(b) Segmentation raster** | Flood-fill / `gdal_polygonize` des aplats de couleur **bornés par les liserés noirs**, 1 région = 1 zone, étiquetée par le label qu'elle contient | Haute (contour pixel-exact, ~1 px) | ✅ | T1/T3 ; **recommandé** pour le contour fidèle |
| **(c) Paths vectoriels** | Lire directement les polygones du PDF (§3.B) | **Exacte** | ✅ | **T2 uniquement** (PDF vectoriel) |

> **Préco** : (c) pour T2, (b) pour T1/T3, (a) en complément/validation croisée (le cadastre
> reste la vérité d'alignement et permet la jointure lot→zone gratuite pour le scoring).
> Le POC a implémenté (a) car (b) demande `gdal_polygonize` + nettoyage topologique (lot 2).

---

## 4. Le levier cadastre-ancrage (étudié en profondeur)

**Question du cadrage** : peut-on caler le plan PDF sur les **lots cadastraux déjà
géoréférencés** plutôt que de dépendre de l'OCR d'un scan ? **Réponse : oui, et c'est double.**

### 4.1 Ancrage pour le géoréférencement (T2/T4)

Le cadastre allégé MRNF est **province-wide, gratuit, sans auth, en WGS84, clé `NO_LOT`**
(testé live 2026-06-18, réponse en ~1 s). Il fournit un **canevas géoréférencé dense** sur lequel
caler n'importe quel plan non géoréférencé :
- T2 (vectoriel) : apparier sommets de voirie / coins de ville entre les paths PDF et le cadastre
  → transformation affine. Très robuste (paths exacts).
- T4 (scan) : GCP semi-assistés par le cadastre.

### 4.2 Ancrage pour la matérialisation (option 3.E.a, prouvée au POC)

Si on connaît la **couleur=catégorie** de chaque zone (T1/T3) et la position des **labels**, on
**n'a pas besoin de vectoriser les aplats** : on prend les **lots cadastraux** (déjà des
polygones propres) et on les **classe par zone**. L'`ST_Union` des lots d'une zone donne le
polygone. Avantages :
- Contour topologiquement propre (les lots ne se chevauchent pas).
- **Jointure lot→zone gratuite** → directement exploitable par le scoring d'opportunités
  (chaque lot connaît sa zone, son `kind`, sa densité).
- Pas d'OCR de contour, pas de nettoyage de bruit raster.

Limite : la frontière de zone suit le **bord des lots** (légère sur/sous-couverture aux bords ;
les emprises de rue sans lot créent des trous). C'est l'imperfection visible au POC (§6).

### 4.3 Si le PDF donne explicitement lot→zone

Certaines grilles/annexes listent les **numéros de lots par zone**. Dans ce cas, `ST_Union` des
lots listés = zone **exacte**, **sans aucune géométrie à extraire du PDF** (le plan ne sert qu'à
valider). C'est le cas idéal — à exploiter quand présent (parser de grilles, §3.D).

---

## 5. Faisabilité, effort et taux attendus (honnêtes)

### 5.1 Ce qui est AUTOMATISABLE de façon fiable

| Capacité | Type | Taux attendu | Justification |
|---|---|---|---|
| Détecter le type de PDF + géoréf embarqué | tous | ~100 % | `gdalinfo`/`pdfimages` déterministes |
| Extraire les **codes de zone géoréférencés** (points-centroïdes) | T1, T2, T3* | **90–98 %** | texte vectoriel direct (T1/T2) ; *T3 dépend de l'OCR |
| Catégorie (`kind`) par couleur | T1, T3 | 85–95 % | palette Esri stable ; ambiguïté rouge/orange (C/I) |
| **Contour exact** par paths vectoriels | **T2** | **95 %+** | polygones lus tels quels |
| Contour par segmentation raster (3.E.b) | T1, T3 | 80–90 % | dépend de la netteté des liserés |
| Contour par agrégation cadastre (3.E.a) | T1, T3 | 70–85 % lots | borné par la granularité des lots |
| Parser les grilles (attributs) | grilles | 70–90 % | `pdftotext` + regex ; tableaux complexes bruités |

### 5.2 Ce qui reste semi-manuel / irréductible

- **T4 (scan pur)** : calage GCP + OCR + **revue dans l'éditeur** (type Steve). 30–90 min/ville.
- **Validation finale de tout type** : revue humaine légère (10–30 min/ville) pour corriger les
  zones aux frontières ambiguës, les codes mal OCRisés, les amendements non appliqués.
- **Amendements** (un règlement modifie le codifié) : logique d'application non triviale, souvent
  à traiter manuellement ou par règle texte (le spike Valleyfield l'avait noté).

### 5.3 Effort d'industrialisation (au-delà du POC)

| Lot | Contenu | Effort |
|---|---|---|
| L0 | Inventaire : tirer les PDF de zonage des 27 villes, classer T1/T2/T3/T4 (script de détection) | 1–2 j |
| L1 | Pipeline T1 (GeoPDF) industrialisé + segmentation raster (3.E.b) | 3–4 j |
| L2 | Pipeline T2 (vectoriel) : extraction paths + calage cadastre (affine/homographie) | 3–5 j |
| L3 | Parser grilles (réutiliser `reglements-urbanisme-parser.ts`) + jointure attributs | 2–3 j |
| L4 | T4 : calage GCP assisté cadastre + OCR (Tesseract) + intégration éditeur de revue | 4–6 j |
| L5 | Sortie `qc-zonage-<ville>` + ingestion `ogc-pull` + QA/validation par ville | 2–3 j |
| | **Total industrialisation** | **~15–23 j** (selon part de T4) |

### 5.4 Taux global attendu sur les 27 villes (estimation à confirmer par L0)

> Hypothèse de répartition (à valider) : si ~60 % des plans récents sont **T1/T2** (export
> SIG/CAO — plausible vu que 2/2 villes échantillonnées le sont), alors :
> - **~60 % des villes** : zonage géoréférencé **quasi-automatique** (revue ≤ 30 min).
> - **~25 %** : T3 (raster géoréf) → auto + OCR, revue modérée.
> - **~15 %** : T4 (scan pur) → semi-manuel (éditeur de revue), comme Steve l'a fait à la main.
>
> **À ne pas survendre** : le contour pixel-parfait n'est pas garanti sans revue. Mais
> **le code de zone géoréférencé par lot** (= ce que le scoring consomme réellement) est, lui,
> atteignable **automatiquement à >85 %** sur T1/T2/T3.

---

## 6. POC — résultat (Saint-Amable, type T1 GeoPDF)

**Objectif** : prouver l'extraction sur 1 ville facile (PDF vectoriel/géoréf) → 1 zone GeoJSON
correcte. **Résultat : atteint** (avec une honnêteté sur la précision du contour).

### 6.1 Ce qui a été prouvé (faits durs, reproductibles)

1. **Le plan de Saint-Amable est un GeoPDF Esri** (`Creator=Esri ArcGISPro 3.0.3.36057`),
   EPSG:3857, avec `GeoTransform` (incluant rotation) + `NEATLINE`. → géoréf **automatique**.
   ```
   gdalinfo sta-plan-zonage.pdf → Driver: PDF/Geospatial PDF ; GeoTransform présent
   ```
2. **16 codes de zone** extraits du texte vectoriel avec position géoréférencée (H-40…H-79, I-31,
   P-15), + 5 entrées de légende (A1–A5) filtrées. La bbox des labels tombe **exactement sur
   Saint-Amable** (lon ≈ −73.29, lat ≈ 45.64). Artefact : `artefacts/sta-zone-labels.geojson`.
3. **Calage validé contre le cadastre réel** : le label `H-53` (−73.2977, 45.6384) tombe sur un
   îlot **dense de 217 lots cadastraux** MERN (tissu résidentiel) → géoréf cohérent au cadastre.
4. **Polygone de zone H-53 produit** au format cible (`MultiPolygon` WGS84, 3 969 sommets,
   `zone_code=H-53`), par agrégation des lots cadastraux classés (couleur=catégorie H jaune +
   Voronoï des labels contraint aux **liserés noirs** via test de line-of-sight, puis `ST_Union`).
   Artefact : `artefacts/sta-H53-zone.geojson`.

### 6.2 Validation visuelle (artefacts PNG)

- `artefacts/sta-plan-view.png` : le plan complet géoréférencé (noyau urbain coloré H/C/I + zones
  agricoles A autour — Saint-Amable est très agricole).
- `artefacts/sta-urbain.png` : zoom noyau urbain — **jaune=H, rouge=C, bleu=P** clairement séparés
  par **liserés noirs** (les vraies frontières) ; codes au centroïde.
- `artefacts/sta-H53-check2.png` : la zone H-53 reconstruite (magenta) superposée au plan —
  **centrée au bon endroit, sur le bon code**, mais **contour bruité** (cf. limites).

### 6.3 Limites observées (honnêteté)

- **Couleur = catégorie, pas zone individuelle** : toutes les zones H sont jaunes ; H-53 et H-50
  partagent la couleur. La séparation repose sur les **liserés noirs** + Voronoï des labels.
  Le test de line-of-sight réduit le débordement (474 → 236 lots) mais **fragmente** (trous
  internes, lots dont la vue vers le label est coupée par une route).
- **Contour ≈ bord des lots**, pas le tracé exact du plan (limite intrinsèque de l'option 3.E.a).
- **Conclusion POC** : *géoréférencement + identification de zone = automatiques et fiables ;
  contour exact = nécessite l'option segmentation raster (3.E.b) ou les paths vectoriels (T2),
  reportés en industrialisation.* Le POC livre néanmoins **un polygone géoréférencé correct et
  exploitable** pour la 1ʳᵉ zone demandée.

### 6.4 Reproductibilité

Scripts dans `docs/spec/poc/cadrage-zones-pdf/artefacts/` :
- `poc_labels.py` — GeoPDF → points-labels géoréférencés (GDAL + `pdftotext -bbox`).
- `poc_zone_voronoi.py` — couleur=catégorie + Voronoï des labels.
- `poc_zone_v2.py` — + contrainte liserés (line-of-sight Bresenham). **Version retenue.**

Dépendances utilisées (toutes présentes sur la box) : `gdal` 3.8 (+ bindings Python), `poppler`
(`pdftotext`, `pdftocairo`, `pdfimages`), `ogr2ogr`/SpatiaLite (`ST_Union`). **Manquant à
installer pour T3/T4** : `tesseract-ocr` (+ `fra`). Le cadastre allégé MRNF est appelé en live.

---

## 7. Plan d'industrialisation (proposition)

### Lot 0 — Inventaire & aiguillage (prérequis, 1–2 j)
- Script `detect-zonage-pdf` : pour chaque ville des 27, tirer le(s) PDF de zonage (URL connue ou
  scrape de la page « règlements d'urbanisme »), classer T1/T2/T3/T4 (`gdalinfo` + `pdfimages` +
  `pdftocairo` + `pdftotext`). **Livrable : la répartition réelle T1..T4** → recalibre §5.4.
- Étendre `geo-source-inventory.data.ts` avec le type de PDF par ville.

### Lot 1 — Pipeline T1/T3 (GeoPDF) — le plus rentable (3–4 j)
- Industrialiser le POC : géoréf → labels → couleur → **segmentation raster (3.E.b)** pour le
  contour exact (`gdal_polygonize` des aplats bornés liserés) + fallback agrégation cadastre.
- OCR (Tesseract) pour les labels en T3.

### Lot 2 — Pipeline T2 (PDF vectoriel) — le plus précis (3–5 j)
- Extraction paths (`pdftocairo`/pdf.js/pdfminer) → polygones ; étiquetage par label ;
  **calage cadastre** (affine/homographie, ≥4 points). Sortie polygones exacts.

### Lot 3 — Grilles + attributs (2–3 j)
- `reglements-urbanisme-parser.ts` étendu aux grilles ; jointure `code_norm` ; `kind`/densité/4+.

### Lot 4 — T4 (scan) + éditeur de revue (4–6 j)
- Calage GCP assisté cadastre + OCR ; brancher l'**éditeur de zones** (héritage Steve) pour la
  revue/correction humaine, avec export GeoJSON versionné.

### Lot 5 — Sortie & ingestion (2–3 j)
- Émettre `qc-zonage-<ville>` ; ingérer via `ogc-pull` (`zone_versions`, bitemporel) ;
  QA par ville (couverture, % lots couverts, zones orphelines) ; gates jq.

**Préco de séquencement** : L0 → L1 (T1/T3, plus gros volume probable) → L3 (attributs) → L2 (T2)
→ L5 → L4 (T4, le plus coûteux, en dernier sur le résidu). Démontrer la valeur sur les villes
faciles avant d'attaquer les scans.

---

## 8. Risques & garde-fous

- **Anti-invention (cohérent avec l'ontologie du repo)** : une zone n'existe que si son **code
  est lu verbatim** dans le PDF (texte ou OCR). Pas de zone fabriquée. Géométrie nullable si
  non résolue (comme `lot_versions.geom`).
- **Amendements** : un plan codifié peut être périmé ; tracer la `valid_from` (date du règlement)
  et préférer le plan le plus récent. Bitemporel déjà supporté (`zone_versions`).
- **Précision survendue** : communiquer le `confidence` par zone (`centroid` / `contour-auto` /
  `contour-revu`). Ne pas présenter un contour auto comme officiel (« Valider avec la Ville »,
  comme la légende de Steve).
- **Couleur ambiguë** (C rouge vs I orange) : croiser avec le **préfixe du code** (H-/C-/I-/P-/A-)
  qui est sans ambiguïté → le préfixe prime sur la couleur pour `kind`.
- **OCR (T3/T4)** : restreindre Tesseract à la regex code de zone ; valider chaque code contre la
  liste des codes des **grilles** (recoupement).

---

## 9. Conclusion

- **Le geste manuel de Steve est automatisable**, et plus largement que ne le laissaient croire
  les spikes Valleyfield : beaucoup de plans QC sont des **exports SIG/CAO** (GeoPDF géoréf ou
  PDF vectoriel), pas des scans.
- **Pipeline retenu** : aiguillage par type (T1 GeoPDF / T2 vectoriel / T3 raster géoréf / T4
  scan), avec le **cadastre MRNF comme ancrage** (calage des PDF non géoréférencés **et**
  matérialisation des contours par agrégation de lots — jointure lot→zone gratuite pour le scoring).
- **POC réussi** sur Saint-Amable (T1) : géoréf automatique + 16 codes de zone géoréférencés +
  1 polygone de zone (H-53) au format `qc-zonage-<ville>`, calé sur le cadastre réel. Limite
  assumée : contour exact = lot 1/2 d'industrialisation (segmentation raster / paths vectoriels).
- **Effort d'industrialisation** : ~15–23 j ; **taux** : code de zone géoréférencé >85 % auto sur
  T1/T2/T3 ; contour exact 95 %+ sur T2, 80–90 % sur T1/T3, semi-manuel sur T4 (~15 % des villes).

**Prochaine action recommandée** : lancer **Lot 0** (inventaire/typage des 27 villes) pour
remplacer l'hypothèse de répartition §5.4 par des chiffres réels avant d'engager L1/L2.
