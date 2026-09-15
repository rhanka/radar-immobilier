---
status: completed
reviewer-host: claude
reviewer-model: gpt-5.6-terra
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v3
target-diff-sha256: a6a8ba3ed6ab7fd6aacf24065e32949761b333aacf169f5dbcef775dc24739f2
lens: historical and runtime-state correctness across both dated pairs
---

# Independent review v3 — history and state

## Verdict: CHANGES REQUIRED

## Review evidence

- The prescribed command, executed in the target worktree, produced
  `a6a8ba3ed6ab7fd6aacf24065e32949761b333aacf169f5dbcef775dc24739f2`.
  It therefore reviewed the dispatched target, not a later or unrelated diff.
- The dated-history selection itself is reproducible against `origin/main`:
  its first-parent commit at or before the stated Toronto cutoff is
  `26caa4d95fe09a6cccb665cd88942f1edfb853c8`, authored and committed at
  `2026-08-09T21:56:02-04:00`. The cited commit is an ancestor of
  `origin/main`. The local `main` ref is stale and instead selects August 7;
  implementation must use an explicitly refreshed/pinned main ref rather than
  relying on an unspecified local `main` checkout.
- The cited September runtime receipt exists at
  `9d004b0fc9af3df970df22ed439eb46be5b80b06` and records
  `observedAt: 2026-09-13T23:39:15Z`, OVH graph and scrape bindings, an empty
  `minioResources` array, preserved TEM, and `acceptedForFinalParity: false`.
  The document correctly retains the final metadata/tag and source-rescan gap.
- The predecessor PDF object at historical revision
  `72b966664523801ea00cfcb704e0285ee765c136` hashes to the stated
  `86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528`.

## Finding

### H1 — August runtime use is asserted from declarative evidence

**Severity: High**

D2 calls it a fact that, by August 9, “Immo used its in-cluster MinIO
_declaration_, SCW graph/scrape coordinates and SCW application registry”
(spec lines 21–22). The A-before graph then presents an API-to-MinIO
relationship as a normal solid dependency (lines 100–103), while only the
separate client node is explicitly qualified as “declarations” (line 103).

The pinned August source does establish the declarations: `25-minio.yaml`
declares MinIO and `30-api.yaml` sets `S3_ENDPOINT` to `http://radar-minio:9000`;
`34-refresh-cronjob.yaml` declares suspended scrape and projection CronJobs,
including SCW graph coordinates. It does **not** establish an August 9 runtime
inventory, a successfully resolved secret binding, or a successful application
use of MinIO/SCW. This is also one of the explicit unknowns acknowledged at
spec lines 339–340. Calling those relationships “used” therefore exceeds the
cited evidence and conflicts with D1’s rule that a Git declaration is not
runtime proof.

Correct D2 and the A-before caption/topology qualification so that every
August storage, graph/scrape, and registry relation derived solely from these
manifests is consistently `declared` (or add a dated operational receipt that
supports `observed`). Preserve the genuine August facts separately: the
configuration existed and the CronJobs were declared suspended; neither fact
proves a completed extraction, a resolved live binding, or application traffic.

## Checks with no blocking finding

- Pair A is a dated storage/registry transition; it does not claim a one-node
  cutover and preserves the T2 parity limitation.
- Pair B keeps corpus and publication-graph labels provider-neutral, isolates
  the production writer in a visibly dormant boundary, and labels model choice
  as pending M1 ratification. The preproduction result is an annotation, not a
  production resource.
- All four Mermaid sketches use the exact `Navigateur utilisateur` label and
  include an SCW TEM retained-exception annotation. Pair B does not connect TEM
  to the PV extraction chain. The specification also requires four complete
  nested SvelteFlow scenes with `parentId` and carries those requirements into
  Focus/PDF parity gates.
- The four owner presentation corrections are represented: TEM in every graph,
  exact user label, 120–156 CSS-px ordinary-card range, and explicit Chromium
  100%-zoom/PDF text minima. The 10 August–13 September 2026 inclusive
  interval is correctly specified as 35 days / 840 hours.
- The M1 payload keeps Gemini no-output in `candidateAttempts` as
  `not-classifiable`, excludes it from `candidateResults`, and marks it
  rank-ineligible. The reviewed documents contain neither credentials nor an
  attribution trailer.

The documentation remains a design handoff; none of the future browser, PDF,
attachment, or runtime acceptance gates is represented as already passed.
