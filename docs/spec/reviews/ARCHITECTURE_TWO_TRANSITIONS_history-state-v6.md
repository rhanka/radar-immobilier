---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v6
target-diff-sha256: a8d5eed60258d38a9641052fc8a148824fe3fbf5f70a331c6479fcc906988b46
lens: historical state, explicit edge semantics, and dated pair correctness
---

# Independent review v6 — history and state

## Verdict: GO

I reviewed only `docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md` and
`plan/ARCH2-BRANCH_docs-architecture-two-transitions.md`, excluding sibling v6
reviews and consensus material. The SHA-256 of the exact `git diff HEAD --` for
those two paths is
`a8d5eed60258d38a9641052fc8a148824fe3fbf5f70a331c6479fcc906988b46`, matching
the assigned target.

The former historical/state release blockers are closed in the proposed design:

- D1 now distinguishes the August first-parent documentary reconstruction from
  runtime observation, pins both repository anchors, keeps later side-branch
  material branch-scoped, and identifies the separate September 13 runtime
  receipt (`9d004b0f`, observed at `23:39:15Z`). It therefore does not turn Git
  chronology into an operational claim.
- A-before visibly labels every displayed dependency as declared. The only
  observed August fact, `A_CAPACITY`, is a relation-free capacity note rather
  than an inferred application runtime relation. The surrounding text expressly
  limits the two-node statement and the manifest-derived bindings to their
  evidence scope.
- The closed evidence and runtime vocabularies are specified in D4, are required
  for every node/group and edge without a fallback, and both fields occur in the
  fixed-order canonical projection that is independently reconstructed and
  hashed. This makes a status-only topology change detectable in the Focus,
  native-DOM, and report checks.
- The dated A-after claim remains appropriately narrow: observed API rollout,
  OVH GRAPH/SCRAPE bindings, and MinIO absence are tied to S5, while parity,
  source freshness, resource retirement, and an Immo imageID receipt remain
  explicitly open. The retained SCW TEM relation is shown rather than erased.
- Pair B preserves the August suspended/manual distinction. B-after confines the
  new production writer to a prominently dormant boundary and expresses the
  preproduction receipt as an annotation, not as a production resource or
  activation claim. TEM remains outside the PV extraction chain in both B
  scenes.
- The metadata contract gives deterministic case-sensitive node IDs, real
  cluster `parentId` values, explicit provenance, normalized labels, and stable
  edge IDs; its rejection rules prevent an undeclared node, edge, duplicate, or
  metadata fallback from acquiring a plausible state by inference.

The M1 and rendering/report provisions were also checked insofar as they protect
historical interpretation: three exact canonical option rows are retained, retry
history is isolated in a hashed ledger, no-output Gemini cannot become a result,
and ratification requires equality with the full option set. The report contract
pins the exact Toronto interval and predecessor-PDF bytes, attachment extraction
hash, and ordered Poppler page-image parity. These prevent a future report
surface from silently substituting a different historical artifact.

This is a design review, not evidence that implementation gates have run. Their
future execution remains correctly pending in the ARCH2 plan. I found no
remaining historical/state contradiction that requires design changes before
bounded implementation begins.

**Implementation may start.**
