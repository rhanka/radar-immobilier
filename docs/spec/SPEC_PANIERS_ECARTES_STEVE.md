# Signal baskets, discarded signals and Steve's workbook

Version 3 — 2026-10-18. Design correction only, on `spec/paniers-ecartes`; HEAD and local `origin/main`: `7a474439dcda1e2659c3219346a136eef6c25047`. Apply COLLAB and ratified O2; there is no new owner decision for the signal data foundation or basic UI. Canonical Steve import remains the last lot, dependent on #859 and its qualification.

## 1. Applied decisions and authority

| Subject | Applied decision and implementation consequence |
|---|---|
| COLLAB model | `selection` and `archive` are orthogonal business facets. Pertinent and À surveiller are personal selection baskets, private by default. Écarter archives the target; it is not a third value in a selection enum. Sharing remains within #702. |
| O2, ratified 16 August | Every approved workspace member can discard personally. Workspace-wide discard and restoration require moderator capability. Contributors cannot clear a common archive through a personal action. |
| Archive reason | Every new archive requires a Steve reason code valid for Non pertinent. A requested deselection is a separate transition in the same transaction. Restoration never recreates a removed selection. |
| One business domain | Deliver the first signal-only slice of the generalized facet store evolving from `prospect_marks`. Business state stays outside annotation tables; there is no competing marks domain or private annotation ledger. Do not alter `prospect_marks` in this slice; reconcile lot marks in lot 6. |
| D1 / D2(a), G2(c), G7(b) | Keep the complete workbook and analysis as immutable sources; contributions use the common Sentropic annotation model. The immo domain profile owns the taxonomy. No replacement private notes system. |
| D3, ratified 11 October | Resolve municipality, native type and native ID, with the observed version/snapshot. Block ambiguous matches. The initial team workspace spans cities; actual membership and assignments must be proven. |
| D4(c) / eradication | Wait for the required common implementation for annotations. #859 removes `prospect_notes` and its active API/domain/UI consumers; historical migrations remain. No legacy anchor repair or new dependency on those consumers. This does not block business facets. |
| D5/D6 — Farid, already pending | Attribution and visibility/redaction precede real Steve inscription, including rehearsals. D6 also governs source display. These are the only remaining decision conditions for the real Steve data in this scope; do not ask them again. Technical import, permission and operational qualification remain required. |

Authority: `origin/lane/conductor:docs/spec/SPEC_EVOL_COLLABORATION_MULTIUSER_2026-08-15.md` (COLLAB §§1.3, 2–4), `origin/lane/conductor:docs/spec/reports/DOSSIER_DECISION_COLLAB_2026-08-16.md` §1, and the Opus 5.5 review of v2 (2026-10-19, conductor archive). The 10–11 October decisions and #859 govern canonical annotations and supersede older annotation implementation options. COLLAB's historical open O2 section is resolved by the ratified dossier. Its business target archive is distinct from archiving a common-model annotation/thread; only the former hides the signal.

Other read-only references: PR #814 dossier (unmerged L5), the owner decision records of 2026-10-10 and 2026-10-11 and SPEC-INJECTION-IMMO v4 (private owner archive), `origin/feat/annotations-host:docs/spec/SPEC_EVOL_ANNOTATIONS_HOST.md`, its branch plan and PR #859, the supplied cards and Kanban. The merged [#794 dossier](reports/dossier-retours-steve/DOSSIER_DECISION_RETOURS_STEVE_2026-10-03.md) is historical context, not a new approval request. No reference file, client row or screenshot is copied into tracked files; workbook reporting is limited to counts, structure and column names.

## 2. Grounding in the checkout

