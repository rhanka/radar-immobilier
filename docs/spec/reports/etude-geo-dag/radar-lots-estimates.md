# Radar-side lots of ADR-0035 (PV/signal transfer to geo): estimates

Read on radar `origin/main` `9ca451cf7` (2026-10-31), study branch `docs/adr-geo-pv-dag` (PR #960), ADR-0035 draft.
Engram/llm-mesh behaviour was checked in the published tarballs (`@sentropic/engram` 0.21.2, 0.23.0, 0.23.1;
`@sentropic/llm-mesh` 0.19.2). No `.env`, no cluster read: the live state of the prod CronJob is `unverified`.

## How durations are measured

"Agent-day" = one agent's working day, CI and review loop included. Bases are radar PRs, measured with
`gh pr view N --json createdAt,mergedAt,commits` (first commit authored -> merged). In this repo the coding span is
often a few hours and the rest is waiting for review/merge, so both are given.

| PR | Scope | Files, +/- | First commit -> merged | Notes |
|---|---|---|---|---|
| #679 | refresh-pv introduction: script, CronJob, overlay, make, tests | 44, +5795/-84 | 09-13 14:16 -> 22:42 (8.4 h) | 76 commits, the best whole-chain analog |
| #683 | retire SCW + MinIO storage | 116, +7312/-1681 | 09-13 14:21 -> 09-14 02:31 (12 h) | large mechanical retirement |
| #838 | refresh stagger + pending watchdog | 40, +2606/-53 | 10-09 10:27 -> 16:43 (6.3 h) | |
| #853 | declared removals in the projection guard (`upsertGraphAtomic`) | 31, +3078/-22 | 10-10 17:13 -> 10-11 21:33 (28 h; coding 1.2 h) | graph-store guard change |
| #825 | graph key (city_slug,id) + repair from S3 | 53, +5122/-716 | 10-04 19:01 -> 10-06 12:50 (42 h) | graph-store, multi-day |
| #806 | refresh oversize guard + per-URL deferral | 18, +1343/-72 | 10-03 19:10 -> 20:35 (1.4 h) | |
| #732 | `refresh_document_outcomes` table + verification pass | 17, +1128/-61 | 46 min | squashed (2 commits), lower bound |
| #932 | security hotfix 3, includes Graphify 0.18 -> Engram 0.21.2 | 135, +2779/-849 | 10-27 09:29 -> 20:30 (11 h) | the Engram part is a subset |
| #548 | purge-avis-bylaws: dry-run/apply canonical rewrite + `upsertGraphAtomic` | 2, +534 | 0.9 h | same pattern as pv-consume apply |
| #524 | read-only geo bucket reader (`GEO_DOCUMENTS_*`) | 12, +951/-26 | 08-25 -> 08-29 | waiting dominated |
| #253 | geo mapper multi-level Signal -> Zone/Lot | 8, +1238/-42 | coding 35 min, merged +12.5 h | |
| #728 | retire 2 zombie refresh CronJobs | 13, +68/-408 | 6 min | squashed, lower bound |

Calendar waits (observation windows, 7-day baseline) are listed apart and are not agent effort.

---

## (a) L0: refresh-pv LLM baseline over 7 days

**What exists today.**
- Receipts per run can already be counted: one `refresh_document_outcomes` row per submitted document with `cycle_id`,
  `provider`, `model`, `transition`, `attempts`, `latency_ms` (`api/src/db/schema.ts:745-770`, written by
  `api/src/services/graph/refresh-document-outcomes.ts:7-31`, called at `refresh-run.ts:510-517`). The sweep report is
  kept in S3 at `refresh/018/sweep/reports/<cycle_id>.json` (`refresh-pv.ts:303-309`). Each receipt is also logged
  (`refresh-pv.ts:238-243`, "refresh-pv: model receipt"), but pod logs expire in 24 h (`deploy/k8s/34-refresh-cronjob.yaml:57-58`).
- **Tokens are not recorded anywhere.** `RefreshModelReceipt` has no token field (`refresh-model-policy.ts:18-30`).
  Engram's `meshTextJsonClient` drops `response.usage` (0.21.2 `dist/llm-mesh.js`, return block at l.348-358).
  The data does exist upstream: llm-mesh 0.19.2 transports return usage (`transport/codex-runtime-wire.js:129-130`,
  `transport/cloud-code-runtime-client.js:230-234`) and the mesh emits it in the `onResponse` hook (`mesh.js:92,107`).

**Instrumentation (smallest change).**
1. `api/src/services/graph/refresh-mesh.ts:101-135`: pass `hooks: { onResponse }` to `createGraphifyMesh` (l.112)
   and expose an `onUsage` sink in `RefreshMeshOptions` (l.28-39).
2. `refresh-model-policy.ts`: `createClient(model, signal, onUsage)` (type l.46, calls l.134 and l.217); add
   `tokensIn`/`tokensOut` (nullable: "absent" is not 0, since the Codex wire turns a missing value into 0) to the
   receipt at the 3 `record(...)` sites (l.108, l.149, l.250).
3. `refresh-pv.ts:157`: forward the sink; add totals to the sweep summary (l.300).
4. Persistence: migration `api/drizzle/0028_*` adds `input_tokens`, `output_tokens` (nullable int) to
   `refresh_document_outcomes`; `schema.ts:745-766`; sum per document in `refresh-document-outcomes.ts:14-30`.
5. Read-out: a SQL report grouped by `cycle_id` over the last 7 days (runs, documents, submissions, tokens in/out by
   provider/model/transition), as a make target (`refresh-llm-baseline ENV=prod`) through the existing run-job path.

**Size.** 7-9 files, ~150-250 LOC of code plus ~150-250 LOC of tests.
**Tests.** refresh-mesh: hook usage reaches the sink; model-policy: receipt carries usage, missing usage stays null,
verification skip carries none; outcomes insert sums tokens (DB integration, `api/tests/integration`); report aggregation.
**External dependencies.** Release + prod promotion gate; the CronJob must actually run in prod for 7 days
(base `suspend: true`, prod overlay sets false, `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml:83-89`; live
state `unverified`). The ADR's 2x cap is a cost cap: seat-based usage needs a token-to-CAD rule (today only the
monthly allocation report, 96.48 CAD/month, no per-pipeline split).
**Duration.** **0.5 agent-day**. Basis: #806 (18 files, +1343, 1.4 h) and #732 (the outcomes table itself, <1 h,
lower bound). Calendar: **7 days** of measurement after deployment.
**Main risk.** A biased or empty baseline: prod CronJob suspended or quota-starved during the week, or usage absent
on one transport (then tokens stay null and only receipts are measured).

