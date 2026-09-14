---
status: reviewed
reviewer-host: claude
reviewer-model: claude-opus-4-6
reviewer-effort: xhigh
target-ref: working-tree@0c381350-spec-and-plan-v4
target-diff-sha256: 18e27bea34ad552c1f00efed40a48b4026bd66ff2139856c63f75af13f6641a2
lens: historical and runtime-state correctness across both dated pairs
---

# Independent review v4 — history and state

## Verdict: GO

The v3 blocking finding (H1: August manifest relationships presented with solid edges despite only declarative evidence) has been fully corrected. All five v3 correction areas are addressed: uniform dashed edges for declared-only August relations, extractable PDF attachment proof, canonical topology parity, closed M1 attempt state machine, and exhaustive per-scene no-zoom metrics. The design is sufficient to begin implementation.

## Review evidence

- The prescribed command `git diff HEAD --no-ext-diff` on exactly
  `docs/spec/SPEC_EVOL_ARCHITECTURE_TWO_TRANSITIONS.md` and
  `plan/ARCH2-BRANCH_docs-architecture-two-transitions.md`, executed in the
  target worktree, produced
  `18e27bea34ad552c1f00efed40a48b4026bd66ff2139856c63f75af13f6641a2`.
  This review examined the dispatched target, not a later or unrelated diff.
- The August documentary anchor `26caa4d95fe09a6cccb665cd88942f1edfb853c8`
  is the first-parent main commit at or before `2026-08-09T23:59:59-04:00`,
  authored and committed at `2026-08-09 21:56:02 -0400`. Verified as an
  ancestor of `origin/main`.
- The T2 runtime receipt at `9d004b0fc9af3df970df22ed439eb46be5b80b06`
  records `observedAt: 2026-09-13T23:39:15Z`, `apiDeploymentRolledOut: true`,
  OVH graph and scrape bindings (`s3.bhs.io.cloud.ovh.net`), an empty
  `minioResources` array, `tem.preserved: true`, and
  `acceptedForFinalParity: false` with explicit qualification that destination
  header/metadata/tag comparison and final source rescan remain pending.
- The predecessor PDF at historical revision
  `72b966664523801ea00cfcb704e0285ee765c136` hashes to the stated
  `86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528`.
  Verified by extracting the blob and piping through `sha256sum`.
- The side-branch revision `ece2beb551e24cd6694434ea2f6464c8493aae5d` (S13)
  exists in the repository as a reachable commit object.

## Retest of v3 H1 correction: August manifest relations consistently declared

The v3 finding required every August storage, graph/scrape, and registry
relation derived solely from manifest evidence to use dashed edges and
`declared` qualification, consistent with D1's rule that Git declarations
are not runtime proof.

The v4 diff makes six targeted corrections:

1. **D2 prose**: "the repository declared production compute" replaces
   "Immo used its in-cluster MinIO declaration." The new text explicitly
   states these pinned manifests "establish configuration, not an August 9
   runtime inventory, secret resolution, traffic, successful mirror or
   completed refresh."

2. **A-before API-to-MinIO edge**: `-->` changed to `-.->` (solid to
   dashed). Label "Declared API object binding" retained. Verified against
   the August manifest: `30-api.yaml` sets
   `S3_ENDPOINT: "http://radar-minio:9000"` and `25-minio.yaml` declares
   MinIO. These are configuration declarations, not runtime receipts.

3. **A-before Geo-to-GeoS3 edge**: `-->` changed to `-.->`, label
   changed from "already migrated" to "Declared client binding", node label
   from "already migrated" to "declared." By August 9, the Geo deployment
   manifest declares the OVH bucket but no dated runtime receipt proves
   August 9 traffic; this demotion is correct.

4. **A-before SCW registry-to-API edge**: `-->` changed to `-.->`. Label
   "Declared image source" retained. The August build workflow declares SCW
   as the image registry (`build-push-images.yml:109,153,212`), but
   declares rather than observes an August 9 pull.