| Verified surface | Finding and consequence |
|---|---|
| `api/drizzle/0005_prospect_marks.sql:43`, `:76`, `:90`; `schema.ts:433` | `lot_version_id` and `no_lot` are NOT NULL. The dimension/status CHECK and active index are lot-specific. Adding a signal status or nullable target alone cannot implement the required facets. |
| `0006_prospect_marks_fk_deferrable.sql`; `services/prospect/marks-service.ts:165` | The service supersedes an old head before inserting the successor in a transaction; the successor FK is deferred. This is a useful historical pattern, not proof of scoped concurrency for new facets. |
| `0013_graph_city_key.sql:7`; `api/src/db/migrate.ts:32` | Pending Drizzle migrations run in one transaction. A PostgreSQL enum value added with `ALTER TYPE ... ADD VALUE` cannot be used until commit; splitting that change across pending files does not solve it. Leave existing mark enums and constraints untouched in lot 3. |
| `0011_prospect_notes_annotations.sql`; `schema.ts:499`; `routes/prospect-marks.ts` | Notes use UUID signal targets and author-only mutations; approved sessions resolve to `account_users.id`. Preserve marks/contacts and authenticated attribution, but do not extend the notes path retired by #859. |
| `SignalAnnotations.svelte`, `EntityAnnotations.svelte`, `annotations-client.ts`, `SignauxSelPanel.svelte` | The panel passes text graph `node.id` to the UUID notes API; author controls compare session `sub` with an account UUID. Static mismatches only. #859 removes these components/client/mounts; basket controls must be independent of them and survive those removals. |
| `schema.ts:288`, `services/graph/graph-store.ts` | Graph keys are `(city_slug, id)`; refresh can remove/recreate nodes. Neither a display ID nor the current SQL key alone proves native identity continuity. |
| `services/graph/vivier-v2.ts`, `packages/radar-domain/src/vivier/`, `SignauxRail.svelte`, `SignauxMapView.svelte` | B classification, ranking and partitioned counts already exist. The selected city uses detail-derived counts; other cities use aggregates. Regulation enrichment and some PDF consumers read raw detail nodes. Preserve their populations and cover secondary consumers in lot 6. |
| `packages/immo-mcp/src/data-source.ts:244`, `:293` | `searchSignals` reads `GET /api/graph-signals/:city` with the current user's bearer, then applies search/limit. It must inherit the same default hiding and later expose explicit reveal, without another discard algorithm. |

The [old anchor contract](SPEC_CONTRAT_ANCRE_ANNOTATIONS_v1.md) describes the existing notes code. The [raw meeting](SPEC_RAW_STEVE_MEETING_2026-08-12.md) and COLLAB distinguish selection from archive. The [map integration specification](SPEC_EVOL_INTEGRATION_CARTE_STEVE.md) describes lot prospecting; its simulation path does not prove that the triage workbook was imported.

## 3. Identity, resources and canonical contributions

The shared `TargetRef` contract carries tenant, workspace, target type, native authority, stable ID and observed version. For a signal, native identity includes municipality, native type and native ID; the facet head is looked up by that stable identity and its scope. Source version, digest and locator are evidence of what the user saw, not additional head-key fields. No FK to a volatile `signals.id`, positional `gn-…` identifier or graph row that disappears on refresh may own the history.

The server resolves target existence, account approval and workspace membership on every read/write. Actor is derived from the authenticated session/bearer and resolved to `account_users.id`. Client-supplied actor, another user's personal scope, incomplete membership and implicit `default` workspace fallbacks are rejected. Lot 3 includes the minimal explicit tenant/workspace/member binding needed for this slice, coordinated with #702/#859's host contract, without waiting for the canonical annotation runtime or creating a second membership authority.

Ordinary refresh retains the facet head. Changed content for the same proven native object remains discarded and displays **« modifié depuis l'écart »**. Removal retains history; reappearance under the same proven identity retains state. Collisions, renumbering and unproved correspondence remain unresolved instead of silently moving state. Qualify these cases using synthetic graphs in lot 3; lot 5's workbook report does not substitute for that proof.

#859 supplies the annotation resource/snapshot/assignment/link seams, shared builders and canonical receipts. Reuse those for lot 7, including `same-native-object` and audited corrected mappings. Do not recreate a host resource or contribution ledger. Immo owns source bytes, cell/formula/cache inventory and locators; the common service owns contributions, revisions and source-unit-to-canonical reconciliation. Mixed authorship becomes separate homogeneous contributions; documentary author/time and technical importer/time stay distinct, with missing facts left unknown. One contribution may have several qualified targets; unmatched material stays source-anchored and enumerable.