---

## (b) L1: Engram 0.23 (+F-EN4) and shared profile v2.2 with digest

**Engram call-site inventory (origin/main).**
- Pin: `api/package.json:38` (`"@sentropic/engram": "0.21.2"`); root override `package.json:36-38` (csv-parse);
  lock guard `tools/zod4-tree.mjs:56-57` asserts 0.21.2; comment `api/src/services/exploitation/reconcile.ts:61`.
- Runtime imports: `refresh-profile.ts:7-21`, `refresh-run.ts:4` (`mergeExtractions`, used at l.521),
  `refresh-mesh.ts:1-6` (`/llm-mesh`), `refresh-model-policy.ts:4`, `refresh-verification.ts:1`, `refresh-v23.ts:1`,
  `exploitation/reconcile.ts:5-12`, `exploitation/decisions.ts:17`, `exploitation/project-state.ts:1`.
- Tests: `engram-migration.test.ts:2`, `refresh-mesh.test.ts:7`, `refresh-model-policy.test.ts:1`,
  `refresh-profile.test.ts:13`, `refresh-run.test.ts:2`, `refresh-v23.test.ts:1`, `refresh-verification.test.ts:3`,
  `api/tests/integration/refresh-018.spec.ts:7`.
- Run identity: `refresh-pv.ts:247` hard-codes `packageVersion: "0.18.0"` (stale Graphify value) inside the run
  identity (`refresh-run.ts:395`). Changing it is an identity change for in-flight city states: decide on purpose.
