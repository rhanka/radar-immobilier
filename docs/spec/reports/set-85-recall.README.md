# SET-85 — immo reference set for KPI-20 directional recall (immo→geo)

**Purpose.** The 85 immo `DesignationEvent`s that form the **fixed recall
denominator** of the KPI-20 directional recall (geo's STEVE metric, measured
70/85 = 82.35 % at geo harness SHA `a5c0cf41`). Staged so recette can
**reproduce / cross-verify** the directional recall instead of a sanity-count.

**Provenance.** Filtered from `jointures-designation-events-6.ndjson` (immo graph
dump, jointures) by `node_type == 'DesignationEvent'` → exactly **85** rows
(the other 182 nodes are `Signal`, excluded). Sample = the 5 evaluated cities.

## Files

- `set-85-recall.ndjson` — one JSON object per event (full fields).
- `set-85-recall.tsv` — tabular; columns: `muni  source_url_norm  date_iso
  crosswalked_type  kind  source_url  node_id  docSha`.

## Column provenance — READ THIS

| Column | Status | Note |
|---|---|---|
| `muni` (= `city_slug`) | **authoritative (raw)** | identity field; align on this exact slug (see saint-mathieu below) |
| `source_url` | **authoritative (raw)** | the document URL, verbatim from the dump |
| `date_iso` (= `date`) | **authoritative (raw)** | ⚠ this is the **immo PV date**; see the identity-date rule below |
| `kind` | **authoritative (raw)** | the immo kind |
| `source_url_norm` | **immo-derived (convenience)** | best-effort 7-rule normalization; **recette MUST re-derive via canonical `normalizeSourceUrl@c5b855c2`** for bit-exactness. In this corpus the URLs carry no query/trailing-slash, so norm == raw. |
| `crosswalked_type` | **immo-derived (canonical crosswalk)** | `reverse-map(canonicalGeoCategory(kind))` via frozen crosswalk `b9c121d`; verified against both `geo-category-mapping.ts` and the crosswalk's own `observed_designation_event_hors_map`. `UNMAPPED` = no matchable key. |

## Breakdown (verified)

- **per-city DesignationEvents:** coaticook 6, saint-eustache 50,
  **saint-mathieu-de-beloeil 18**, saint-raymond 8, sutton 3 — total **85**.
- **crosswalked_type:** changement-de-zonage 69 (modification_zonage 62 +
  rezonage 7), derogation-mineure 9 (derogation 7 + derogation_mineure 2),
  ppcmoi 2, cptaq 1, **UNMAPPED 4** (piia 3 + modification_reglementation 1).
- **mapped 81 / 85 → honest ceiling 81/85 = 95.29 %.** Measured directional
  recall 70/85 = 82.35 %; the 11-event gap (81 matchable − 70 matched) is
  identity divergences + geo non-emission, not a denominator problem.

## Resolves recette's saint-mathieu divergence

recette flagged: `saint-mathieu matched 12 > its 10 events`. In this
**authoritative** set, `saint-mathieu-de-beloeil` has **18** DesignationEvents,
not 10 — recette's 10 came from an **old set or a truncated slug**
(`saint-mathieu` vs authoritative `saint-mathieu-de-beloeil`). `matched 12 ≤ 18`
→ the `matched ≤ immo_count` bound **holds**; no anomaly. **Align muni on the
full slug `saint-mathieu-de-beloeil`.**

## Identity-date rule (cf. amended recall contract §1.1)

`date_iso` here is the **immo PV date**. The recall identity key uses the
**décision/séance date** — where they differ (observed: **sutton 1/3**), the
event fails identity and costs recall. Reconcile to the séance date (exact match,
**no window**) before grouping; do not widen the date to force a match.

## Canonical measure

Per `docs/spec/CONTRAT_MESURE_RECALL_SET.md` (amended, owner GO Option A):
`recall = Σ_g min(immo_count[g], geo_count[g]) / 85`, directional immo→geo,
key `(muni, source_url_norm, date_iso, crosswalked_type)`. Re-derive
`source_url_norm` and `crosswalked_type` canonically; the raw fields here are the
ground truth.
