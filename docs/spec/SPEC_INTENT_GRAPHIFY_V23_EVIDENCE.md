# SPEC INTENT — Graphify v2.3 evidence contract

> Status: intent / blocking contract for the next graphify rerun.
> Date: 2026-06-17.
> Scope: graphify ontology output, Signal/DesignationEvent evidence, and rerun gating.

## 1. Decision

The next ontology refresh is **v2.3**, not a silent v2.2 repair.

Graphify v2.3 must be run with Claude Sonnet 4.6 once quota is available. It must preserve the useful v2.1/v2.2 signal surface while adding exhaustive evidence required by the product UI.

## 2. Required fields

Every `Signal` and `DesignationEvent` node should carry enough evidence to render a right-pane card without guessing.

This does **not** make flat zone/lot/bylaw properties the source of truth.
The canonical graph structure remains edge-based. v2.3 must preserve or
create the expected ontology relations (`TARGETS_ZONE`, `TARGETS_LOT`,
`REZONES`, `RAISES_SIGNAL`, `MENTIONS` / `DERIVED_FROM` where applicable)
and any derived UI fields must be recomputable from those nodes and edges.

Required output shape:

```json
{
  "id": "signal-...",
  "type": "Signal",
  "label": "Short human label",
  "properties": {
    "description": "Human-readable description grounded in the source text",
    "docSha": "sha256...",
    "sourceUrl": "https://...pdf",
    "sourceKind": "proces-verbal|avis-public|youtube|other",
    "date": "YYYY-MM-DD",
    "municipality": "city-slug"
  },
  "refs": [
    {
      "docSha": "sha256...",
      "excerpt": "Verbatim citation from the source",
      "page": 3,
      "bbox": [0.12, 0.34, 0.56, 0.40],
      "sourceUrl": "https://...pdf",
      "rawRef": "raw/..."
    }
  ]
}
```

Field rules:

- `properties.description` is mandatory when the source supports a grounded description.
- `refs[]` is mandatory when a source document is available.
- `refs[].excerpt` must be a citation, not a paraphrase.
- `refs[].sourceUrl` is preferred; `rawRef` is accepted as fallback when the public URL is unavailable.
- `page` is required for PDFs when known.
- `bbox` is required when the extraction path can provide it; otherwise it may be absent but must not be fabricated.
- Zone, lot, and bylaw references must be represented canonically through
  graph nodes and relations. Legacy flat enrichments such as `zone_ref`,
  `no_lot`, or `reglement_number` may be kept only as derived convenience
  properties when already present; they must not replace the graph relation.
- v2.1 anticipation fields remain protected: `etape` and `etape_date` must
  be preserved on `Signal` / `DesignationEvent` nodes where the output
  contract requires them.

## 2.1 Document dates and provenance

The UI must not treat graph ingestion time as a source date. v2.3 distinguishes
the following date axes:

- `publishedAt`: publication/date exposed by the source listing or run
  manifest. This is a document metadata field.
- `meetingDate`: date of the council meeting/session, when extractable from
  the PV body or a structured source.
- `etape_date`: date of the regulatory stage described by the signal.
- `createdAt`: database projection/ingestion time only; never shown as the PV
  or signal source date unless explicitly labelled as ingestion time.

Graphify v2.3 should use existing raw/parsed/run-manifest data as input. It
must not require a full rescrape when raw PDFs, parsed text, and run manifests
already exist. If `publishedAt` is absent from a legacy sidecar but present in
the run manifest, the manifest value is authoritative. If only the URL or title
is available, extraction is allowed only when precision is explicit; partial
dates must carry a precision/incomplete marker rather than inventing a day.

The API/UI layer resolves document metadata server-side. Graphify should emit
`docSha` and `rawRef`/`sourceUrl` where possible, but the API may enrich these
refs from the S3 manifest/document projection before returning UI cards.

## 3. Gates

A v2.3 candidate must fail the gate if it drops any existing `Signal` or `DesignationEvent`.

For every `Signal` and `DesignationEvent`, the gate must report:

- `hasDescription`
- `hasCitationExcerpt`
- `hasPdfLink`
- `hasDocSha`
- `hasPageOrBbox` for PDF-backed refs
- `hasEtape`
- `hasEtapeDateWhenRequired`
- `hasCanonicalZoneRelation`
- `hasCanonicalLotRelation`
- `hasCanonicalBylawRelation`

Before the run, build a protected manifest for the current 33 priority
`z|m|p` detections. Each entry must contain the current node id, a stable
business key, node type, municipality, date or stage date, `docSha`, label,
kind/stage fields, and expected zone/lot/bylaw relation fingerprints when
known. The gate compares this manifest by stable key, not by count alone.

Blocking thresholds:

- `ontology_version` must be exactly `"2.3"` for the accepted candidate.
- v2.1 compatibility gates must remain green, including non-regression of
  `etape` and `etape_date` values where they existed or were required.
- No critical `z|m|p` node may lose its existing business classification.
- No critical `z|m|p` node may lose its canonical zone, lot, bylaw, or
  designation-event relation when that relation existed in the protected
  manifest.
- No critical `z|m|p` node may ship without `description`, citation excerpt, and PDF/raw/document link.
- Non-critical missing evidence is allowed only with an explicit `evidenceStatus: "incomplete"` marker and a reason.
- The published `z|m|p` count must not silently drop below the protected 33,
  and preserving the count is not sufficient if the manifest identity or
  relation fingerprints changed without review.

## 4. Execution constraints

The run must use the graphify CLI/runtime path explicitly. Patching `latest.json` directly is not sufficient for v2.3.

Before running:

- Align the repo/container graphify version with the system graphify CLI capability.
- Record graphify package version, model, reasoning mode, prompt version, source graph version, raw manifest hash, and protected `z|m|p` manifest hash.
- Keep Sonnet 4.6 provenance distinct from Codex Spark or deterministic repair provenance.

## 5. Acceptance

v2.3 is accepted only when:

- Current v2.2 graph coverage is preserved or explained city-by-city.
- The 33 priority detections remain protected.
- Right-pane signal cards can display description + citation + PDF link for the priority set.
- The performance of deterministic extraction remains evaluated separately and is not used as an unproven replacement for Sonnet output.

## 6. Workpackage integration

The evidence work is split across three existing workpackages:

- **Data PV / S3-first persistence**: persist `publishedAt` and title metadata
  during initial recueil, and add a repair path from existing run manifests and
  URLs without full rescrape.
- **Graphify ontology v2.3**: require description, citation, document refs,
  distinct source dates, and non-regression gates for protected priority
  detections.
- **Data model / API / UI selection bucket**: expose a `GraphSignalCard`
  server DTO, resolve document metadata, and render source PDF overlays with
  citation/page/bbox fallback states.