5. **A-before SCW registry-to-UI edge**: same solid-to-dashed correction.

6. **New annotation paragraph after A-before Mermaid**: "A-before is a
   documentary configuration reconstruction. Dashed storage/image/email
   edges mean `declared`, not failed or observed traffic."

The remaining solid edges in A-before are the core serving path
(user/URL/ingress/UI/API/DB/SSO/Geo-OGC). These represent the
operational platform attested by the cost report (S2: OVH BHS5 two b3-8
nodes billed by August 9) and ingress/route manifests (S10), not merely
configuration declarations. The distinction between attested operational
infrastructure and unverified storage/registry bindings is defensible and
internally consistent.

**Assessment: H1 is fully corrected.** All six manifest-only relations
in A-before are now dashed with declared qualification. The prose no
longer asserts runtime use from declarative evidence.

## Retest of provider-neutral B nodes

The v3 review confirmed this as non-blocking; the v4 diff strengthens it:

- B-before graph: `B_GRAPH` label changed from `"SCW graph/city/latest.json"`
  to `"Published graph contract · city/latest.json"`. The SCW provider name
  is removed from the functional label.
- B-after graph: `B_CORPUS` changed from `"OVH PV corpus / durable
  checkpoints"` to `"Durable PV corpus / checkpoints"`. `B_GRAPH` changed
  from `"OVH canonical graph · validated publication"` to `"Canonical graph ·
  validated publication"`.
- D3 judgment adds: "Pair B names the corpus and publication graph by durable
  function, not by object-storage provider."
- B-before and B-after annotations each add provider-neutrality statements.

All four pair-B data nodes now use functional labels. Physical storage
placement is correctly deferred to pair A. No provider name leaks into any
B-before or B-after node label.

## Production refresh dormancy and model pending

- B-after title: "activation dormant." Refresh subgraph:
  `"PRODUCTION DORMANT until promotion"`. All refresh edges within the
  subgraph use `-.->` (dashed), visually distinguishing the dormant path
  from the solid serving path (DB/API/UI).
- Model node: `B_MODEL["Subscription model · to ratify through M1"]`.
  Connected by a single dashed edge from `B_EXTRACT`. D3 judgment: "The
  model label is `To ratify through M1`; Luna high appears only as an
  observed acceptance trial, never the selected benchmark winner."
- Preproduction annotation is a text annotation below the graph, not a
  resource subgraph inside the production boundary.
- S9 verification: the acceptance document at
  `4d5cb8f7:docs/reviews/refresh-018/acceptance.md` confirms Graphify 0.18.0,
  Luna high (`gpt-5.6-luna`, effort `high`), controller-created Job at
  `22:21:00Z`, immutable replay with `modelCalls: 0`, and explicit
  "Production remains deliberately dormant."

No production activation, model winner, or promotion is claimed.

## Sonnet comparable with credential hygiene

- Option ID renamed from `sonnet-effective` to `sonnet-comparable`
  throughout (M1.1, M1.4, JSON payload).
- M1.4 description expanded: "same frozen Graphify request, source bytes,
  prompt, schema, retry policy and 16,384-token cap." Historical outputs
  explicitly scoped as "context only."
- New credential paragraph: "Any Sonnet credential must remain in an
  owner-controlled store outside this repository, be mounted read-only only
  for the isolated call, and be absent from command arguments, stdout/stderr,
  receipts, diffs, commits and the PDF."
- No credential, API key, or secret appears in the spec, plan, or diff.

The comparable requirement and out-of-repo credential hygiene are both
specified.

## Gemini no-output as non-classifiable attempt

- Finite state machine table: `no-output` maps to `not-classifiable`
  exclusively. Non-classifiable attempts require "null quality/latency-to-
  valid-output and `rankEligible:false` regardless of transport latency."
- M1.6 adds: "A request that returns no candidate output is
  transport/execution evidence only: it has no quality, latency-to-valid-
  output or semantic score, cannot enter a ranking denominator."
