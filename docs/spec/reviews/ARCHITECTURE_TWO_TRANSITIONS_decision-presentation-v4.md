---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v4
target-diff-sha256: 18e27bea34ad552c1f00efed40a48b4026bd66ff2139856c63f75af13f6641a2
lens: M1 state machine, report attachment/parity, and complete-scene no-zoom acceptance
---

# Independent review v4 — decision and presentation

## Scope and evidence

I reviewed only the specified EVOL and ARCH2 plan working-tree diff. `git diff HEAD --no-ext-diff -- docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md plan/ARCH2-BRANCH_docs-architecture-two-transitions.md | sha256sum` produced `18e27bea34ad552c1f00efed40a48b4026bd66ff2139856c63f75af13f6641a2`, matching the handed-off checksum.

I retested the owner points and v3 corrections under this lens. The diff now provides a finite attempt/classification table; prevents Gemini `no-output` from being a result or receiving quality/valid-output latency/rank metrics; makes Sonnet a matched, out-of-repository-secret candidate; gives an exact report interval; requires `pdfdetach` extraction and source-byte hashing for the predecessor attachment; defines canonical scene projections including `parentId` and exact edges; and inventories all scene/card/text/edge measurements at 100% zoom. It also calls for four Mermaid and four native scenes, exact `Navigateur utilisateur`, TEM retention, and card/type/PDF minima. The issues below nevertheless leave two core implementation checks non-reproducible.

## Findings

### HIGH — The M1 result relation is not actually one-to-one

D6.8 says `candidateResults` “contains only references to output-bearing `completed-invalid` or `completed-valid` attempts” and that each result references one existing attempt and output. Those are one-way constraints. It does **not** require every output-bearing attempt to have exactly one result, nor prohibit two result records from pointing to the same `attemptId`/output. The supplied illustrative JSON cannot establish the omitted inverse constraints because it has only one output-bearing attempt/result pair.

Consequently, an implementation can retain a valid-output or invalid-output attempt in `candidateAttempts` without a result, or create multiple candidate results for it, while satisfying the stated wording. That defeats the requested one-to-one result linkage and makes aggregate/ranking inputs ambiguous. The document also says records retain requested/effective provider/model/effort, usage, and missing-data reasons, but does not give a normative JSON shape or explicit location for them; a validator cannot reliably apply the stated `rankEligible` prerequisites to the copied payload.

**Required correction:** define a normative versioned JSON Schema (or equivalently precise field contract) and invariants: every `completed-invalid`/`completed-valid` attempt has exactly one `candidateResults` reference; every result has exactly one distinct such attempt and exactly that attempt's output reference; no two results share an attempt or output reference. Specify where requested/effective qualified identity, freeze hash, usage/missing reason, and judge references reside, and make the invalid fixtures exercise both missing-result and duplicate-result/output cases.

### HIGH — The predecessor visual appendix has no reproducible content-parity check

D5 correctly requires extracting embedded `study-2026-08-report.pdf` with `pdfdetach` and comparing its SHA-256, and records the predecessor page range. That proves the attachment bytes, not that the nine visual-appendix pages in the final PDF are pages of those bytes. A generated PDF can embed the exact source attachment, reserve nine pages in `previousReport`, and append unrelated/recreated pages; it passes the listed path/hash/page-count/range checks. The prose statement that the final PDF “then” contains the predecessor's nine pages is not an executable equivalence criterion.

**Required correction:** require a deterministic source-to-appended-page parity test in addition to `pdfdetach`: identify the nine appended pages by the recorded range, render source and appended pages with a pinned renderer/settings (or otherwise compare normalized page content with a documented tolerance), and fail on count/order/content mismatch. Record the renderer/version, source and appendix per-page hashes (or image hashes plus tolerance), and the page mapping in `previousReport`. This is necessary to prove both demanded properties independently: exact attached bytes and an intact visual appendix.

## Verdict

**CHANGES REQUIRED.** The plan is substantially stronger on finite states, secret hygiene, no-output treatment, attachment bytes, canonical topology, and exhaustive no-zoom measurement, but it is not yet sufficient to begin implementation because M1 result cardinality and predecessor-appendix content parity remain under-specified.
