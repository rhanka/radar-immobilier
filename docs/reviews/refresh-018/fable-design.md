---
status: completed
review-author:
  host: codex
  model: gpt-6-astra
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: high
target-ref: ca7d9acf8a9f212ad02bdf97fd39451665f1ca07
lens: executable public API contract, minimal continuation, correctness and recovery
verdict: GO_WITH_CHANGES
reviewed-at: 2026-09-13
---

# Fable design review — owner-authorized Gemini replacement

The owner explicitly retained the review and authorized Fable 5 as the fallback
reviewer on September 13. This is one independent review, not two-peer consensus.
The rejected Gemini launch remains recorded separately and is not a verdict.

Review the exact committed design and build handoff. Challenge unsupported public
APIs, unnecessary reinvention of i-cond work, baseline preservation, typed Signal
and original-PDF grounding, concurrency and resumable publication/projection.
Return evidence-backed blocking findings and the smallest executable first slice.
Do not modify application files, credentials, deployment state or the target design.

## Review evidence

The unchanged source-verification detail is in [the evidence appendix](fable-design-evidence.md).
The conductor split this completed report for atomic commits; findings and verdict are unchanged.

## Findings

### F1 — HIGH (build-blocking for C06 as written): `runConfiguredDataprep` is not public in 0.18.0

Spec decision 3 opens with `runConfiguredDataprep(root, {configPath, stateDir})`
as "the actual preparation + public profile/client composition", while the same
decision (correctly) forbids private/CLI imports. The function is exported only
from `src/configured-dataprep.ts:308`; it appears in neither `dist/index.d.ts`
nor `dist/index.js` nor `dist/index.cjs` (zero occurrences), and `src/index.ts`
has no re-export. A consumer of the published package cannot call it without a
forbidden private-path import. As specified, C06 cannot be typechecked.

**Smallest fix (build-time, no producer wait needed for the first slice):** C06
composes the same preparation from the functions `runConfiguredDataprep` itself
calls, all of which ARE public: `discoverProjectConfig`/`loadProjectConfig`,
`loadOntologyProfile`, `loadProfileRegistries`, `registryRecordsToExtraction`,
and `prepareSemanticDetection` (for PDF page artifacts). The non-public pieces
it skips (`buildConfiguredDetectionInputs`, `applyConfiguredExcludes`, detection
merging) are config-driven input discovery — unnecessary for the first slice,
whose inputs are explicitly materialized from checked S3 objects into the
ephemeral run directory. `buildProfileChunkPrompt` needs only
`{profile, projectConfig, registries}`, which this composition yields. In
parallel, the conductor may escalate a producer 0.18.x export of
`runConfiguredDataprep` as a contract gap; that escalation must not block C06.

### F2 — MEDIUM: "Lock Graphify's mesh resolution to the same 0.19.0 contract" has no npm mechanism; three mesh copies will coexist and must be interop-probed at runtime

After C01 the installed tree necessarily contains three `@sentropic/llm-mesh`
copies: root `0.1.2` (chat), the alias folder `@sentropic/llm-mesh-refresh`
(0.19.0), and a copy nested under `@sentropic/graphify` (its own `^0.19.0`
dependency — root 0.1.2 prevents hoisting, and `dist/llm-mesh.js` imports
`@sentropic/llm-mesh` at runtime, resolving the nested copy). No `overrides`
configuration can make the alias and the nested copy a single module instance.
Consumer-built objects (adapters, planner, routingSubject) will therefore cross
an instance boundary into graphify's mesh. Mitigating evidence: every crossing
contract I inspected is a structural interface, and abort/failure classification
is shape-based, not `instanceof` (verified above) — so this is expected to work,
but the spec's "lock … resolution" wording implies a guarantee npm cannot give,
and acceptance level 1 currently checks only declaration/type compatibility.