- JSON payload: Gemini attempt has `attemptState: "no-output"`,
  `classification: "not-classifiable"`, `candidateOutputRef: null`,
  `qualityMetrics: null`, `latencyToValidOutputMs: null`,
  `rankEligible: false`.
- Gemini does NOT appear in `candidateResults` (only the output-bearing
  Luna-low attempt does).
- Invalid fixture requirements explicitly cover "Gemini no-output promoted
  to results" and "no-output with metrics or rank eligibility."

No-output is correctly classified as transport evidence, excluded from
results, and forbidden from carrying quality metrics or rank eligibility.

## Finite M1 states and one-to-one result linkage

The state machine defines five legal states with one-to-one
state/classification pairs:

| `attemptState` | `classification` | Verified |
| --- | --- | --- |
| `not-launched` | `not-measured` | Sonnet attempt in JSON |
| `transport-failed` | `not-classifiable` | Not illustrated but defined |
| `no-output` | `not-classifiable` | Gemini attempt in JSON |
| `completed-invalid` | `output-invalid` | Luna-low attempt in JSON |
| `completed-valid` | `classifiable` | Not illustrated (no valid output yet) |

JSON payload consistency:
- `candidateAttempts` contains exactly three entries, one per option.
- `candidateResults` contains one entry (Luna-low, output-bearing
  `completed-invalid`).
- Gemini and Sonnet correctly excluded from results.
- Each result references exactly one existing attempt via `attemptId`.
- Three legal decision states: `awaiting-benchmark`, `deferred`, `ratified`.
- `rankEligible:true` requirements specify complete chain: `completed-valid`
  + `classifiable` + qualified identity + source freeze + output/validation
  refs + two judge refs.

Minor observation: the Sonnet attempt omits `qualityMetrics` and
`latencyToValidOutputMs` while the Gemini attempt includes them as null.
The state machine requires null for `not-launched`. Both absent and
explicit-null satisfy the invariant in JSON semantics; the spec calls
this an "illustrative pending payload (a copiable schema example, not a
recorded decision)," so the asymmetry is not a blocking defect.
Implementation should normalize to explicit null for all required-null
fields.

## Exact report interval

- D4: `[2026-08-10T00:00:00-04:00, 2026-09-14T00:00:00-04:00)`, described
  as "August 10 through September 13, 2026 inclusive in America/Toronto."
- Independently verified: the half-open interval spans exactly 35 days /
  840 hours (computed with `datetime` in America/Toronto timezone).
