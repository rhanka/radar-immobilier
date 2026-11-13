# Frozen protocol — C sets, PR #1099, Astra low

Owner request: 2026-11-13. No prompt optimization or feedback to an optimizer.

Owner continuation, 13 November: retain detection B and measure classification
only (study mode B). Do not rerun mode A. Run v1 blind, then published v2 tuning
and blind with separate caches. V2 is frozen at
`34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50`,
commit `6c7cc36c0165253c11e89f41edfe67108dbbd0f9` in refresh-v2.
The original tuning v1 observation remains unchanged. D4 and scoring stay frozen.
The owner authorizes make to load the root environment file, without displaying
the key or sending it to a model. Public publication covers code and aggregates
only. Blind per-unit artifacts remain encrypted in the private directory.

The C study's series 7 uses the reference named D by its implementation.
There are 252 tuning units and 252 blind units. Units include existing signals
and whole captured PVs. Preserve this inventory; do not call every PV an act.
Reference provenance is model consensus/mixed, not a fresh human annotation.

The unchanged classification/extraction prompt has SHA-256
`8957bcaa146b3b83ee89000fccec3c6f393c7b801b320a158d58d2631fa3a205`.
Capture the full detection composition and schema by importing
`extractRefreshProfile` from the PR #1099 worktree, with the same unregistered
profile context used by `api/src/scripts/refresh-pv.ts`.
No production graph validator retries and no model fallback are allowed.

Mode A sends source excerpts for existing signals and the captured text for PV
units. Existing signal metadata and reference labels are excluded from extraction
input. Each frozen unit is a separate source chunk; page 1 is an explicit synthetic
wrapper when physical pages are unavailable. This measures frozen-excerpt recall,
not recall on complete source PDFs for the signal subset.
For a signal, match at most one extracted act with the bench-v11 one-to-one
pairing helper: same stage where available and a shared normalized verbatim
citation site on the same wrapper page. Ambiguous unmatched acts are not rescued
by a model or by reference classes. Whole PV units are document-level controls:
their detection indicator is whether any act was returned; the document class is
P if any act is P, else S if any act is S, else unclassified if any act is
unclassified, else excluded. No act means absent, even for an S reference PV.

Mode B sends each unchanged C input in the prompt's explicitly supported
existing-signal reannotation mode. A whole-PV C unit remains a document unit.
The single-pass prompt bytes are unchanged. One annotation is requested.

Classes: P, S, excluded, unclassified. Absent/invalid responses count as
unclassified in the four-class matrix, with absent/invalid counts also reported.
Shown is P union S. Unlike C's historical failure-as-shown convention, missing,
invalid or unclassified predictions are misses when the reference is shown,
as explicitly required by this owner request. D4 passes only at zero misses.
Precision is shown true positives / all shown predictions on C reference units;
unmatched additional extractions are reported separately, because C is not an
exhaustive act inventory of each supplied PV. No global detection precision is
claimed from this incomplete inventory.
Report 95% two-sided Wilson intervals (z=1.959963984540054); do not relabel C's
historical exact one-sided Clopper–Pearson bounds as Wilson bounds.

Surface: Codex ChatGPT seat, gpt-6-astra, low, no web, no MCP or shell tools,
empty working directory, scrubbed environment, independent lane seat home.
Maximum concurrency 10. Stop launching calls at observed weekly use >=90% or
at a provider account/quota refusal. Already running calls are drained.
Capture a quota observation before launch. Persist every attempt privately.
Only identical input/prompt/schema hashes may reuse cached successful responses.
No prediction-conditioned rerun. Report infrastructure failures explicitly.

Blind reference opening requires the existing sealed-set executor and injected
key. Seal per-unit results; publish only aggregate metrics, counts and hashes.
Tuning misses may be listed individually. Never print blind identifiers or text.
