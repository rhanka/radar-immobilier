---
status: completed
review-author:
  host: codex
  model: gpt-5.6-sol
  effort: xhigh
reviewer-host: claude
reviewer-model: claude-fable-5
reviewer-effort: high
target-ref: 671380f473d98e76be3b53831b286564a4fdd0c5
lens: migration safety and executable first-slice correctness
---


# Independent T2 cutover design review (continued)

This is the unchanged second half of [the independent review](fable-cutover-review.md),
split only to preserve the repository's atomic commit limit. Same reviewer,
method and immutable target; no additional review leg is claimed.

### Verdict B — MinIO→OVH S3 cutover design at `671380f4`

**PASS with three required amendments (B1–B3) before the tool lot is built,
plus one scope clarification (B4).** The overall shape is sound: dry-run
default, no delete operation in the tool, destination identity without delete
permission, streamed SHA-256 with multipart-ETag explicitly demoted to
diagnostic, unclassified keys surfaced as `missingProof[]`, fence evidence
recorded without a false validation claim, paired DB/object recovery and
zero-consumer deletion gates, unknown bucket names failing closed, GRAPH
preprod / TEM / Geo / MatchID excluded, migration credentials as distinct env
inputs. The plan amendment (SCWF-EX2, lots 3h1–3h5) matches the design. The
frozen client matrix agrees with what I independently verified in source
(refresh scrape writes DOCS prefixes into the OVH GRAPH bucket —
`refresh-cronjobs/kustomization.yaml:168-180`; diag writes MinIO
`radar-immobilier-docs-preprod` — `refresh-diag/diag-refresh-job.yaml:81-84`;
API-effective DOCS bucket unproved, code default `radar-immobilier-docs` at
`config.ts:240`). "No application resolver edit is needed" is confirmed
against `config.ts` (per-field `??` chain, subject to B5).

- **B1 — post-fence conflict convergence is unspecified; the delta can
  deadlock.** Rules as written (`minio-cutover-design.md:63-65,78-81`):
  destination mismatches are conflicts and are "never overwritten", the tool
  has no delete, and `delta` exits zero only on full identity. Mutable keys —
  `state/`, `jobs/`, run artifacts — will legitimately change between the bulk
  copy and the post-fence delta; their stale destination copies then become
  permanent conflicts the tool refuses to fix, so `cutoverReady` can never be
  reached through the tool. The practical failure mode is the dangerous one:
  an operator "fixing" conflicts with raw S3 commands outside the audited
  path. Smallest fix: specify one fence-gated reconciliation rule — with a
  valid `--fence-record`, a conflicting key whose destination matches a hash
  previously recorded in this migration's own manifests may be re-copied from
  the fenced source, each overwrite named in `summary.json`. Overwrites of
  destination content the tool did not itself write remain forbidden.
- **B2 — multi-source DOCS collision policy is missing.** The conductor
  section copies "each physical DOCS source" into one destination bucket, and
  at least two proven sources exist (MinIO `radar-immobilier-docs-preprod`
  via diag; DOCS prefixes inside the OVH GRAPH bucket via scheduled refresh)
  plus the unproved API-effective bucket. Overlapping keys with different
  bytes (both write `raw/`…) become unresolvable conflicts under B1's rule,
  with no precedence defined. Smallest fix: require the inventory step to
  prove key-set disjointness across DOCS sources, and where overlap exists,
  freeze a deterministic per-key rule (e.g. newest `LastModified` wins,
  recorded per key in the report) before any copy.
- **B3 — the GRAPH-bucket DOCS extraction cannot pass its own gate.** Keys
  outside classified prefixes are `missingProof[]` and any `missingProof`
  forces non-zero (`minio-cutover-design.md:67-69,83-86`). Running the tool
  against the GRAPH bucket to extract `raw/`, `runs/`, `parsed/`, `ontology/`,
  `state/` necessarily leaves `graph/` and `graphify-34-backups/` unclassified
  → permanent `missingProof` → never `cutoverReady`. Smallest fix: add an
  `--exclude-prefix` option (classified-but-not-copied; recorded in
  `summary.json`) so the intended exclusion is declared instead of defeating
  the unclassified-key guard.
- **B4 — lot 5's checker extension must name its file set.** "Reject
  MinIO/SCW object literals" over the current nine files leaves
  `32b-reproject-etape-job.yaml`, base `34-refresh-cronjob.yaml`, and
  `refresh-cronjobs-prod/**` uncovered, while the audit's own remediation map
  (`scw-final-sweep.md:161,164`) requires retiring/neutralizing them. State
  in lot 5 the widened coverage (all `deploy/k8s/**` manifests and overlays,
  minus the explicitly retained diag/grounding paths until their gates), and
  either add 32b retirement / 34-base neutralization to a lot or record their
  deferral explicitly.
- **B5 — minor.** "Complete families bypass fallback" holds only for
  non-empty values: `"" ?? x` yields `""` (`config.ts:258-264`), and empty
  url-typed values crash config parsing while empty region/bucket bind
  silently. The conductor binding record should require a proven non-empty
  value per key, not just key presence.

### Blockers vs gates summary

- Build blockers: none in either target.
- Pre-build gate: amend the design per B1–B3 (tool contract) and B4 (lot 5
  scope) before lot 3h3.
- Runtime/cutover gates (conductor-owned, correctly identified by the design):
  preprod ConfigMap/Secret provisioning with non-empty validated values (B5),
  `REFRESH_DIAG_ENABLED` disarm-or-prove fence (armed at
  `build-push-images.yml:985`), T1 gating of grounding retirement only,
  preprod acceptance before any production action, and the A1 CI wiring so
  the binding contract is actually enforced from the second slice onward.