- D5: "Assert the exact inclusive report label `10 aout → 13 septembre
  2026`, the timestamp interval, 35 days and 840 hours in HTML, PDF text
  and the evidence manifest."
- D4: "Architecture corrections do not move this boundary or silently
  recalculate the protected cost method and amounts."

The interval is correctly specified and protected.

## Predecessor PDF attachment contract

- D4: SHA-256 `86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528`
  for `docs/spec/reports/study-2026-08/report.pdf` at historical revision
  `72b966664523801ea00cfcb704e0285ee765c136`. Independently verified by
  extracting the blob and hashing.
- Historical revision explicitly qualified: "not treated as main ancestry
  and must not be cherry-picked."
- Attachment specification: final PDF contains current report + four graph
  pages, then nine predecessor pages as visual appendix, and embeds original
  bytes as `study-2026-08-report.pdf`.
- Byte proof: "Page merging may renumber/recompress objects and is not the
  byte proof: extract the embedded attachment with `pdfdetach`, hash the
  extracted bytes and require exact equality with the source SHA-256."
- S14 source register entry correctly cites both the historical revision
  and the SHA-256, and qualifies: "not claimed main ancestry and not a
  commit to replay into this branch."
- D5: "Extract it with `pdfdetach`, compare exact SHA-256, and record
  current-report end, four graph-page numbers, predecessor start/end and
  attachment hash in `previousReport`. Verify the four complete graph pages
  before the predecessor range. Reject mention-only, page-only or hash-only
  attachment claims."

The attachment contract is executable and properly separates page-level
rendering (may change) from embedded-byte proof (must be exact).

## Canonical scene JSON/hash with parentId and exact edges

- D4 defines four scene IDs: `storage-before-20260809`,
  `storage-after-20260913`, `refresh-before-20260809`,
  `refresh-after-20260913`.
- Canonical JSON key order: `sceneId,pair,date,nodes,edges`; nodes sorted
  by `id` with `id,label,evidenceClass,parentId,repo` (`parentId:null` for
  roots); edges sorted by `id` with `id,source,target,label,dashed,both`.
- Format: "compact JSON with LF and SHA-256."
- Three-surface parity: `docs/architecture.md`, Focus inventory, and report
  manifest must expose the same ordered four scene IDs, canonical projections
  and SHA-256 values.
- Browser checks: "reconstruct native DOM `data-id`, `data-parent-id`,
  labels, evidence state and exact edges before capture."
- Failure mode: "Missing, reordered or divergent topology fails parity;
  copied source hashes alone cannot pass."
- D5: "Reconstruct the native DOM projection, verify every `parentId` and
  exact edge, bind each PDF capture/page to its scene hash, and reject a
  missing/reordered/topology-divergent scene."

The canonical projection contract is deterministic, hash-bound, and
requires structural reconstruction rather than mere hash copying.

## Exhaustive per-scene metrics at zoom 100%

- D5: data attributes (`data-node-kind="ordinary"`, `data-text-role`,
  `data-id`/`data-parent-id`/`data-evidence-class`, edge canonical
  ID/endpoints) specified for programmatic measurement.
- Per-scene, per-viewport inventory: card transformed rectangle,
  padding/gaps, content bounds, trailing slack; text computed size,
  transform scale, effective pixels, glyph/content bounds; Mermaid SVG
  bounding boxes.
- Conditions: "browser zoom 100%, deviceScaleFactor 1 and no fit-to-view
  below scale 1" at 1440x1000 and 1920x1080.
- Aggregation rule: "Aggregate only after all inventory entries pass, then
  report median and worst case."
- Complete-scene bounds: "union of every node, cluster and edge-label box
  at native graph transform `scale(1)`."
- Failure mode: "supplemental pages cannot repair a failed complete view."

The measurement contract is exhaustive and specifies no-zoom conditions.

## Four Mermaid and four SvelteFlow

The spec contains exactly four Mermaid flowchart blocks:
- A-before (storage, August 9)
- A-after (storage, September 13)
- B-before (refresh, August 9)
- B-after (refresh, September 13)

D4 requires: "Author exactly four canonical Mermaid graphs and derive four
complete nested SvelteFlow scenes. Preserve `parentId`, containment, edges,
service icons and `repo:` labels in both forms; no miniature placeholder
substitutes for a complete graph."

Each Mermaid block uses `subgraph` for containment (`A_CLOUD`, `A_IMMO`,
`B_CLOUD`, `B_REFRESH`, `B_WORKSTATION`), providing the `parentId`
structure for SvelteFlow derivation.

## TEM in all four scenes

| Scene | TEM node | Connection | Assessment |
| --- | --- | --- | --- |
| A-before | `A_TEM["SCW TEM · authorized residual until validated replacement"]` | `A_API -.-> A_TEM` "Transactional email · declared" | Email relation in pair A, dashed |
| A-after | `A_TEM["SCW TEM · authorized residual until validated replacement"]` | `A_API --> A_TEM` "Transactional email · retained" | Email relation in pair A, solid (observed retention via S5) |
| B-before | `B_TEM["Transverse exception · SCW TEM retained until validated replacement · outside PV extraction"]` | No edges | Not connected to extraction chain |
| B-after | `B_TEM["Transverse exception · SCW TEM retained until validated replacement · outside PV extraction"]` | No edges | Not connected to extraction chain |

D5 requirement satisfied: "Pair B must not connect TEM into the PV
extraction chain; pair A labels the email relation."

## Exact `Navigateur utilisateur` label

All four Mermaid blocks use the exact label `"Navigateur utilisateur"`:
- A-before: `A_USER["Navigateur utilisateur"]`
- A-after: `A_USER["Navigateur utilisateur"]`
- B-before: `B_USER["Navigateur utilisateur"]`
- B-after: `B_USER["Navigateur utilisateur"]`

D4.1 specifies: "The exact French user-node label is `Navigateur
utilisateur`; do not uppercase it or render the old `UTILISATEUR /
Navigateur` string." The former label does not appear anywhere in the spec.

## Card/type/PDF minima

D4.1 specifies the frozen D8 baseline (S12: 350x260 px cards, 16 px titles,
12 px descriptions, 11 px secondary, 18 px subflow titles, 12 px edges)
and the new requirements:

- Ordinary card: 120-156 CSS px high (46-60% of D8's 260 px)
- Padding 6-8 px, gaps 4-6 px
- Title >= 32 px, description >= 24 px, repo/status >= 24/22 px, subflow
  heading >= 36 px, edge label >= 24 px
- PDF: >= 18 pt titles, >= 14 pt descriptions/edges, >= 12 pt repo/status
- "Typography thresholds apply after SVG/SvelteFlow transforms, not just
  `getComputedStyle(...).fontSize`."

These are future implementation gates, clearly labeled: "These are future
implementation gates, not tests performed by this spec amendment."

## Checks with no finding

- The document is correctly marked as EVOL design with no implementation,
  production promotion, or completed T2 claim.
- Side-branch evidence (S13) is properly scoped and not promoted to main
  history or treated as a three-way result.
- The poc-k8s staleness is acknowledged (July 5 local main, August 1
  report).
- D1 explicitly states Git selection "is not a runtime inventory or proof
  that every declared relation executed that day."
- No credentials, attribution trailers, or co-authored-by lines appear
  in the reviewed diff.
- The plan correctly records review history (v1-v3 corrections) without
  claiming implementation or test passage.
- Allowed Paths in the plan correctly expand to include review files.
- The design does not claim completed T2, a three-model winner, or active
  production refresh.

## Non-blocking observations

1. **JSON field presence asymmetry**: The illustrative Sonnet attempt omits
   `qualityMetrics` and `latencyToValidOutputMs` while the Gemini attempt
   includes them as null. The state machine requires null for `not-launched`.
   Both absent and explicit-null satisfy the invariant in JSON semantics;
   the spec calls this an "illustrative pending payload (a copiable schema
   example, not a recorded decision)," so the asymmetry is not a blocking
   defect. Implementation should normalize to explicit null for all
   required-null fields.

2. **A-before serving-path evidence basis**: The solid edges for the core
   serving path (user/URL/ingress/UI/API/DB/SSO/Geo-OGC) in A-before rely
   on the cost report (S2: OVH two b3-8 billed by August 9) and route
   manifests (S10) rather than an August 9 runtime traffic receipt. This is
   a defensible distinction from manifest-only storage bindings (the cost
   report attests paid operational infrastructure, not just configuration),
   and the spec already qualifies A-before as a "documentary configuration
   reconstruction." No correction required, but implementation should
   preserve the distinction between cost-attested infrastructure and
   unverified bindings.

3. **Geo edge transition A-before to A-after**: In A-before, the Geo-to-
   GeoS3 edge is correctly dashed (declared). In A-after, it becomes solid
   with label "unchanged." The solid edge is justified by S6 (Geo runtime
   evidence at September 13) and S4 (platform report dating S3 Geo cutover
   to July 29). The label "unchanged" describes the bucket identity (same
   OVH location), not the evidence class (which upgraded from declared to
   observed). This is a coherent transition requiring no correction.
