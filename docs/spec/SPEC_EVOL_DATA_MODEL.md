# SPEC_EVOL — Data Model: lessons from real Valleyfield investigation

> **Status**: EVOL, authored 2026-05-25 from the committed findings of
> `feat/vertical-slice-valleyfield` (Lots 2–5 spike files).
> Every observation below is grounded in the actual investigation; nothing is
> speculated beyond what the data forced.

---

## 1. What the real data forced

### 1.1 Universal fields (present for every municipality)

The rôle d'évaluation open-data (XML, donneesouvertes.affmunqc.net) provides a
clean universal anchor:

| Field | XML path | Notes |
|-------|----------|-------|
| `noLot` | `RL0103Ax` | Cadastre NO_LOT — the join key to every spatial layer |
| `usage` (code) | `RL0101Ex` | RU/CH/BO/AV/TE — standardised across all 1 100+ QC municipalities |
| `superficie` (m²) | `RL0302A` | Lot surface area, always present |
| `valeurTotale` | `RL0402A` | Authoritative role value — RL0404A/RL0405A may exceed it (historical artefact) |
| `adresseCivique` | `RL0101Ax` + `RL0101Gx` | Civic number + street name; absent for lots without number |

These five fields can be populated from Tier-A open data for every Quebec
municipality that files with MAMH (all 1 100+ do).

### 1.2 Municipality-local fields (require per-municipality work)

| Field | Source | Status |
|-------|--------|--------|
| `zone` (H-609-4, U-521, …) | Règlement de zonage municipal (PDF grilles, feuillets) | Not in rôle XML; must be inferred by spatial intersection with municipal zoning polygons — which are NOT published in open-data vector format for Salaberry-de-Valleyfield (feuillets are scanned PDF images) |
| Règlement d'amendement en cours | Avis publics PDF (Tier A) | Available but per-municipality parsing |
| Densité max (log/ha) après amendement | Grille des usages (Annexe du règlement — PDF) | Partially available (Tier B OCR); grilles post-150-49/150-51 not yet published |
| Usage autorisé après rezonage | Grille H-521 (règl. 150-51), grille H-609-4 (règl. 150-49) | Not yet published at investigation date (2026-05-25); stated non-disponible |

### 1.3 The lot ↔ zone polygon gap

**Root cause:** The investigation confirmed that no open-data vector dataset
exists for Salaberry-de-Valleyfield's municipal zoning polygons. The zoning
maps (Feuillets 1 and 2) are scanned PDF images. The CKAN API of Données
Québec does not list a municipal zoning GeoJSON/WFS for this municipality.

**Consequence for the data model:** The field `zone` in `OpportunityDossier`
cannot be set as `verification: "fait"` from open data alone. All
lot-to-zone assignments in the Valleyfield dossiers are `verification:
"hypothese"` — derived from street-name proximity only.

**Resolution path (not yet implemented):**
1. Vectorise the Feuillet-1/Feuillet-2 PDFs (GDAL/QGIS georeferencing + manual
   digitisation, ~2 days effort).
2. Query the municipal cartographic platform (`https://citoyen.valleyfield.ca/`)
   for WMS/WFS zoning service (not confirmed available).
3. Spatial join lot centroids (from Cadastre allégé REST) with zoning polygons.

Until then, `zone` is stored as a string label in `OpportunityDossier` with no
referential integrity to a GIS polygon table.

---

## 2. Open-data vs redacted vs paid

### 2.1 Open-data (Tier A — confirmed accessible, free)

| Data | Source | Key finding |
|------|--------|-------------|
| Rôle d'évaluation XML (27 MB) | `donneesouvertes.affmunqc.net/role/RL70052_2026.xml` | All 1 100+ QC municipalities; yearly refresh; no auth |
| Cadastre allégé (NO_LOT + polygons) | `geo.environnement.gouv.qc.ca` REST ArcGIS | NO_LOT is the universal join key; geometry in EPSG:3857 |
| BDZI zones inondables | `servicesgeo.enviroweb.gouv.qc.ca` REST ArcGIS | 0 features in Valleyfield bbox — confirmed no mapped flood zones |
| GRHQ hydrographie | Same host, layer 104/101 | 512 elements in Grande-Île bbox — confirms Saint-Laurent density |
| CPTAQ zone agricole (SHP) | `carto.cptaq.gouv.qc.ca` (WMS + SHP 34.5 MB) | WFS returns empty (server limitation); SHP accessible; intersection blocked by missing zone H polygons |
| Avis publics PDF | Ville Valleyfield CloudFront CDN | Règlements 150-49/150-51/150-49-1 + plans PDF — all HTTP 200 |
| StatCan 2021 | `www12.statcan.gc.ca` | Pages returning 404 in May 2026 (migration?); values indexed via Google with medium confidence |

### 2.2 Redacted by law — owner names (LFM art. 72)