Sentropic #663 and #684 are reported merged in the supplied review context. This does not prove #859 adoption or integrated M2/M3 import/readback. The frozen M1 contract alone cannot complete canonical reconciliation. #859 is still a draft with two supplied NO-GO reviews and outstanding adoption conditions; its runtime is a lot 7 dependency, not a prerequisite for lots 2–4.

## 4. Applied business facet contract

### 4.1 Selection and archive

The generalized store is the destination of the existing marks domain. Its first migration accepts signal targets only. It stores structured facet events and current heads, never free-text annotation bodies. Physical names and migration numbers are allocated on the implementation branch; no modification of historical SQL or `prospect_marks` occurs in lot 3.

| Facet | State and head identity | Mutation semantics |
|---|---|---|
| `selection` | Membership in a named personal basket, Pertinent or À surveiller. One head per stable target, facet and basket scope; the basket carries tenant/workspace/owner. | Add/remove membership appends a transition. COLLAB allows the same target in multiple authorized baskets; an archive does not replace membership. No active selection/archive implies no default À surveiller; history distinguishes untouched signals from restored/cleared ones. |
| `archive` | Active/restored, reason code, actor/time and observed target version. One head per stable target, facet and archive scope. Lot 3 supports personal scope; lot 6 adds workspace scope. | Écarter requires a valid code. Restore/undo append transitions; they do not delete history. Explicitly requested membership removals commit atomically with archive activation. |

The domain profile provides **all 28 reason codes and each code's classification association**, under D2(a). The UI offers codes filtered for the selected action's classification; it must not infer category from a code prefix. A selection may carry a compatible code; archive activation requires a code associated with Non pertinent. The server and persisted-state constraints reject a missing, unknown or incompatible archive code, including on batch or future MCP paths. Store the structured code/profile reference, not an extra free-text reason. Additional commentary belongs in the common annotation model.

Qualify exact set equality between the runtime profile's codes and lot 1's `readPatternCodes`, together with category associations. Size equality alone is insufficient: 24 used codes must not replace the 28 defined codes. The workbook codebook overrides the transcribed list, including spelling. This is a read-only fidelity check; runtime UI does not parse the workbook or depend on #859, and tracked tests use synthetic taxonomy fixtures.

### 4.2 Transactions, authorization and projection

Append an attributed event for each transition and preserve earlier values. Enforce one head per target/facet/scope in the database, with idempotency keys scoped by actor/workspace and transactional predecessor/successor consistency; concurrent first writes must not create two heads. Return the current heads and allowed actions. Common head mutations in lot 6 require `expected_head_id` (including an explicit absent-head expectation); mismatch returns **409** with the authorized current state, never silent last-write-wins. Re-read before retrying. Personal transitions also serialize against the current head and preserve their chain.

For the supported personal/workspace scopes:

```text
D(viewer) = D(workspace) ∪ D(personal viewer)
```

O2 applies at the server, including restoration: only a moderator may change `D(workspace)`. Changing a personal basket or restoring a personal archive cannot clear a common archive. Lot 3 leaves workspace writes unavailable; lot 6 adds them. Restricted person/group sharing remains an open #702 delivery, using the same authorized-scope model; this slice does not claim to implement it. Common and personal states are returned separately so the UI can explain effective hiding without exposing another user's private state.

There is **no automatic inheritance from Steve**. Display source classification separately under D6. Any later authorized initialization uses only resolved, non-conflicting source verdicts, the facet writer, an authorized actor and canonical provenance. D5/D6 do not bypass O2. Reimport never overwrites subsequent manual actions; a contextual link or annotation/thread archive never discards its business target.

### 4.3 Lot-mark reconciliation in lot 6

Follow COLLAB §2.3: join historical `lot_version_id` to `lot_versions.canonical_id`; preserve every event, author, timestamp, supersession link, mode, price and listing link. Report unresolved FKs and multiple heads across versions; do not choose a winner silently. Resolve historical workspace/basket scope explicitly rather than assuming the author owned a private mark.

An active historical `ecarte` becomes an archive head with migration provenance. Preserve its absent reason as `legacy-unknown`, with no invented Steve code; only identified imported events receive that exception. Every subsequent activation or change of an active archive requires a valid code; restoration preserves prior provenance without inventing a reason. Historical `favori` becomes selection only after scope mapping; solicitation stays pipeline and `en_vente` stays market. Cut over to one authority without dual-write, while preserving all history and keeping contacts/PII separate.