**Smallest fix:** reword decision 2 from "lock resolution" to "verify
cross-instance interop", and extend the C03 transport-mock test plus the
acceptance-1 installed-image smoke with one runtime probe that drives an
alias-built adapter and planner through `createGraphifyMesh` →
`generateValidated`, covering the abort path and one classified route failure.
No dependency-graph change.

### F3 — MEDIUM: the schema-forwarding fix must be proven present in the published npm artifact before any provider call

Prompt-side schema forwarding exists only since producer commit `1710c9f2`
("fix: forward schema in mesh JSON prompt"), which is an ancestor of the cited
release merge `1a723695` (PR #330) — the worktree is consistent. But the design
pins the **published** `0.18.0`, and this checkout has not verified that the npm
publish happened at/after that fix (the "chore(release): 0.18.0" commits exist
separately). If the published dist predates it, the `schema` string never
reaches the model: every typed-field extraction fails validation silently and
burns real provider budget at acceptance level 3 with no code error.

**Smallest fix:** add to the C01 gate (before any provider call, in the clean
Docker install): assert the installed
`node_modules/@sentropic/graphify/dist/llm-mesh.js` contains the
`Schema: ${input.schema}` user-message forwarding (a grep-level check), failing
the install gate loudly if absent and escalating a producer republish.

### F4 — LOW: make abort semantics of the projection callback explicit in C12

`upsertGraphAtomic` accepts no AbortSignal and by design does **not** throw on
its internal completeness-regression abort — it returns `{aborted: true,
reason}` so sibling cities continue. C12's "explicit selected-city failure
propagation" and decision 5's "including abort checks" are satisfiable only if
the `applyGraphify34Snapshots` project-callback wrapper (a) checks the run's
AbortSignal before and after the upsert and (b) maps `{aborted: true}` to a
selected-city failure (nonzero exit per decision 6). One sentence in C12's
deliverable making both explicit prevents a silent exit-zero on a refused city.
No edit to `graph-store.ts` (read-only reuse holds).

### F5 — INFO: activation gates are correctly separated from build; none blocks coding

Provider/account enrollment, durable keyring PVC storage-class/flock approval,
egress, resource qualification and the OVH overlay preservation are assigned to
conductor/poc-k8s and gate only C16–C20 rendering acceptance and acceptance
levels 3–4. Nothing in them blocks writing or testing C01–C14. The handoff's
statements that RWO alone is insufficient for the cross-pod lock and that
`Forbid` does not fence manual Jobs are correct and correctly gated. The
149-line/`ENV=test-refresh-018` test discipline, PR678 read-only reuse, and the
no-reimplementation stance (single publisher, no second acquire/release loop,
no prompt fork) are consistent with the sources and with `rules/MASTER.md`.

## Minimal first executable slice (decisive)

The handoff's own slice is right-sized; adopt it with the corrections above:
**C01–C14 in the listed order**, amended as follows —

- **C01**: as released, plus the F3 installed-artifact schema-forwarding probe
  and the lock-delta measurement already required.
- **C02/C03**: as released, plus the F2 cross-instance runtime probe in C03.
- **C06**: replace the `runConfiguredDataprep` call with the public
  re-composition of F1 (same behavior, same paths, no new files).
- **C12**: state the F4 abort/`{aborted:true}` mapping explicitly.
- C04, C05, C07–C11, C13, C14: release as proposed.

C15–C20 are activation preparation (render-only) and may proceed after the
slice typechecks; C21–C25 remain cutover work strictly after acceptance level 3
evidence. Provider enrollment and PVC approval are activation gates only and
must not delay C01–C14.

## Verdict

**GO_WITH_CHANGES.** The design is a faithful, evidence-backed continuation of
the existing work — every reuse claim I checked against real source held, and
the recovery/publication/ordering reasoning is sound. The required changes are
bounded and exact: F1 (C06 public re-composition), F2 (interop probe + wording),
F3 (published-artifact probe at C01), F4 (one explicit sentence in C12). No
finding requires a redesign, a new file, or a scope change beyond the released
paths. Single-reviewer verdict by owner exception; not a two-peer consensus.
