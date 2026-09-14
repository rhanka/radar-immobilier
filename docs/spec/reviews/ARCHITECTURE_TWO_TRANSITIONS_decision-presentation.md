---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan
target-diff-sha256: 824a2ae94d88caa54d589ccabb61d7273c8f509f6d4c3707ad0b1022d348b78b
lens: M1 decision integrity, comparability, evidence classification, and presentation acceptance
---

# Independent review — decision and presentation

## Scope and method

Reviewed only the handed-off working-tree changes to the EVOL and branch plan.
The frozen target diff was independently verified before review:

```text
824a2ae94d88caa54d589ccabb61d7273c8f509f6d4c3707ad0b1022d348b78b
```

I also inspected the four Mermaid contracts, D4/D4.1/D5 acceptance language,
M1 decision/capture contract, and the source/register wording. No sibling review
or consensus artifact was read.

## Findings

### HIGH — The protected report window and reference-architecture update contract are not executable

The stated scope requires the **unchanged 10 Aug–13 Sep cost window** and a
reference-architecture update contract to be verified. The submitted design does
not identify that window anywhere. It instead says only that the “report period,
cost method and amounts remain unchanged” (EVOL:7), and D5 asks an implementer to
compare an unspecified “protected billing content and period” to an unspecified
“input report” (EVOL:74). The plan similarly promises no “cost/window change”
(plan:8) without naming the protected values or authoritative report artifact.

This is not a check an implementer can execute: a report regenerated for a
nearby, different period can satisfy the written assertions if its values and
method happen to be retained. The cited S1 report name (`report-through-2026-09-13`)
is a navigation source, not a frozen statement that the billing window begins on
10 August, nor does it identify the exact cost-report/attachment to compare.

Likewise, no requirement says which reference architecture is to be updated,
what four-scene inventory/captions/source hashes it must contain, or how it is
kept in parity with Focus and the dated HTML/PDF report. D4 requires artifacts to
record revisions/hashes and HTML/PDF to share inventory/captions (EVOL:43–44),
but it does not make the reference architecture a required output or define its
parity test. Merely listing `docs/architecture.md` in S1/S10 cannot supply that
contract.

**Required correction:** name the exact authoritative input report and prior PDF
attachment, freeze the literal inclusive `2026-08-10`–`2026-09-13` window plus
protected method/amount fields (or their hashes), and require byte/structured
comparison appropriate to each field. Name the reference-architecture artifact
and require it, Focus, HTML, and PDF to expose the same four scene IDs, dates,
captions, source revision/content hashes, and decision status. Add acceptance
commands/assertions that fail on a missing prior attachment, a changed window, or
an inventory/caption/hash mismatch.

### MEDIUM — M1’s JSON contract does not encode the no-output classification needed to enforce its own ranking rule

The prose correctly repairs the semantic rule: a request with no candidate output
is transport/execution evidence, has no quality/latency-to-valid-output/semantic
score, and must not enter a ranking denominator (EVOL:244). S13 and the initial
state also correctly say Gemini has no full/classifiable output (EVOL:220,
250–252). However, the only supplied JSON is an empty illustrative payload and
then a prose list of fields for `candidateResults` (EVOL:267–283). It provides no
enumerated attempt/result states, no mandatory classification field, and no
machine-checkable aggregate eligibility rule.

Consequently an implementation can serialize Gemini as a normal candidate result
with `null` metrics and still meet the listed fields, making the required
exclusion dependent on undocumented presentation logic. That defeats the stated
owner-facing decision semantics and prevents a regression test from proving that
no-output is non-classifiable rather than a zero result.

**Required correction:** define a versioned `candidateResults` schema/contract
with separate attempt and candidate-result classifications (including a
`no-output` transport/execution attempt and `not-classifiable` candidate status),
required missing-data reason, nullable output/quality fields, and an explicit
`eligibleForRanking: false` invariant for no-output. Require clipboard/JSON and
HTML/PDF parity tests that reject a score, latency-to-valid-output, denominator
membership, or ranking for that state.

## Verified corrections and gates

The four requested owner-review corrections are substantively addressed:

- **Comparable Sonnet and credential hygiene — pass.** `sonnet-comparable` is
  constrained to the same frozen Graphify request, bytes, prompt, schema, retry
  policy and 16,384-token cap (EVOL:230,234); historical work is context only.
  Credentials are explicitly owner-controlled and out of repository, read-only
  for the isolated call, and forbidden from arguments, streams, receipts, diffs,
  commits, and PDF (EVOL:236).
- **Gemini no-output is not a result — pass in prose, but see the JSON finding.**
  It is bounded branch evidence and excluded from scores/ranking aggregates
  (EVOL:220,244,252), not portrayed as a benchmark outcome.
- **Pair B provider neutrality — pass.** Both B-before and B-after use functional
  corpus/graph labels, while D3 and annotations assign physical SCW-to-OVH
  placement exclusively to pair A (EVOL:34,159,173,180,200,208).
- **History/source anchoring — pass.** The amendment distinguishes documentary
  Git reconstruction from runtime observation, pins revisions/blobs, and limits
  side-branch evidence (EVOL:13–17,287,303).

Presentation and state gates are also well specified:

- exactly four Mermaid graphs and four complete native nested SvelteFlow scenes,
  with containment, `parentId`, edges, icons and `repo:` labels (EVOL:37–45);
- visible retained SCW TEM in all four, outside Pair-B extraction and with Pair-A
  email relation; exact `Navigateur utilisateur` in both forms and PDF
  (EVOL:49,76–77,91,115,122,144,169–170,204–205);
- B-after remains visibly dormant and model-pending, while preproduction is a
  separate annotation rather than a production resource (EVOL:32–34,73,175–208);
- normal-zoom, transform-aware 1440×1000 and 1920×1080 Chromium checks, card
  size/blank-space measurements, and readable complete PDF views with explicit
  minimum type sizes (EVOL:55–64,78–81). These avoid a hidden manual-zoom or
  fit-to-view escape hatch.

Those strengths do not cure the two findings because both leave report parity and
M1 result classification non-deterministic for the implementation and owner
record.

## Verdict

**CHANGES REQUIRED**

Resolve the exact cost-window/prior-PDF/reference-architecture parity contract
and make no-output/non-classifiable semantics enforceable in the captured JSON
before implementation is released.
