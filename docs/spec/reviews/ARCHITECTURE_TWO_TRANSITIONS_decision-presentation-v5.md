---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v5
target-diff-sha256: cb8b5671e5efbffac0ce094e6ac9001bc25fc3bef4acd9f1c8801e8065408528
lens: M1 cardinality, PDF attachment/appendix parity, topology hashes, and no-zoom acceptance
---

# Independent review v5 — decision and presentation

## Verdict: CHANGES REQUIRED

Implementation must not start from this handoff. The requested SHA-256 is verified for the exact two-file Git diff: `cb8b5671e5efbffac0ce094e6ac9001bc25fc3bef4acd9f1c8801e8065408528`. This review otherwise relies only on the EVOL and ARCH2 plan diff, not on sibling reviews or consensus.

## Findings

### F1 — High: M1 JSON does not enforce one complete candidate per option

**Evidence:** D6.4 defines three options and D6.7 calls for “Three candidate rows,” but the normative cardinality text only requires a bijection between output-bearing attempts and results. It does not require exactly one benchmark attempt/result for each of the three option IDs, nor prohibit multiple attempts for one option from satisfying the three-result ratification condition. D6.4 also says that `candidateAttempts` contains each attempt exactly once, which is uniqueness of an attempt ID, not option cardinality. The illustrative payload has one attempt per option, but is explicitly non-normative.

**Impact:** An implementation can legally export three classifiable results for repeated `luna-low` attempts, omit Sonnet or Gemini, and still meet the stated “three classifiable matched results” ratification gate. The UI can display three rows while the JSON decision is not a three-option matched benchmark. This is a decision-integrity failure, not merely a presentation gap.

**Required correction:** Make the schema normative about the benchmark set: exactly the three option IDs, exactly one canonical benchmark attempt/result per option (or explicitly model and validate a separate retry/attempt grouping with one selected canonical attempt per option), and ratification requiring the set of ratified result option IDs to equal the three-option set. Add invalid fixtures for duplicate option attempts, omitted option, and three results from one option. Define how transport retries relate to the canonical attempt so retries cannot inflate or replace a candidate row silently.

### F2 — High: complete-scene parity does not measure or bound edge geometry

**Evidence:** D4 requires preservation of exact edges and D5 requires every edge’s canonical ID/endpoints. The visual inventory in D5 records “every Mermaid node/cluster/edge-label's SVG bounding box,” but no Mermaid or native edge-path bounding box, path intersection, clipping check, or edge geometry is recorded. D5.14 defines complete-scene bounds as the union of node, cluster, and edge-label boxes, explicitly omitting edge paths. The PDF gate likewise requires four complete-page screenshots but supplies no edge-path inventory.

**Impact:** A renderer can preserve endpoint IDs and labels while clipping, routing outside the capture, or dropping an edge segment; the union-based full-scene proof can still pass. That is incompatible with the stated complete-scene and exact-topology acceptance, especially for the nested dormant B-after scene and its many dashed causal edges.

**Required correction:** Include each native and Mermaid edge path/segment in the canonical visual inventory, with its transformed geometry and clipping/intersection result. Define the complete-scene union over node boxes, cluster boxes, edge-label boxes, and edge geometry (or state a reproducible equivalent), and bind the PDF page check to the same edge inventory. Require every canonical edge to have visible, unclipped geometry or an explicit, tested exception for a deliberately zero-length/hidden edge.

### F3 — Medium: canonical projection leaves provenance and normalization under-specified

**Evidence:** D4 says Focus reconstructs the projection from parsed Mermaid “plus provenance,” while the fixed projection serializes only `sceneId,pair,date,nodes,edges` and node fields `id,label,evidenceClass,parentId,repo`. It does not define the provenance mapping’s canonical source, how Mermaid IDs map to native `data-id`, how missing `repo`/`parentId` is represented beyond the root parent rule, or whether labels are compared after whitespace/entity/line-break normalization. The requirement to use UTF-8/NFC and fixed key order is insufficient to make the three independently generated projections deterministic.

**Impact:** Focus and the report can produce equal hashes from a shared copied manifest while the actual parsed Mermaid/native topology differs, or can reject equivalent graphs for renderer-specific label serialization. The document correctly rejects copied hashes, but does not provide a complete reproducible projection algorithm for the proof it requires.

**Required correction:** Specify the authoritative node/edge identity and provenance map, required values and nullability for every serialized field, exact label normalization/escaping, Mermaid parser treatment of clusters and edge multiplicity, and the native DOM extraction algorithm. Validate the independently reconstructed projection against the canonical JSON before hashing; fail on absent or extra provenance rather than filling defaults.

## Checks passed

- August relations are declared with explicit limits, including the distinction between Git reconstruction and runtime observation.
- Pair A and pair B each have before/after graphs; pair B uses provider-neutral corpus/graph labels and keeps production/model activation dormant.
- Sonnet comparability and external credential hygiene are stated; Gemini no-output is explicitly non-classifiable and excluded from candidate results.
- The exact `Navigateur utilisateur` label, visible TEM exception, dense-card and effective-size requirements are stated for all four surfaces.
- The exact `10 août → 13 septembre 2026` / 35-day / 840-hour window is specified.
- The preceding PDF SHA-256, `pdfdetach` byte proof, nine-page Poppler 26.01.0 ordered render parity, and four graph-page ordering are explicitly required.
- The finite M1 states, legal classifications, normative-schema intent, output-bearing bijection, required fields and invalid cases are substantially specified; F1 is the remaining cardinality hole.
- Canonical scene IDs, projection fields, hashes, native reconstruction, PDF scene binding and exhaustive no-zoom card/text/overflow measurements are present; F2 and F3 identify proof gaps that remain material.

**Decision:** CHANGES REQUIRED. Implementation may begin only after these findings are amended in the EVOL and the resulting two-file diff is re-reviewed.