The rôle d'évaluation open-data deliberately omits the owner name and contact
information fields (propriétaire). This is mandated by Article 72 of the
**Loi sur la fiscalité municipale** (LFM). The field is present in the MEFQ
XML schema but is blank/suppressed in the published open-data file.

**Impact on `OpportunityDossier`:** The `lots[]` array has no `proprietaire`
field — it cannot be populated from open data. Owner identity requires either:
- The **Registre foncier** (MRNF, paid — ~$1.50/doc via JLR) to retrieve the
  acte de vente and identify the current owner.
- A manual consultation at the municipality (public records with ID).

### 2.3 Paid / commercial (Tier C)

| Data | Source | Impact |
|------|--------|--------|
| Transactions notariées (prix, dates, parties) | JLR (Juris Logics), ~$1.50/doc | Cannot compute price/m² comparables from open data |
| Prix médians par secteur, jours sur marché | Centris / MLS (QPAREB) | No open-data equivalent for QC municipal detail |
| Matricule officiel complet | Registre foncier (MRNF) | The rôle field RL0104C is not the official matricule; Registre foncier is the authoritative source |
| Permis de construction par zone (Valleyfield) | Not on Données Québec (Laval only) | Requires direct request to Ville or MAMH |

---

## 3. jsonb candidates

Fields that are unstable across municipalities and investigation passes, and
should remain in `jsonb` rather than typed columns until patterns stabilise:

| Field | Reason for jsonb |
|-------|-----------------|
| `evidence[]` | Variable-length per dossier; structure evolves (new phases, new obtentionModes); Zod schema in `@radar/domain` validates on write |
| `scores` (ScoreSet) | The 5 criteria are fixed by PROCESS.md but individual rationale text per criterion varies; storing the structured ScoreSet as typed columns is acceptable; but the per-criterion evidence reference belongs in `jsonb` alongside |
| Zone-specific regulatory normes (densité, hauteur, marges par zone) | Grille content differs per zone and per règlement version; no stable column structure until at least 10 municipalities are modelled |
| Contrainte classification (bloquant/coûteux/informatif) | Per-lot-per-layer result; sparse; intersection confidence varies; better as `jsonb` array than normalised table |

**Recommendation:** `OpportunityDossier` is stored as a single `jsonb` column
(validated by the Zod schema at write time) until `BR-06` data investigation
confirms a stable relational structure. The only typed columns at the table
level should be: `id`, `municipality_code`, `zone`, `bylaw`, `score_global`,
`recommendation`, `created_at`, `updated_at`.

---

## 4. Structural gaps confirmed by the investigation

| Gap | Type | Notes |
|-----|------|-------|
| Zoning polygon (H-609-4, U-521, H-143-1) | Missing open-data layer | Not published in vector format; PDF feuillets only |
| Lot ↔ zone assignment | Hypothesis only | Street-name proximity; geometric intersection not possible without zoning polygons |
| Grilles post-amendment (H-521, H-609-4 after 150-49/150-51) | Not yet published | Règlements 150-49/150-51 "en attente" at 2026-05-25; full normes PDF not yet in public repository |
| Flood study for Saint-Laurent riverbank (Grande-Île) | Possible gap in BDZI | 0 BDZI polygons in bbox, but riverbank study may exist outside BDZI for the Saint-Laurent |
| YouTube council transcripts 2026 | Tier-B blocker | JavaScript-rendered page; timedtext API requires authenticated session; yt-dlp + Whisper is the documented resolution path |
| Permis de construction (Valleyfield-specific) | Not on Données Québec | Only Laval publishes this dataset; Valleyfield data requires direct municipal request |
| Registre référendaire results (28 avril 2026) | Not fetched | Results were to be published 2026-04-29 on ville.valleyfield.qc.ca/reglements-municipaux — page not scraped in this investigation pass |

---

## 5. Recommendation for v2 data model

1. **Add `zonePolygonSource`** to `OpportunityDossier`: enum
   `vectorised-pdf | wms-municipal | open-data-ckan | hypothese-street-name`.
   Until a municipality publishes its zoning polygons in open data, the value
   is always `hypothese-street-name`.

2. **`EvidenceItem.value` as `string | null`**: the current schema allows
   `value?: string`. For phase `marche` where Tier C gaps are documented, a
   `null` value with `verification: "non-disponible"` is cleaner than an
   empty string.

3. **Separate `LotCandidat` from `LotConfirmed`**: a lot is a candidate when
   the zone assignment is hypothetical; it becomes confirmed only after spatial
   intersection. The current `lots[]` array mixes both; a `confirmed: boolean`
   flag (defaulting to `false`) would signal this.

4. **`Contrainte[]` as first-class array on `OpportunityDossier`**: currently,
   constraint details are embedded in `evidence[]` items for phase
   `contraintes`. For scoring transparency, a separate `contraintes[]` array
   with `{ type: "BDZI" | "GRHQ" | "CPTAQ" | "servitude", status:
   "bloquant" | "couteux" | "informatif" | "non-applicable", confidence,
   sourceId }` would make the scoring rationale more auditable.
