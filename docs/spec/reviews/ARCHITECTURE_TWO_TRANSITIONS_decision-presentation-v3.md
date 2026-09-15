---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-luna
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v3
target-diff-sha256: a6a8ba3ed6ab7fd6aacf24065e32949761b333aacf169f5dbcef775dc24739f2
lens: M1 decision integrity, comparability, evidence classification, report parity, and no-zoom acceptance
---

# Independent review v3 — decision and presentation

## Verification

The requested command produced the expected target hash:

```text
a6a8ba3ed6ab7fd6aacf24065e32949761b333aacf169f5dbcef775dc24739f2
```

Review was limited to the specified EVOL and plan. The four graph sketches visibly retain the SCW TEM exception, use `Navigateur utilisateur`, and preserve the requested production-dormant/provider-neutral pair-B framing. The M1 text also correctly prevents Gemini no-output from becoming a ranked result and specifies out-of-repository credential handling.

## Findings

### F1 — High — PDF attachment/parity contract is not executable enough

The EVOL requires a byte-identical predecessor attachment and explicit page boundaries (D4, lines 47 and 78), but it does not define a verifiable artifact-level procedure for proving that contract. In particular, it does not specify whether the predecessor bytes must be extracted from the final PDF and compared against the source PDF, how the appended page range is identified, or how a PDF library's object renumbering/compression is excluded from the comparison. “Linked from HTML and appended intact” is an intent, not a testable invariant: a generated PDF can contain visually identical pages while differing in bytes, and a manifest can report boundaries without proving them.

Required correction: define the exact final-PDF attachment representation and a deterministic check (source path, source SHA-256, final byte range or embedded attachment/page-object convention, extraction command/tool and expected equality), together with the manifest fields and failure condition. Require the HTML download to resolve to the same byte-identified source and verify all four complete graph pages independently of the predecessor pages.

### F2 — Medium — Cross-surface scene/hash parity lacks a canonical hash input

The EVOL says that `architecture.md`, Focus, and PDF must expose the same ordered scene IDs and source hashes (D4, lines 45 and 79), but it never defines what bytes are hashed or how a source is normalized. Mermaid whitespace, newline style, metadata decoration, node ordering, or a renderer-specific serialization can therefore produce different hashes for the same graph—or allow three surfaces to repeat the same hash while rendering different native SvelteFlow topology. The requirement to preserve native `parentId` is present, but no parity check binds each native scene's node/edge/parentId projection to the corresponding Mermaid source.

Required correction: specify a canonical serialization for each scene (including ordered node IDs, labels, evidence state, parentId, edges, and TEM/user-node assertions), the hash algorithm and ordering, and the exact manifest fields. Define a test that reconstructs the canonical projection from all three surfaces and rejects a missing, reordered, or topology-divergent scene; do not rely only on copied source hashes.

### F3 — Medium — M1 JSON state-machine invariants remain underspecified

The payload example and prose correctly place Gemini’s `no-output` attempt in `candidateAttempts` and exclude it from `candidateResults` (D6.8, lines 281–307 and 316). However, the state machine does not enumerate the legal `attemptState` and `classification` values or their complete cross-field transitions. It also does not state that every result must reference exactly one output-bearing attempt, that an attempt may not occur in both arrays, or that the required provider/model/effort and input/output references are non-null for a classifiable result. As written, an implementation can create a `candidateResults` entry with an invented or detached output while still satisfying the prose “output-bearing attempt” rule, or mark a no-output attempt as rank-eligible unless it independently implements the intended semantics.

Required correction: publish the finite state/classification tables and transition rules. Require a stable attempt ID, one-to-one result linkage, immutable option membership, null quality/latency/rank fields for every non-classifiable attempt, and non-null qualified provider/model/effort, source freeze, output reference, validation evidence, and judge references before `rankEligible: true`. Add invalid JSON fixtures for Gemini no-output promoted to `candidateResults`, detached results, and no-output with quality metrics or rank eligibility.

### F4 — Medium — No-zoom acceptance is measurable but not reproducibly bound to the complete scene

D4.1 gives useful numeric card, typography, slack, and PDF minima (lines 55–66) and D5 asks for Chromium screenshots and transformed-text measurements (lines 83–86). It still leaves the acceptance harness unable to determine what counts as the measured “ordinary service card” and “complete-page” result: there is no selector/scene manifest mapping, no rule for Mermaid SVG text versus SvelteFlow DOM text, no definition of the bounding box after pan/scroll, and no explicit treatment of wrapped labels whose visual glyph bounds differ from their SVG `font-size`. The spec says to report medians and worst cases but does not define the required per-node evidence or the failure aggregation. This makes a no-zoom pass vulnerable to measuring a convenient subset while a complete graph or TEM/dormant banner is clipped.

Required correction: require a per-scene inventory keyed by the four scene IDs, enumerate every ordinary card and required text role, record computed/effective font metrics and bounding boxes at the fixed viewports, and assert visibility/intersection against the complete-scene bounds. Define the PDF extraction/render check per scene and require screenshots plus machine-readable measurements for the worst card, smallest text, TEM annotation, dormant banner, and all edge labels. Supplemental pages must not satisfy a failed complete-view assertion.

## Decision

**CHANGES REQUIRED**

The design has materially corrected the previously identified comparability, secret-hygiene, state-classification, window, and residual-exception concerns. It is not yet sufficiently deterministic for implementation handoff on this lens because the predecessor-PDF byte/parity verification, cross-surface native-scene hashing, M1 transition schema, and no-zoom complete-scene tests can still be interpreted differently by implementers.
