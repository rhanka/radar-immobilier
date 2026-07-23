# Graphify 3.4 Addendum — Legacy Filter A Is a Release Gate

**Status:** blocking. This addendum amends
[`SPEC_EVOL_FILTRAGE_VIVIER_v2.md`](../../spec/SPEC_EVOL_FILTRAGE_VIVIER_v2.md).
It applies only to the existing legacy Filter A (`z|m|p`).

## Non-negotiable invariant

Graphify 3.4 **does not change** the legacy Filter A contract or semantics:
its members (stable business keys and exposed IDs), counters, deterministic
order, and URL states remain exactly as they are at the pre-3.4 HEAD. This
includes the canonical legacy `z|m|p` state and the existing default and
invalid-state URL behaviour. A change in any of these observables is **NO-GO**;
it cannot be explained away by a new Graphify classification, a projection
change, or a UI interpretation.

## Required evidence before cutover

1. **Redo the HEAD inventory.** From the actual pre-3.4 HEAD, create a frozen
   Filter A manifest for every supported legacy URL state. For each state,
   record the request/response contract, ordered member business keys and IDs,
   counters, and order keys/tie-breaks. This is the baseline; a count alone is
   insufficient.
2. **Create golden fixtures.** Pin representative complete inputs and their
   expected Filter A manifests to that HEAD. Fixtures must exercise membership,
   count, ordering, and URL-state restoration; they are regression inputs, not
   examples to update after a run.
3. **Issue before/after receipts.** A receipt identifies the HEAD/Graphify
   input, run mode, projection version, fixture/manifest hashes, and the exact
   comparison result. It must show the baseline and candidate Filter A outputs
   side by side and fail on the first divergence.
4. **Prove both modes independently.** The incremental path uses a complete
   snapshot, never a partial delta. The full path starts from raw inputs. Each
   must match the HEAD Filter A manifest, and the two candidate outputs must
   match each other.
5. **Keep layers separate.** Graphify output, data projection, and UI
   presentation each receive their own receipt. The projection preserves the
   legacy contract, and the UI receipt verifies that the unfiltered legacy
   presentation consumes it unchanged. Graphify output and data projection may
   not recompute, coerce, hide, reorder, or compensate for Filter A data.
   User-controlled presentation lenses applied after the validated projection
   are outside this invariant. In particular, the design-system temporal lens
   is permitted in both A and B: it may narrow displayed nodes, display counts,
   and map layers, but must not mutate the server-authoritative Filter A
   projection, its counters or ordering, or its URL states.

## Cutover and rollback

Run 3.4 into a shadow projection. Cut over atomically only after all required
receipts are green. The cutover decision records the approved receipt set and
the exact legacy baseline. On any divergence, do not cut over; if a divergence
is found after cutover, atomically restore the frozen legacy projection and
retain the failed receipts for diagnosis. No mixed or partially projected state
is acceptable.

## Current gaps to close

- The current 3.4 plan notes shadow projection and atomic cutover, but does
  not define a complete, repeatable Filter A HEAD inventory, golden fixture
  set, or receipt format.
- The v2.3 protected-33 manifest is valuable but is not the required complete
  Filter A baseline: it does not establish all legacy URL states, ordered
  membership, counters, and UI observables for 3.4.
- The plan requires incremental/full convergence, yet it does not explicitly
  gate each mode against the legacy Filter A contract through projection and UI.
- The full raw-to-current path and re-derivation of all enriched fields are
  documented as unfinished; until they exist, a full-mode acceptance receipt
  cannot be produced.
- The 3.x pass name versus `ontology_version` 2.x numbering remains unresolved;
  every receipt must declare both until that mapping is decided.

**Release rule:** without the recreated HEAD inventory, golden fixtures, and
green full, incremental, projection, and UI receipts, Graphify 3.4 is **NO-GO**.
