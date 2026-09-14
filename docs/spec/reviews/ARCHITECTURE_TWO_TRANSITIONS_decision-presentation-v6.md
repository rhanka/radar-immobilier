---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v6
target-diff-sha256: a8d5eed60258d38a9641052fc8a148824fe3fbf5f70a331c6479fcc906988b46
lens: exact M1 option cardinality, canonical scene proof, edge geometry, and PDF parity
---

# Independent review v6 — decision and presentation

## Verdict: GO

The requested SHA-256 is verified against the exact working-tree diff of the two assigned files: `a8d5eed60258d38a9641052fc8a148824fe3fbf5f70a331c6479fcc906988b46`. The EVOL and ARCH2 plan diff closes the prior cardinality, canonical-projection, edge-geometry, and predecessor-PDF parity gaps. Implementation can start, subject to the explicit implementation acceptance gates below. This review reads only the EVOL and ARCH2 plan diff for the target handoff.

## Findings

### No blocking finding — M1 cardinality and canonical results

**Evidence:** D6.4 fixes the exact option set to `sonnet-comparable,luna-low,gemini38-lowest` and makes `candidateAttempts` the canonical three-row summary with exactly one stable `attemptId` for each option, no extra/duplicate option, and no retry promoted to a candidate row. Retries remain in a content-hashed `transportLedgerRef`, with option, case, retry index, state, and receipt retained. D6.7 further requires the output-bearing attempt/result mapping to be bijective, forbids duplicate attempt/output references and mismatched result fields, and requires the rank-eligible option set to equal the exact three-option set before ratification. The invalid-fixture list explicitly covers omitted/extra/duplicate options, three results from one option, detached or missing results, and Gemini no-output promotion.

**Assessment:** This is sufficient to prevent a retry or repeated option from masquerading as a complete M1 benchmark. Gemini no-output is correctly `not-classifiable`, has null output and metrics, and cannot enter results or ranking. Sonnet is a first-class comparable option only under the frozen common contract, with requested/effective identity and secret hygiene retained.

### No blocking finding — canonical projection, provenance, and state hashing

**Evidence:** D4 makes `docs/architecture.md` authoritative for exactly four scene IDs and pairs it with an exhaustive, case-sensitive `scene-metadata.js` map. It disallows defaults/fallbacks and requires non-null node/group kind, repository, evidence class, and runtime state, plus edge evidence/runtime state. The closed evidence and runtime-state sets are explicit. Label normalization, verbatim case-sensitive Mermaid IDs, deterministic edge IDs, duplicate-edge rejection, cluster `parentId`, root `null`, fixed projection key order, UTF-8/NFC/LF serialization, sorted nodes/edges, and SHA-256 hashing are all specified. The projection includes node and edge topology, labels, parentage, provenance, evidence, and runtime state; Focus, native DOM, and report manifest must independently reconstruct and match it. Missing, extra, reordered, or divergent data fails, so a copied hash cannot substitute for canonical reconstruction.

**Assessment:** Every A-before node and relation is visibly qualified as declared, while the observed two-node capacity note is a separate unconnected capacity-only node. Closed node/edge evidence and runtime states are part of the hashed projection. The contract also preserves deterministic provider/repository attribution and cluster handling.

### No blocking finding — visual topology and edge completeness

**Evidence:** D4 requires exactly four complete Mermaid graphs and four nested native SvelteFlow scenes, preserving `parentId`, containment, service icons, repository labels, and edges. The four graph contracts provide the required pair/date separation: A is storage/registry, B is PV-to-Signal refresh; B-after is explicitly production dormant, and B corpus/publication labels are provider-neutral. The TEM exception is visible in all four graphs, with an API email edge in pair A and an unconnected transverse annotation outside the PV extraction path in pair B. The exact user label `Navigateur utilisateur` is used in all four source graphs. D5 requires the complete-scene bounds to include node, cluster, edge-label, and sampled edge-path geometry; every native and Mermaid edge path is inventoried for transformed bounds, stroke visibility, length, and samples at no more than 8 CSS-pixel intervals. Missing, hidden, zero-length, or clipped geometry fails absent an explicit tested exception, and every sampled point must remain within the full capture.

**Assessment:** Endpoint/hash preservation is reinforced by actual rendered geometry checks rather than topology metadata alone. The capacity note remains visually isolated, and the pair-B neutral/dormant constraints prevent provider or preproduction resources from silently entering the production refresh graph.

### No blocking finding — no-zoom presentation and PDF binding

**Evidence:** D4.1 freezes the D8 comparison baseline and sets the new card-height band (120–156 CSS px), compact padding/gaps, effective rendered text minima, slack/blank-space limits, and PDF minima. D5 requires Chromium checks at both fixed viewports, browser zoom 100%, device scale 1, and no fit-to-view below scale 1; it records transformed rectangles, content bounds, text roles/effective pixels, overflow/clipping, and worst-case metrics. Complete scenes may pan/scroll but may not shrink to satisfy bounds. PDF pages must bind scene hash, edge inventory, and capture hash and must preserve the declared title/description/repo/status size minima. All four complete graph pages and screenshots are required; supplemental detail pages cannot repair a failed complete view.

**Assessment:** The contract tests actual readable rendered output, not merely CSS declarations. It also retains the visible TEM exception, dormant banner, `repo:` labels, state qualifications, and no-zoom geometry in the acceptance inventory.

### No blocking finding — exact report window and predecessor parity

**Evidence:** D4 fixes the report interval to `[2026-08-10T00:00:00-04:00, 2026-09-14T00:00:00-04:00)` in America/Toronto, exactly 35 days/840 hours, and preserves billing values/method. D5 requires the exact `10 août → 13 septembre 2026` label and interval in HTML, PDF text, and the manifest. It pins the predecessor path and source SHA-256, requires a working HTML link, embeds the original bytes under the specified attachment name, and requires `pdfdetach` extraction to hash exactly to the source. It separately renders predecessor source pages 1–9 and the final appendix range with Poppler 26.01.0 and requires equal ordered per-page PNG SHA-256 arrays with an explicit page map. The four current complete graph pages precede the nine-page appendix, and mention-only, attachment-only, page-count-only, or substituted appendices are rejected.

**Assessment:** This is both byte-level attachment proof and content-level nine-page parity; page merging/recompression cannot falsely satisfy the attachment check, and a visually substituted appendix cannot satisfy the per-page hash check.

## Implementation-release conditions (non-blocking gates)

1. Implement the specified JSON Schema and invalid fixtures literally; do not weaken the exact three-option/canonical-row or bijection invariants.
2. Generate all four Mermaid and native scenes from the same canonical source and independently reconstruct the projection before comparing hashes. Do not use fallback metadata or copied manifest hashes.
3. Retain the full edge-path inventory and complete-scene captures at both required viewports, including TEM and dormant-banner geometry.
4. Bind each PDF graph page to its scene/capture hash and complete the Poppler attachment/appendix parity procedure at the same implementation HEAD.
5. Treat all measurements as pending until actual Chromium, native/SVG, and PDF evidence passes; this review is not an implementation or browser test result.

**Decision:** GO. The EVOL/ARCH2 design is sufficiently precise for bounded implementation to begin. No production promotion, model ratification, billing change, or claim of completed parity is authorized by this review alone.