## 5. Workbook fidelity and report-only matching

The file hash was checked locally: `c7e19f46feb78c245fcd04b3e64fd4ac6f174f2d30ff1d4c77aa5a2bf0dc1bb8`. This worktree has no `node_modules`; the root checkout has neither `xlsx` nor `exceljs` at its top-level package locations. No parser was installed or run. Counts below come from the supplied Node recounts in the Opus reviews; they are fidelity references, not a new measurement by this pass.

| Structure / dimension | Fidelity reference |
|---|---|
| Entire workbook | 7 sheets, 433 non-empty rows, 4,392 cells. |
| Triage | 124 classified rows, 20 columns A:T, 51 cities; 40 Pertinent / 29 À surveiller / 55 Non pertinent. |
| Écartés par les filtres / Constats transversaux / Règles de classement | 121 filter-control records, 77 findings, 26 rules. Filter-control records are not user archives. |
| Codes de motif | 28 defined codes; 24 used in Triage. |
| Synthèse / Villes à couvrir | 124/146 classified, displayed as 84.9%; coverage 51/103. Initiateur total 95; Qualité du filtrage total 123. Preserve these differences. |
| Formulas | 47 formula cells with cached values: 45 in the summary, 2 in coverage; one shared-formula master and two followers. |
| Dropdown validations | 8 on Triage, columns B, F, G, J, K, P, Q, R, rows 6–405. |
| Filters / names | 3 automatic filters (Triage, Constats, Écartés); 3 hidden defined names `_xlnm._FilterDatabase`, with sheet scope preserved. |
| Remaining structure | 7 empty drawing parts; no person entries, merged cells, links or conditional formatting. |

Preserve all columns, including `Classement`, `Code de motif`, `Sens`, `Initiateur` and `Filtrage`. Raw, empty and unrecognized values remain distinct. Keep original bytes/hash, sheet/row/cell locators, visibility, number formats, validation ranges and other metadata. Preserve formula text and cached value independently, including the shared index/range and follower references; a follower without formula text is not a missing formula. Never evaluate formulas, execute macros or follow external links. Retain unsupported parts in the original source and report interpretation limits.

**Lot 1 is done, 12 commits on `feat/steve-capture`, in review**, as supplied by the owner. Its isolated read-only Node/TypeScript reader under `api/src/services/steve-source/` is **compatible with #859, without a code dependency**. It uses native facilities without a new spreadsheet dependency, produces a deterministic inventory and tests generated synthetic workbooks. No migration, DB/S3 write, UI, domain matching or real canonical inscription belongs to that lot.

**Lot 5 is a report, not an import.** After lot 1 is merged, read the 124 Triage rows against an identified synthetic graph through the D3 resolver, without persistence. Emit one exclusive status per row using this order: required graph/resource unavailable → `unavailable`; otherwise conflicting candidates → `ambiguous`; otherwise at least one intended target and all intended targets resolved → `fully_resolved`; otherwise at least one resolved → `partially_resolved`; otherwise → `unresolved`. The five totals must sum to **124**. Do not claim counts for these buckets before running the report, or invent graph nodes to make real rows match. A synthetic graph does not establish production correspondence.

Keep rows, source units, contributions, links and distinct signals as separate counts. Unresolved material remains available in the original source; row-level diagnostics stay transient/private, with no client rows in tracked artifacts or fixtures. Lot 5 writes no DB/S3/canonical state.

Before D5/D6, real material is inspection/recount/report-only, without inscription or visibility changes; development uses synthetic sources. Lot 7 preserves source resources under the approved policy, applies required redaction before canonical hashing, then qualifies import/readback through the common builders/service/receipts. Same source identity and payload reuse the canonical result, including after a lost response; changed source/mapping is an explicit linked operation. A local duplicate receipt ledger, truncated contribution or fabricated author/date is forbidden. Real import requires #859 merged, integrated M2/M3 qualification and D5/D6; any publication or state initialization also respects the applicable permissions and operational conditions.

## 6. Basic UI, server predicate and surfaces

