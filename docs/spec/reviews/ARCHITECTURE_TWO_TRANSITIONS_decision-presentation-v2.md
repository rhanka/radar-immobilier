---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v2
target-diff-sha256: 9878521a22f294592aa573b116cf5decb79e043185bbc46b28553fa010ea9a45
lens: M1 decision integrity, comparability, evidence classification, and presentation acceptance
---

# Independent review v2 — decision and presentation

## Review basis

I independently reviewed only the two nominated working-tree files. The required
frozen-diff command returned
`9878521a22f294592aa573b116cf5decb79e043185bbc46b28553fa010ea9a45`, matching
the declared target hash. `git diff --check` reported no whitespace errors.

## Owner-correction retest

The four requested corrections are substantively addressed:

1. **Comparable Sonnet and credential hygiene — pass.** D6.4 changes the option
   to `sonnet-comparable` and requires the same frozen Graphify request, source
   bytes, prompt, schema, retry policy, and 16,384-token cap. It expressly
   excludes historical Sonnet output from filling the comparable row. The next
   paragraph makes credentials owner-controlled and out of repository, read-only
   for the isolated call, and prohibits them in arguments, logs, receipts, diffs,
   commits, and the PDF. A contaminated artifact invalidates the run.
2. **Gemini no-output classification — pass.** D6.2/S13 say that the direct
   diagnostic has no full output and does not qualify the operational gateway.
   D6.6 further defines no-output as transport/execution evidence only: it has
   no quality, latency-to-valid-output, or semantic score and is excluded from a
   ranking denominator. This is correctly non-classifiable rather than a bad or
   zero result.
3. **Provider-neutral pair B — pass.** Both B-before and B-after now use
   functional corpus/graph labels, while D3 and both B captions allocate physical
   SCW-to-OVH placement to pair A. This preserves logical refresh identity across
   a storage-provider transition.
4. **History/source anchoring — pass.** D1 distinguishes Git ordering from
   runtime observation, bounds side-branch evidence, and requires pinned revision
   and blob paths. The source-register preamble repeats that a commit date is not
   runtime proof and that side branches are not main history.

The amended M1 semantics are otherwise coherent: three visible rows remain even
when a candidate cannot run; unsupported effort/enrollment becomes `not
qualified`; Luna-high is not evidence for Luna-low; independent judging and an
explicit owner choice are required for ratification. D6.8's JSON/export contract
also preserves a null selection for the illustrative awaiting-benchmark state,
requires option membership and evidence references for ratification, and avoids
misrepresenting a browser export as a signed decision.

Presentation acceptance is unusually specific and executable in the later
implementation scope: exactly four Mermaid graphs and four nested SvelteFlow
scenes; TEM in every scene/PDF but outside pair-B extraction; the exact
`Navigateur utilisateur` label; dormant B-after writer/model-pending status;
normal-zoom Chromium checks at two resolutions; transformed-text and card/slack
measurements; and PDF minimum text sizes plus four complete-page screenshots.

## Findings

### P1 — HIGH — The required dated report-window and prior-PDF attachment contracts are absent

The requested report-parity acceptance includes the **10 Aug–13 Sep window** and
attachment of the **previous PDF**. Neither nominated file states either
requirement. The closest language is D4's generic “dated report”, D5's generic
instruction to compare an unspecified protected billing “period”, and the plan's
instruction to preserve unspecified billing/window. Those phrases cannot be
executed or audited as the requested exact window, and none requires retaining or
attaching the previous PDF.

This is material because the stated purpose is a dated report correction while
preserving protected report content. An implementer can satisfy every current
visual check while changing the displayed reporting interval or dropping the
prior PDF attachment, with no acceptance failure.

**Required correction:** name the immutable displayed/report window exactly as
`10 Aug–13 Sep` (including the year/locale convention if required), identify the
previous PDF by immutable filename/hash or attachment reference, and add explicit
HTML/PDF/report acceptance checks that retain that attachment and reject any
window or attachment mismatch. Keep this separate from the unchanged billing
method/amounts.

## Verdict

**CHANGES REQUIRED**

The M1, evidence, provider-neutrality, state, and no-zoom presentation corrections
pass this review. P1 leaves a required report-parity contract untestable, so this
EVOL is not ready for implementation release or review reconciliation.