- **Classification pilot** (branches `feat/classif-pilot-l0`, `feat/classif-pilot-l1l2`, no PR open): pins 0.21.2 in
  `tools/classif/lib/engram.mjs:1,12` (`ENGRAM_VERSION`), records it in `tools/classif/l1/manifests/engram-profile.json:5`,
  and runs Engram from a deps volume filled by `npm ci` on the repo lock (`tools/classif/classif.mk:48-52`). A main
  bump changes what a refilled volume contains: sequence L1 after the pilot's L2 or freeze its volume.

**Compatibility checked in the tarballs.** All 19 symbols radar imports exist in 0.23.0 `index.d.ts`/`llm-mesh.d.ts`;
`buildProfileChunkPrompt` and `validateProfileExtraction` bodies are identical (variable rename only); llm-mesh range
unchanged (`^0.19.0`); new peers `mcp-broker`/`mcp-platform` are optional. **F-EN4 is not shipped**: `mergeExtractions`
is still last-wins in 0.23.0 (`chunk-YEBG43F3.js:542`) and 0.23.1 (published 2026-10-31 22:43, `chunk-US7BRMRV.js:542`).
F-EN2 (`bundleProfile`) is not shipped either (`./registry/*` exports are the MCP manifest, not a profile bundle).

**Profile publication.** New Engram project folder `radar/ontology/pv-signals/` (`engram.yaml`, profile, registries,
digest lock, README with the two-conductor change rule), template: `radar/ontology/steve-classification/` on the pilot
branch. Do not fork the profile: either move `radar/ontology/ontology-profile.yaml` (787 lines, v2.2, the whole
9-type radar profile, not a PV subset) and update its 8 readers (`refresh-pv.ts:54`, `reconcile.ts:86`,
`api/Dockerfile:172-173`, `refresh-profile.test.ts:26`, `refresh-018.spec.ts:21`, `reconcile.test.ts:22-38`,
`packages/radar-domain/scripts/gen-relation-types.ts:26`, `tools/graphify-v23/graphify_to_extraction_v23.js:34`), or
point `engram.yaml` at it. Digest: interim radar digest (canonical hash of normalized profile + registries, as
`refresh-pv.ts:246-247` already computes) in a Node tool + CI step (`.github/workflows/ci.yml`), switched to F-EN2
when it ships.

**Size.** Bump: 4-6 files + lockfile, ~20-50 LOC. Profile folder + digest tool + CI: 5-8 files, ~150-250 LOC.
F-EN4 adoption later: 2-3 files, ~50-100 LOC.
**Tests.** Existing refresh/exploitation suites green on 0.23; digest tool (reformatted YAML -> same digest, removed
type -> different digest); CI fails on digest drift; with F-EN4: `refresh-run.test` merge of two chunks sharing a node
id keeps both citations, and `refresh-v23` grounding still holds; one v101b benchmark run (ADR: "one benchmark").
**External dependencies.** Engram release with F-EN4 (P1 request, status `unknown`); F-EN2 for the official digest;
geo-cond review of the profile governance; geo graphify 0.17.1 alignment is geo-side.
**Duration.** **0.5 agent-day** (bump + profile folder + digest CI) **+ 0.5 agent-day** for F-EN4 when released.
Basis: #932 carried the whole 0.18 -> 0.21.2 migration (API change) inside an 11 h PR; 0.21.2 -> 0.23 has no API
change for radar.
**Main risk.** "+F-EN4" cannot be delivered with any published Engram version; the interim digest will differ from
the later F-EN2 digest, forcing one digest bump that both conductors must review.

---

## (c) L4-L6: `radar-pv-consume`