Lot 2 introduces an injectable server discard-reader port, **without storage**, and exercises it with synthetic discarded identities. Its explicitly empty implementation preserves baseline behavior until lot 3 is wired. Once a persistent reader is configured, reader failure is an error, not an empty discarded set. No hidden storage or note dependency is introduced.

Let `B(F)` be the existing ordered signal population under the same filters, and `D(viewer)` the authorized archived identities:

```text
visible(F, viewer, false) = B(F) minus D(viewer)
visible(F, viewer, true)  = B(F)
```

Apply the same difference on the server **before aggregation and pagination** for `/api/graph-signals/:city` and `/api/graph-signals/by-city`. Preserve B classification/ranking, `exclusion_reason`, and each counter's population. Recompute partitions, stage counts and `legacyProjection` from the applicable remaining identities; maintain `total = qualified + residentialUnknown + sum(excludedByReason)`. Do not subtract only from total or repair only the selected city's badge. Coordinate `by-city` edits with #872 without depending on it.

**Lot 4 is deliberately bounded:** right-panel Pertinent / À surveiller / Écarter controls, category-filtered codes, archive/restoration state, the URL filter and explicit errors. Use existing design-system components and load detail plus `by-city` after successful writes. Initial archive controls preserve basket memberships; the command contract permits an explicitly requested deselection in the same transaction. Failed writes leave prior state visible. If a write succeeds but reload fails, show that distinction and retry the reads instead of claiming the write failed or inventing updated counts.

Persist reveal as **`filter.showDiscarded=1`** in the UI URL; the API query is **`showDiscarded=1`**, default false, identically forwarded on both reads. Reveal includes archived signals under all other filters; it is not an archived-only view or an authorization bypass. Back/forward/reload retain it. A direct link to an archived signal offers explicit reveal and restoration according to scope. Restore and Annuler append transitions. Reuse existing request guards to discard stale responses, invalidate affected detail caches, and reconcile selected/hovered/open signal state and focus after reload. Personal results cannot be reused across viewers/workspaces.

| Surface | Delivery and acceptance |
|---|---|
| Right panel, map, rail, primary counters | Lots 2–4: one server predicate, coherent detail/aggregate reload and selection reconciliation; default-hide and reveal parity for selected and unselected cities. |
| MCP `searchSignals` | Inherits the endpoint's default under the current user's session/bearer as soon as lots 2/3 are wired. Lot 6 adds explicit `showDiscarded?: boolean` to the tool/schema/data source, forwarding the API flag; omitted means false. Apply it before MCP search/limit, with the same permissions. No MCP mutation is added by this specification. |
| Regulatory enrichment, PDF/evidence and signal-derived lot indicators | Lot 6 verifies each secondary raw-node consumer against the same discard predicate while preserving its existing non-basket population. Independent geographic regulations, coverage and source documents remain accessible. |
| Other tabs/viewers, real-time events, reconnect | Lot 6: authorized notifications and refetch, no cross-user leakage. Do not build on the legacy global note stream; #859 eradication drains its buffers. Lot 4 does not depend on this transport work. |
| Steve source classification | Lot 7, under D6; separate from current basket membership/archive. Any source inscription also needs D5 and the qualified common host. |

Lot 4 proves the basic path, not complete secondary-surface or multi-tab coverage. Lot 6 closes that coverage before any claim of comprehensive parity. Zero archives must preserve baseline IDs/order/counts; reveal must reproduce that baseline under unchanged filters. Unknown/unavailable data is reported explicitly, never as zero.

## 7. Implementation lots and verification

The order is **1 → 2 → 3 → 4 → 5 → 6 → 7**. Lot 2 is already in development while lot 1 is in review; only lot 5 specifically requires lot 1's merge. Lot 4 depends on both 2 and 3. Custom UI #861 proceeds in parallel; neither its mockup nor #859 blocks the basic signal controls. Statuses of lots 1/2 are owner-supplied, not implementation/test claims by this pass.

For **every lot**, each atomic commit is **≤150 changed lines**, including tests/plan updates, with selective staging; split each slice below further when needed. These are implementation commit boundaries, not commits made by this design task. All implementation/jobs use Node/TypeScript and native binaries. Tests use synthetic data, isolated `ENV=test-*`, no live endpoints; `ENV` is always last. Run the lot's `make clean` even after a test failure. Existing Makefile test targets are the basis; no preliminary infrastructure lot is added.

