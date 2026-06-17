# SPEC INTENT — Graphify v2.3 evidence contract

> Status: intent / blocking contract for the next graphify rerun.
> Date: 2026-06-17.
> Scope: graphify ontology output, Signal/DesignationEvent evidence, and rerun gating.

## 1. Decision

The next ontology refresh is **v2.3**, not a silent v2.2 repair.

Graphify v2.3 must be run with Claude Sonnet 4.6 once quota is available. It must preserve the useful v2.1/v2.2 signal surface while adding exhaustive evidence required by the product UI.

## 2. Required fields

Every `Signal` and `DesignationEvent` node should carry enough evidence to render a right-pane card without guessing.

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
- Existing `zone_ref`, `no_lot`, and `reglement_number` enrichments remain part of v2.3.

## 3. Gates

A v2.3 candidate must fail the gate if it drops any existing `Signal` or `DesignationEvent`.

For every `Signal` and `DesignationEvent`, the gate must report:

- `hasDescription`
- `hasCitationExcerpt`
- `hasPdfLink`
- `hasDocSha`
- `hasPageOrBbox` for PDF-backed refs
- `hasZoneRef`
- `hasLotNumber`
- `hasReglementNumber`

Blocking thresholds:

- No critical `z|m|p` node may lose its existing business classification.
- No critical `z|m|p` node may ship without `description`, citation excerpt, and PDF/raw link.
- Non-critical missing evidence is allowed only with an explicit `evidenceStatus: "incomplete"` marker and a reason.
- The published `z|m|p` count must not silently drop below the protected 33 without a reviewed explanation.

## 4. Execution constraints

The run must use the graphify CLI/runtime path explicitly. Patching `latest.json` directly is not sufficient for v2.3.

Before running:

- Align the repo/container graphify version with the system graphify CLI capability.
- Record graphify package version, model, reasoning mode, prompt version, source graph version, and raw manifest hash.
- Keep Sonnet 4.6 provenance distinct from Codex Spark or deterministic repair provenance.

## 5. Acceptance

v2.3 is accepted only when:

- Current v2.2 graph coverage is preserved or explained city-by-city.
- The 33 priority detections remain protected.
- Right-pane signal cards can display description + citation + PDF link for the priority set.
- The performance of deterministic extraction remains evaluated separately and is not used as an unproven replacement for Sonnet output.