**Reusable pieces found.**
- Dry-run is nearly free: `upsertGraphAtomic(db, city, graph, removals, { preview: true })` runs the whole projection,
  guards included, then rolls back (`api/src/services/graph/graph-store.ts:1420-1460`, #817).
- The guarded publish path already exists: candidate -> `enrichGraphify34Snapshot` (`graphify-34-enrichment.ts:112`)
  -> `applyGraphify34Snapshots` (S3 CAS + backup id, `graphify-34-snapshot.ts:247`) -> `upsertGraphAtomic`, as in
  `refresh-run.ts:295-330` (`publishSnapshot`). Baseline merge model: `extractionToV23Graph` (`refresh-v23.ts:135-163`).
- Read-only geo bucket reader and config exist (`api/src/config.ts` `GEO_DOCUMENTS_*` at l.304-335, `S3ObjectReader`,
  #524).
- `upsertGraphAtomic` deletes city nodes absent from the new graph (`graph-store.ts:1396-1418`): the consumer must
  merge geo events onto the canonical baseline, never project the contract alone.

**Work.**
1. Contract client: `api/src/services/pv-consume/contract.ts`: zod schemas for `latest.json`, snapshot, city object;
   sha256 check of every object; size budgets; refuse incomplete snapshots / `coverage_state`; per-city applied
   revision as state (S3 key or PG row) so only changed cities are read.
2. Mapping `event_id` -> `::` ids: `pv-consume/mapping.ts` + table `pv_event_node_map(city_slug, event_id, node_id)`
   (new migration). Match an existing radar node by `docSha` + anchor, then `reglement_number`/`etape`; else mint a
   stable `designationevent::<city>::…` / `signal::<city>::…` id; stable across geo `version++` on the same
   `event_id`; unmatched geo signal -> `needs_review`, never dropped. The map write runs in the same transaction as
   the projection (a small option hook in `projectCityInTransaction`, same kind of change as #853).
3. Graph build + apply: baseline (read anchor) + mapped nodes/edges -> existing enrich/apply/project path.
4. Facets/scoring: facets are keyed on graph node ids (`api/src/services/facets/*`), so id stability is the
   guarantee; add an orphan check (facets whose target id disappears in the preview) and a scoring before/after
   diff in the dry-run report. Etape/instrument stay derived by `enrichGraphify34Snapshot`.
5. Dry-run report per city/kind: canonical diff, signal diff, Jaccard on `(event_id, kind)`, facets before = after,
   `needs_review` rate; written to S3, also the L4 parity input.
6. City allowlist, one source of truth: a ConfigMap mounted by both CronJobs. Consumer reads it; refresh skips it by
   filtering `configOnlyCitySlugs()` at `refresh-pv.ts:169`. Rollback = remove the city + restore the canonical
   pre-image from the apply backup.
7. Packaging: `api/src/scripts/pv-consume.ts`, entry in `api/Dockerfile:72-97`; `deploy/k8s/36-pv-consume-cronjob.yaml`
   + preprod/prod overlays (pattern `deploy/k8s/refresh-cronjobs*/`); geo RO secret refs; RBAC in
   `deploy/k8s/11-ci-deployer-preprod-rbac.yaml`; `check-object-storage-bindings.sh:104-109` must allow the new
   manifest that names `sentropic-geo`; make `pv-consume-render|apply|diff ENV=…` (ENV last) wired from the root
   `Makefile`, render test in `ci.yml` like `refresh-018.mk verify-renders` (`ci.yml:47`).

**Size.** ~22-28 files, ~2,500-3,500 LOC including tests and manifests.
**Tests.** Unit: schema/hash mismatch/incomplete snapshot refused/size budget; mapping deterministic and stable
across `version++`; `needs_review` path; allowlist filter in refresh and consumer. DB integration: apply then preview =
no-op; completeness guard never loses a canonical node; 0 orphan facet; rollback restores the pre-image. Render test for
both overlays. Golden fixture: a contract sample written from the ADR schema, so radar is not blocked on geo L4.
**External dependencies.** Contract v1 field names confirmed by geo-cond (D4 still open); a preprod contract sample
(geo L3/L4); a read-only credential for `sentropic-geo(-preprod)/exports/immo/pv-signals/` (k8s mint + rotation;
the existing `GEO_DOCUMENTS_*` key scope covering this prefix is `unverified`); L4 parity budget (owner Q2).
**Duration.** **L4: 2 agent-days** (contract client, mapping, dry-run, parity report). **L5-L6: 1 agent-day**
(allowlist + refresh skip, prod overlay, rollback script and preprod rehearsal runbook). Basis: #679 delivered a
whole CronJob chain (script, overlay, make, tests, 44 files) in 8.4 h; the mapping inside the guarded projection is
the #853/#825 kind (28-42 h calendar). Calendar: 7 days per cohort in preprod and in prod, then 28 days before L8.
**Main risk.** Mapping misses existing nodes: duplicated or orphaned signals and facets. Second risk: the L4 golden test
targets the wrong code (see finding 1).

---

## (d) L7: `geo_resolutions` from the contract; `run-geo-mapper` shadow then off

**Current writers (two, not one).** `api/src/services/geo/run-geo-mapper.ts` (Job `deploy/k8s/35-run-geo-mapper-job.yaml`,
preprod twin `deploy/k8s/geo-mapper-preprod/job.yaml`, dispatch `.github/workflows/run-job.yaml:232-236`) **and**
`api/src/services/geo/populate-geo.ts:50` through the daily CronJob `deploy/k8s/35b-populate-geo-cronjob.yaml`
(`17 4 * * *`, `run-populate-geo.js`). Both use `resolveGeoRefsBatch` (`resolve-refs.ts:87-110`, insert with
`ON CONFLICT DO NOTHING`). Table: `schema.ts:642-662`. Readers: consistency (`load-consistency-raw.ts:94-154`,
`run-consistency-snapshot.ts:77-114`), `geo-features.ts`, `measure-geo-mapping.ts`, `report-opportunity-proof.ts:102-109`.

**Work.** `pv-consume/geo-resolutions.ts`: contract `join` (`zone_ref`, `no_lot`) -> rows keyed by the mapped `::`
node id, `provenance = 'geo_contract'`, unresolved -> `geo_unresolved` with a reason. Shadow: write contract rows to a
shadow table (or report) and diff them against the mapper per city (resolution rate, disagreements). Off: suspend/remove
the mapper Job and its dispatch, set `--no-resolve` on populate-geo-daily, keep the readers unchanged.
**Size.** 8-12 files, ~600-900 LOC including tests.
**Tests.** Row mapping (zone, lot, unresolved reason); idempotence on rerun; shadow diff on a fixture city; consistency
E1 unchanged on identical input; populate-geo no longer writes resolutions.
**External dependencies.** Geo `join` node, after the owner's Loi 25 decision on role; contract zone/lot ids in an id
space radar can resolve to `zone_versions`/`lot_versions` canonical ids (`unverified`).
**Duration.** **1 agent-day** (writer + shadow diff) **+ 0.5 agent-day** (switch-off PR). Basis: #253 (geo mapper
multi-level, 8 files, +1238, coding 35 min, merged next morning). Calendar: shadow period, proposal 7 days.
**Main risk.** Zone/lot id-space mismatch between geo `join` and radar canonical ids, which would drop E1 coverage.

---

## (e) L8: retirement

**Surface (origin/main).**
- CronJobs/PVC: `deploy/k8s/34-refresh-cronjob.yaml` (271), `34-refresh-pending-watchdog.yaml` (96),
  `34-refresh-keyring-pvc.yaml` (15), `deploy/k8s/refresh-cronjobs/` (15 files incl. `refresh-018.mk` 343, 4 awk
  guards, enroll/consent/keyring-import scripts), `deploy/k8s/refresh-cronjobs-prod/kustomization.yaml` (147).
- Code: `api/src/scripts/refresh-pv.ts` (320), `refresh-pending-watchdog.ts` (224 + test 170), `api/src/services/graph/refresh-*.ts`
  (~3,100 LOC + ~3,000 LOC tests), `api/tests/integration/refresh-018.spec.ts` (547) + fixtures, minus the modules
  pv-consume reuses (publish path, `refresh-v23` merge logic); `refresh_document_outcomes` stays as history.
- Wiring: `.github/workflows/bascule-refresh.yml`, `run-job.yaml:36,247,322-329,370-378`, `build-push-images.yml:1094-1112`,
  `ci.yml:47`, `deploy/cutover/config.json:4`, `deploy/cutover/test-boundary.cjs:135`,
  `deploy/ci/check-object-storage-bindings.sh:120-121` (+ `.test.sh:104-105`), `deploy/k8s/10-rbac.yaml:74`,
  `11-ci-deployer-preprod-rbac.yaml:93-95`, `api/Dockerfile:86-87`, `api/package.json:30` (`llm-mesh-refresh` alias),
  `deploy/k8s/secrets.example.yaml`; docs `docs/architecture.md:560`, `SPEC_EVOL_REFRESH_018.md:7`.
- Ops: delete the keyring PVC and the `radar-refresh-keyring-bootstrap` / `radar-refresh-runtime` secrets in both
  namespaces (they hold seat credentials).
- `exploitation/signals.ts` (77 LOC): only caller is `services/sources/seed-ontology.ts:31,439`, for a count. Trivial.
- **RECUEIL is shared**: `runRecueil` is used by `routes/sources.ts:89,127`, `scripts/collect-exploit-source.ts:60`,
  `services/pipeline/executor.ts:415`, `services/sources/live-scrape.ts:57`, `scripts/worker-live.ts:90`. L8 can retire
  the PV use and the PV adapters (moved to geo `qc-sources`), not the module.

**Size.** ~45-60 files, about -9,000 to -11,000 LOC, +~100.
**Tests.** Render/guard tests updated (`verify-renders`, object-storage bindings, cutover boundary); full API suite
and build green with the modules removed; a check that no manifest or workflow still names `radar-refresh-pv`.
**External dependencies.** End of the 28-day window with every city in the allowlist; geo `qc-sources` accepting
the PV adapters (geo-side); owner GO for deleting the PVC/secrets.
**Duration.** **1 agent-day** (+0.5 agent-day if the PV adapters and RECUEIL PV paths are in scope). Basis: #683
(116 files, -1681, 12 h, mechanical retirement) and #728 (2 CronJobs, 13 files, minutes, lower bound).
**Main risk.** Removing code still imported by pv-consume or by the other RECUEIL paths; deleting before every city
is in the allowlist.

---

## Totals

| Lot | Agent-days | Calendar waits (not effort) |
|---|---|---|
| L0 | 0.5 | 7 days of measurement |
| L1 | 0.5 + 0.5 (F-EN4 when released) | Engram release |
| L4 | 2 | geo contract sample |
| L5-L6 | 1 | 7 days per cohort, preprod then prod; 28 days before L8 |
| L7 | 1 + 0.5 | shadow period (7 days proposed) |
| L8 | 1 (+0.5 if PV adapters/RECUEIL) | after the window |
| **Total** | **7 agent-days** (7.5 with the L8 option) | |

**Buffer, shown apart (not included above):** +1 agent-day on L4 (mapping and facet survival on real cities, #825
shows graph-store work can take 2 days) and +0.5 agent-day on L1 (F-EN4 changes the merged citations, which the
grounding check in `refresh-v23.ts` may refuse). Total with buffer: 8.5-9 agent-days.

## Findings that change the plan

1. **The "signal derivation in `signals.ts`" is not the live path.** `signals.ts` is used only by the seed route. In
   the refresh path, Signal nodes come from the profile-driven LLM extraction, then from deterministic enrichment
   (`graphify-34-enrichment.ts:66-104`: `etape` via `deriveEtape`, `instrument` via `vivier-v2.ts`
   `instrumentFromSignal`) and severed-source materialization in `graph-store.ts` (`upsertGraphAtomic` l.1442-1447).
   The L4 golden test "ported rules vs `signals.ts`" has to target those; the enrichment cannot be retired in L8
   (facets/vivier use it).
2. **Tokens are not measured today.** L0 needs code before the 7-day clock starts (section a).
3. **F-EN4 and F-EN2 are in no published Engram version** (0.23.0 and 0.23.1 checked).
4. **`geo_resolutions` has two writers** (mapper Job and populate-geo-daily): L7 must switch both.
5. **RECUEIL is a shared module**: L8 can only remove its PV use.
6. `packageVersion: "0.18.0"` in the refresh run identity (`refresh-pv.ts:247`) is stale; fix it on purpose in L1.