### Lot 1 — Faithful workbook capture — done, in review / #784

`feat/steve-capture`, 12 commits reported. Commit boundaries, each ≤150 lines: archive/XML reader; cell/formula/cache inventory; validations/names/filters and `readPatternCodes`; synthetic fidelity cases, split as needed. Review the actual commits against that cap; their sizes were not measured here. Acceptance: deterministic complete inventory, master/follower distinction and metadata counts; no DB/S3 writes. Compatible with #859, without a code dependency.

```sh
make test-api SCOPE=src/services/steve-source ENV=test-steve-capture
make clean ENV=test-steve-capture
```

### Lot 2 — Server discarded predicate, without storage — in development / #760, #702

`feat/paniers-predicat`. Commit slices, each ≤150 lines: injectable reader/identity predicate; detail integration; aggregate integration; parity and failure cases. Acceptance: synthetic personal/common unions, baseline/reveal equality, unchanged classification and correct partitions, with no database migration or writer. No #859 dependency.

```sh
make test-api SCOPE=src/services/graph ENV=test-paniers-predicat
make test-api SCOPE=src/routes/graph-signals ENV=test-paniers-predicat
make clean ENV=test-paniers-predicat
```

### Lot 3 — Personal signal facets — after 2 / #702, #760

Commit slices, each ≤150 lines: scoped target/profile contract; minimal membership binding and signal-only store migration; selection transitions; archive/code/restoration transitions; authenticated routes; lot 2 adapter; concurrency/refresh tests. Keep migrations compatible with the actual runner and existing lot marks. Acceptance: two approved users have independent baskets/archives; spoofed or revoked identities fail; mandatory codes, one head, atomic optional deselection, idempotency and refresh continuity hold. No `ALTER` of `prospect_marks` and no canonical annotation dependency.

```sh
make test-api SCOPE=src/services/prospect ENV=test-paniers-facettes
make test-api SCOPE=src/routes/prospect ENV=test-paniers-facettes
make test-api SCOPE=tests/integration/prospect ENV=test-paniers-facettes
make clean ENV=test-paniers-facettes
```

### Lot 4 — Basic signal UI — after 2 and 3 / #760, #702

Commit slices, each ≤150 lines: facet client and controls; filtered code chooser; URL reveal/restoration; detail/aggregate refresh and errors; UI interaction cases. Acceptance through `make test-ui`: buttons, mandatory archive code, failure distinction, URL reload/back/forward, focus and primary counts. No new real-time, reconnect, regulatory or PDF work.

```sh
make test-ui SCOPE=src/lib/prospect ENV=test-paniers-ui
make test-ui SCOPE=src/lib/components/maps ENV=test-paniers-ui
make clean ENV=test-paniers-ui
```

### Lot 5 — D3 matching report only — after lot 1 is merged / #784

Commit slices, each ≤150 lines: matching/report adapter under `steve-source`; five exclusive status rules; synthetic graph cases and no-write assertions. Acceptance: 124 source rows accounted for, five buckets summing to 124, distinct signal counts separate, no invented match and no persistence. Run real source inspection only in the authorized read-only context; tracked test inputs remain synthetic.

```sh
make test-api SCOPE=src/services/steve-source ENV=test-steve-rattachements
make clean ENV=test-steve-rattachements
```

### Lot 6 — Workspace archive, lot migration and secondary surfaces / #702, #760

Commit slices, each ≤150 lines: moderator capabilities and `expected_head_id`/409; lossless lot mapping and conflict report; guarded facet cutover; MCP reveal parameter; regulatory/PDF projection; authorized event/refetch integration; scoped acceptance cases. Acceptance: personal restoration cannot lift common hiding; unauthorized shared writes fail; lossless lot history and one post-cutover authority; UI/MCP/secondary-surface parity and reconnect isolation. Preserve #859's stream-drain requirements; sharing and chat remain open #702 work.

