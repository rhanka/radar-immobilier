---
description: "Source adapter contract and scraping etiquette specific to radar-immobilier"
paths: ["packages/radar-sources/**", "api/src/services/sources/**"]
tags: [sources, scraping]
---

# Sources & scraping

## Source adapter contract

Every source adapter implements the `SourceAdapter` interface in `packages/radar-sources/src/SourceAdapter.ts`:

```ts
interface SourceAdapter {
  readonly kind: SourceKind;         // 'avis-publics' | 'pv' | 'video-youtube' | ...
  readonly city?: string;            // 'salaberry-de-valleyfield' | undefined
  readonly version: string;          // adapter version, semver

  list(opts: ListOptions): AsyncIterable<RawDocumentRef>;
  fetch(ref: RawDocumentRef): Promise<RawDocument>;
  hash(raw: RawDocument): string;    // sha256 of the canonical content
}
```

The runtime is responsible for storing raw payloads in S3, recording the ingestion, and calling the extractor. The adapter must remain stateless and idempotent.

## Etiquette

- Default rate-limit: **1 request per 2 seconds** per source, with jitter (±300 ms).
- Configurable per source in `sources` table (column `config jsonb`).
- Backoff on HTTP 429 / 503: exponential, max 5 retries, total budget 5 minutes.
- Respect `robots.txt`. Document any deliberate deviation in the source adapter README with rationale.

## User-agent

- Format: `radar-immobilier/<version> (+contact@…)`.
- Provide a contact email in the UA string for any production source.

## Obscura usage

- Connect via Playwright to the Obscura sidecar (`obscura://obscura:9222` in compose, K8s service in prod).
- Disable Obscura's anti-detect features (`stealth: false`) for sources that don't have bot protection — anti-detect is reliability, not deception.
- Capture full HTML + screenshot for any PDF or JS-rendered page; store both in S3.

## Storage of raw payloads

- Key pattern: `raw/<source-kind>/<city>/<YYYY>/<MM>/<DD>/<sha256>.<ext>`.
- Always write the raw payload **before** extracting; extraction never re-fetches.
- Re-extraction is cheap (LLM call); re-fetching is expensive and rude.

## PDF handling

- Store the original PDF in S3.
- OCR via a pluggable `PdfExtractor` (start with a simple `pdf-parse` based extractor; upgrade to `unstructured` or similar if needed).
- Always keep the page reference in `extracted.pages[].text` so scoring evidence can point to a page.

## Video handling (YouTube and others)

- Out of scope for the demo vertical slice (avis publics). Spike only in BR-05.
- If implemented later: download captions if available, transcript via Whisper (cloud or local) otherwise. Store both transcript and original media URL.

## Investigation in `_spikes/`

- New source = create `packages/radar-sources/src/sources/_spikes/<source>/README.md`.
- The README documents: URL, format, sample documents, complexity assessment, effort estimate (man-days), recommendation (build adapter / wait / drop).
- Spike code is NOT shipped into production — it stays in `_spikes/` until promoted.

## Investigation skill

The `source-spike` skill (`.claude/skills/source-spike/`) automates the spike scaffolding: creates the `_spikes/<source>/` directory, fetches sample documents, drafts the README skeleton.
