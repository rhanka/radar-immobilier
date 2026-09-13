---
status: completed
reviewer-host: agy
reviewer-model: gemini-3.8-flash-high
reviewer-effort: high
target-ref: 2ab8da2b:docs/architecture.md
lens: Cross-diagram identity and human comprehension; inline packet only, zero tools
---

# Independent inline Gemini review — attempt 3

The complete bounded document and non-sensitive excerpts were supplied inline.
AGY returned SUCCESS with a non-empty final response, verdict **NEEDS CHANGES**.
Session: `arch-storage-gemini38-inline`; native conversation:
`cb16dd2d-afcd-459f-95ed-f612bbe7c23a`. No reviewer tool calls occurred in this run.
The model/effort above are requested identities, not upstream attestation.

The unedited response is preserved in order as [findings](response-findings.md)
and [mapping/limitations](response-mapping.md). The first launch rejection and
the second empty-response failure remain recorded separately; neither is a review.
This is the owner's single AGY review, **not formal multi-peer consensus**.

## Coordinator reconciliation against current main and runtime

| Finding | Disposition | Evidence / change |
| --- | --- | --- |
| 1: Severed grounding/projection, CRITICAL | Accept clarity issue; **reject proven live outage** | Job 41 absent live. Remove it and SCW/MinIO publication targets from operational diagrams; retain main-only template mismatch and unverified stage-3 publication |
| 2: Missing Geo PDF prefix | Accept | `document-resolver.ts` primary mapping is `raw/pv-index/cas/`; added to diagrams 1–3 and prose; optional URL index qualified |
| 3: Restore location/target | Accept misleading placement; **reject invented DB target** | Completed historical Job removed from active overview. No write-to-PG edge without target evidence |
| 4: Shared legacy SCW bucket inside preprod | Accept | Unobserved SCW binding removed from operational views, retained in main-only reference table |
| 5: Geo environment boundaries | Accept | Separate production/shared and preproduction groups; mark cross-environment PV reads |
| 6: Geo DB ambiguity | Accept | Repeat same GEO-DB identity unconnected in Geo view; join is in-process Turf/proj4, not inferred SQL |
| 7: Mixed production refresh edge | Accept ambiguity | Remove unverified production worker/store edges; explicit OVH inventory gap, separate declarations |
| 8: No writer for PP-DOCS | Accept missing qualification; **reject proven empty/static store** | Label code-derived reader default with writer unverified, not “no writer” or an empty bucket claim |
| 9: Scrape worker versus parse process | Accept | One PP-SCRAPE node, stages 1+2 explicitly within same worker |
| 10: Wide Mermaid layout | Accept | Legacy nodes removed; layout/fit inspection handled locally, not claimed as Gemini browser validation |

The review's mapping table overstates several “Active Writers” (notably restore
and workstation) and gives an unsupported Geo DB target architecture. It is
preserved as reviewer output, not adopted as infrastructure evidence.

Further coordinator checks found #670 still OPEN DRAFT, retained live MinIO API
configuration, and lowercase scrape nodes excluded from Signal serving. Those
findings come from main/runtime/i-cond checks, not from Gemini's response.
No revised-document reapproval is claimed; production OVH inventory remains open.