```sh
make test-api SCOPE=src/services/prospect ENV=test-paniers-commun
make test-api SCOPE=src/routes/prospect ENV=test-paniers-commun
make test-api SCOPE=tests/integration/prospect ENV=test-paniers-commun
make test-ui SCOPE=src/lib/components/maps ENV=test-paniers-commun
make test-immo-mcp SCOPE=src/data-source.test.ts ENV=test-paniers-commun
make clean ENV=test-paniers-commun
```

### Lot 7 — Steve source display and canonical import / #784, #859

Commit slices, each ≤150 lines: qualified source preparation/receipts; D6-aware source classification display; readback/replay and interrupted-response tests; authorized initialization adapter only if applicable. Source display requires D6; real inscription/import requires D5/D6, merged #859 and qualified M2/M3. Acceptance: exact attribution/redaction before hashing, complete readback and unresolved retention, no duplicate contribution or overwrite of manual state. Neither 124 Triage rows nor 55 Non pertinent rows implies the same number of signals or archives.

```sh
make test-api SCOPE=src/services/annotations ENV=test-steve-import
make test-ui SCOPE=src/lib/components/maps ENV=test-steve-import
make clean ENV=test-steve-import
```

These commands are planned, not executed here. The root Makefile includes `.env`, so this design pass did not invoke it; file inspection used a standalone Make definition without project includes. Future execution must retain the no-environment-file constraint through an isolated Make entry point without those includes. `test-e2e` at this checkout is a placeholder and is not UI evidence; lot 4 uses `make test-ui`. A deployed/browser acceptance claim requires an actual scenario and result, neither supplied here.

Rollback must preserve source/history and must not reopen retired `prospect_notes` consumers. Once archives are active, a rollback cannot silently bypass their reader and reveal them; use a compatible reader or explicitly mark the affected signal view unavailable.

## 8. Card alignment and completion boundaries

| Card | Correct alignment against the supplied snapshot and later owner messages |
|---|---|
| **#702 — P1 since 12 October** | Own the collaborative domain: annotations on signals/cities, baskets, archive, sharing and chat. This signal slice delivers personal baskets/archive and then common archive; #859 carries annotation host/eradication. Keep the remaining annotation, sharing and chat obligations open; do not close #702 on the signal slice alone. |
| **#760 — last recorded P2, Kanban: to prioritize** | Replace obsolete “Steve document awaited” and mockup prerequisites: workbook received; 18 October authorizes basic signal UI without waiting for Steve/Mathieu's mockup, superseding the old dossier's UI hold. Replace tentative states with Pertinent / À surveiller baskets and Non pertinent archive, using the profile's codebook. Own manual triage, reveal/restoration and parity, linked to #702's domain rather than a parallel store. Do not invent a new priority/status. |
| **#784 — P2** | Capture lot 1 is done/in review; D3 report is lot 5; source display and canonical import are lot 7. Correct stale “no implementation started” wording without claiming real data is imported. |
| **#859 — draft** | Link both #702 and #784; retain its review/adoption conditions. It is a lot 7 import dependency, not the start of the basket chain. |
| **#761 — P2, backlog** | Business-filter reassessment remains separate from manual archive. Workbook is received; do not imply an automatic decision to remove filters. |
| **#797 / #783 — P2** | Preserve product orientation / oracle implementation split; neither blocks manual facets or capture. |
| **#861 — in development** | Custom UI priority remains; consume the same business contract without delaying the basic controls. |
| **#872 — backlog, assigned to Sentropic without priority in supplied review** | Coordinate the `by-city` overlap; no basket dependency. |
| **#794 / #814** | Merged historical dossier / unmerged revision. Read with the later ratifications and this correction, not as open decisions for the basic signal work. |

This alignment is written in the two requested documents only; no external card is edited or closed. No commit, push, environment-file read, import, service test or production/preproduction access is performed in this design task. The eleven v2 findings are addressed in §§1/4 (COLLAB/O2), §7 (lot order/commits/Make), §§4/5 (taxonomy/fidelity), §8 (cards), §6 (bounded UI/MCP) and §§5/7 (lot 1 independence).

Unverified: operational #859/M2/M3 integration, effective D5/D6 answers, real membership/assignments/matches/import/readback, implementation commit sizes, API/UI/MCP tests for these lots, deployed/browser behavior and external card updates. Workbook cell/metadata counts are attributed to the supplied recounts, not a parser run in this pass.
