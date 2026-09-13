---
status: selection-failed
review-author:
  host: codex
  model: gpt-6-astra
  effort: xhigh
target-ref: 73762926:docs/architecture.md
observed-failure: The requested Gemini 3.8 Flash High is exposed by the live AGY catalog; the loaded harness review selection admits only Claude/Codex profiles and requires two eligible legs. This user-directed AGY audit is not a formal harness consensus.
---

# Cross-diagram storage review

Author metadata was read from this conversation's turn-context records. The live
`agy models` catalog resolves the owner's request to `gemini-3.8-flash-high`.
Requested routing/effort is not an attestation of the upstream effective model.

The owner reports that diagrams 1 and 2 cannot be reconciled: database and object
store identities, infrastructure placement and processing paths are not shared.
The coordinator audits source/deployment wiring while the independent reviewer
audits the committed baseline, blind to the proposed correction.

External review: [Gemini leg](review-storage-gemini.md). No consensus verdict.

## Reconciliation

External review remains blocked. The following are **coordinator findings**, not
Gemini findings or a consensus. Corrected architecture target: `56a2dd19`.

| Finding | Evidence | Disposition |
| --- | --- | --- |
| Infrastructure omitted Immo stores; processing used unbound logical stores | Baseline diagram 1 had only Geo S3; diagram 2 used corpus/candidate/graphstore without physical identities | Accepted: shared environment-qualified IDs and resource register |
| Preprod PDF reader bypassed the drawn Immo stores for mapped PVs | Live Deployment `GEO_DOCUMENTS_REPOINT=1`, bucket `sentropic-geo`; `api/src/index.ts:26`, `api/src/routes/documents.ts:76` | Accepted: direct `PP-API → GEO-S3` READ edge in diagrams 1–3; no Immo fallback for mapped keys |
| Default API scrape store was missing | Live API ConfigMap/Deployment have no `SCRAPE_S3_*` override; `api/src/config.ts:240` defaults bucket to `radar-immobilier-docs` | Accepted: `PP-DOCS`, separate from `PP-RAW` and refresh `PP-GRAPH`; derived config, not verified bucket contents |
| Logical prefixes were mistaken for separate stores | Live scrape/projection both select `radar-immobilier-graph-preprod`; Geo raw/products use `sentropic-geo` | Accepted: one physical node per bucket per view, explicit prefix roles |
| Publisher destination and projection input do not align | Job 41 writes MinIO docs-preprod, live projection reads OVH graph-preprod | Accepted: distinct `PP-GROUND` and `PP-GRAPH`, no fabricated synchronization arrow |
| Generic prod/preprod processing hid unverified production bindings | Production projection literal versus secret-backed scrape configuration; no live production app inventory | Accepted: diagram 2 explicitly preprod; production counterpart qualified in register |

## Local verification

- `make -f docs/architecture/Makefile render verify ENV=test-architecture`: pass.
- Resource contract: 16 identical shared Immo IDs/labels, 6 Geo resource identities,
  storage-register entries; 3 negative fixtures reject omissions/drift/duplicates.
- The resource check rejects baseline `73762926` with `PP-DB missing` as expected.
- Chromium: all 4 Mermaid diagrams render; zoom/full-screen/Escape pass; no page
  overflow at desktop 1440px or mobile 390px. The diagrams themselves are scrollable.
- No application, deployment, object contents or Secret values changed/read.

Remaining acceptance: the requested external review requires owner approval of the
bounded non-sensitive payload and a fresh successful launch. No external verdict
is implied by the local checks above.
