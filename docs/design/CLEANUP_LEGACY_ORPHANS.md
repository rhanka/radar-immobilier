# DESIGN — legacy-orphan cleanup (schema-id supersession) — draft (execution held-for-gate)

> **Status**: DESIGN for review. Execution is **held-for-gate** (i-cond gates after
> this design is reviewed + recette adjudicates a coverage-proof sample + the net
> safe-purgeable count is confirmed). No purge runs from this note.

## 1. Problem

The node-id scheme changed (`type-<city>-<ref>` → `type::<city>::<ref>`). `upsertGraph`
(the worker-live direct feed, #626) is a PURE `ON CONFLICT(id) DO UPDATE` — additive,
never deletes — so a re-projection under the new scheme writes new-id nodes and leaves
the old-id nodes as **stale orphans**. `upsertGraphAtomic` (project-graph-from-s3)
*would* delete them (its step-3 removes `citySlug` nodes `NOT IN newNodeIds`) but its
id-matched non-regression gates read the orphans' data as "disappearing" and **abort**
→ the orphans are **not self-healing**.

## 2. Scope (measured — k8s RO preprod, adjudicated recette CERT_LEGACY_ORPHANS_SCOPE)

Exact 3-population partition of the 33,077 `::`-less nodes:

| population | count | cities | disposition |
|---|---|---|---|
| **Q1 superseded orphans** — `::`-less, non-`mention:`, in cities that HAVE a `::` projection | **10,234** | **479** | cleanup **target** (upper bound) |
| **Q2 canonical legacy-only** — cities with **0** `::` nodes (incl. grounded sainte-martine + ~93 error-source) | 21,823 | 530 | **PROTECT** — never purge (scoping/coverage item, separate) |
| `mention:` created today (single `:`) | 1,020 | — | not orphans — exclude |

Closure: 10,234 + 21,823 + 1,020 = 33,077 ✓.

**The orphan criterion is per-city supersession, never per-node id-shape.** A global
`id NOT LIKE '%::%'` purge is REJECTED — it would destroy grounded citations
(sainte-martine, 0 `::`) and whole canonical cities.

## 3. Cleanup algorithm (per city, only cities WITH a `::` projection)

For each `citySlug` in `has_new` (cities with ≥1 `::` node):

1. **Candidates** = nodes where `citySlug = C AND id NOT LIKE '%::%' AND id NOT LIKE 'mention:%'`.
   (This filter alone excludes Q2 by construction — a 0-`::` city is not in `has_new` —
   and excludes today's `mention:` nodes.)
2. **Content-coverage precondition (recette's safety gate).** Let
   `refs(N)` = the provenance ref-set of node `N` = the `docSha`/`rawRef` values in
   `props->'refs'` (+ `source_ref`). A candidate legacy node `L` is **safe-purgeable**
   only if `refs(L) ⊆ ⋃ refs(:: nodes of C)` — i.e. every source document cited by `L`
   is still cited somewhere in `C`'s new `::` projection. Any `L` with a ref **absent**
   from the `::` projection is **NOT purgeable** (data-loss): exclude it from
   `intendedRemovals` and record it as **uncovered-legacy** → a partial-re-projection
   signal (see §5, feeds the coverage-gap/item-2 workstream, e.g. the `lac-frontiere`
   658-node outlier).
   Coverage is at the **docSha/rawRef level** — the anti-data-loss invariant: a source PV
   is preserved iff the `::` projection carries the same docSha. **Page/excerpt fidelity**
   (same page, verbatim text) is a *separate citation-quality* concern, **not** a purge
   blocker (recette adjudicates it apart if wanted) — losing a page-anchor does not lose
   the source, so it does not gate the purge.
3. **Purge** = call `upsertGraphAtomic(db, C, cProjection, intendedRemovals = safePurgeIds)`.
   `intendedRemovals` exempts those ids from gate1 (business-props) and gate3 (source-refs),
   so the atomic's step-3 deletes them **without aborting**. **gate2 (completeness) is NOT
   exempted** and stays as defense-in-depth: if deleting a candidate would drop the
   complete-signal count (the `::` projection did not actually cover it), the transaction
   rolls back — a mistaken candidate is caught, not lost.

`cProjection` = the city's current graphify output (from S3, the same input
`project-graph-from-s3` consumes). The pass is a thin wrapper over the existing atomic
path — no new upsert logic, only the `intendedRemovals` set is computed.

## 4. Safety invariants (all non-negotiable)

- **Grounded/canonical PROTECT**: Q2 (0-`::` cities) excluded **by construction** —
  sainte-martine's 16 certified citations (`signal-sainte-martine-rezonage-*`, sha-lock
  `1f9f823f`) cannot enter the candidate set. Belt-and-suspenders: an explicit
  grounded-city denylist may also be passed, but the `has_new` gate already suffices.
- **Content coverage** (§3.2): no source doc is orphaned by a purge.
- **gate2 completeness** kept as a backstop (§3.3).
- **Partial re-projections are NOT purged** (§3.2 uncovered-legacy) — they are a
  re-projection-completeness problem, not orphan hygiene.

## 5. Execution model (held-for-gate)

1. **Dry-run** (read-only): per-city report `{candidates, safePurge, uncovered}` + the
   net safe-purgeable total (⊆ 10,234) and the uncovered-legacy total (→ item 2).
2. **recette adjudicates** a coverage-proof sample (validates the §3.2 precondition is
   sufficient in practice — e.g. saint-henri `source-saint-henri-pv-*` / `signal-densification-34C`
   covered by the 205/207 `::`).
3. **i-cond gates** execution on the reviewed design + the adjudicated sample + the net count.
4. Execute per-city (idempotent; `upsertGraphAtomic` is transactional per city).

## 6. Reader (stopgap) — decision

A global `NOT LIKE '%::%'` reader filter is **REJECTED** (it would hide canonical/grounded
cities). A per-city supersession-aware reader guard is ~as complex as the cleanup, so it
is **not** pursued: the cleanup fixes the data at the source. Pre-cleanup, the only
user-facing effect is **bounded, non-destructive count inflation** for double-projection
cities (e.g. saint-henri shows 228 vs 205). Note (separate, §7): the province-wide Signaux
reader `listCitiesWithSignalNodes` has no config/freshness filter, so **canonical
legacy-only cities (Q2) serve stale June data today** — that is an item-2 (coverage-gap)
user-facing concern, not fixed by this cleanup.

## 7. Out of scope (flagged, not addressed here)

- **Coverage-gap / item 2** (owner) — measured (k8s RO), 530 legacy-only cities / 21,823
  nodes, split:
  - **IN-CONFIG DEBT: 43 cities / 14,202 nodes** (65% of the legacy mass; dense, ~330/city:
    grand-remous 2073, chibougamau 2016, lyster 1924, baie-des-sables 1610, laurierville
    1575, dunham 1101…). Config-active cities stuck in June → **the material freshness
    item**. Fix = re-project (`worker-live --reexploit` when raw is in S3, else re-scrape).
    Several are **grounded-real** (real citations, old) → re-projection PRESERVES them
    (gate3 / content-coverage), never deletes.
  - **DROPPED: 487 cities / 7,621 nodes** (thin, ~16/city) — out-of-config munis → owner
    governance (serve/archive/purge; Option B hides them, preserving grounded-real).
  - **SERVED-STALE (user-facing)**: 320 cities / 4,158 Signal/DE nodes surfaced by the
    reader (in-config 32c/2,389n; dropped 288c/1,769n). True "unintentional stale" is
    smaller — exclude sainte-martine (canonical) + grounded-real (grand-remous/lyster… =
    old-but-real → re-project, don't hide); recette adjudicates the exact `grounded ∩ 320`.
- **Distinct-slug puzzle** (recette): **1010** distinct `city_slug` (479 Q1 + 530 Q2 + 1
  `mention:`-only slug) vs 528 config → ~482 extra — accumulated historical munis and/or
  renamed slugs (a dedup / slug-identity question, geo/scoping territory), to elucidate
  separately.

## 8. ITEM 2 stopgap — Signaux-reader mitigation (serving-layer, REVERSIBLE)

A companion, **non-destructive** design for the user-facing half of item 2: the
province-wide Signaux feed `listCitiesWithSignalNodes` (`graph-store.ts`, used by
`graph-signals.ts`) filters only on `type ∈ {Signal, DesignationEvent}` + `citySlug NOT
NULL` — **no config, no id-scheme, no freshness filter** — so canonical legacy-only (Q2)
cities serve **stale June** signals to users.

**Nature: a serving-layer `WHERE` clause, fully reversible, non-destructive, and distinct
from the cleanup** — it changes only what is *served*, deletes no rows, and reverts by
removing the predicate. It must NOT be confused with the §3 cleanup (which deletes).

Options (owner/serving decision — designed, not chosen here):

- **Option A — config-active scope**: serve only cities in the active config set
  (`configOnlyCitySlugs()`). Hides out-of-config dropped cities. **Limit**: the in-config
  error-source (~93) are still served stale (they ARE in config, just un-re-projected).
- **Option B — id-scheme freshness (has-`::` per city)**: serve a city only if it has a
  `::` projection. Hides Q2 until re-projected; the in-config cities become *absent* rather
  than *stale-wrong* (arguably better) pending re-projection.
- **Option C — timestamp freshness**: serve only nodes/cities projected within N days
  (needs a reliable projected-at; heavier, not required if B suffices).

**Recommendation**: Option **B**, refined to `has-:: OR grounded-real` per city — one
predicate, per-city, non-destructive.

**PRESERVE GROUNDED-REAL (a correctness constraint).** A naive `has-::`-only predicate
would hide **grounded-real** cities that are still legacy-only (0 `::`) — e.g. grand-remous
(322 real citations) and lyster (392), which are grounded-in-PG but not yet re-projected.
Hiding them would suppress **real** data. So the predicate must serve a city when it has a
`::` projection **OR** carries real citations (a Signal/DesignationEvent node with a real
docSha in `props.refs`). "grounded" here means *has real refs in PG*, which is distinct
from *has `graph/latest.json`* (only sainte-martine in preprod) and from *canonical Q2*.

**HARD COUPLING (mandatory ordering — a correctness constraint, not a nicety).** Option B
alone would make the **in-config cities that have no `::` yet DISAPPEAR** from the feed
(they have no `::` → the predicate hides them). That is a regression: a config-active city
must never vanish. So the owner decision is a **coherent package**, applied in order:

1. **Re-project the in-config-without-`::` cities** (`worker-live --reexploit <cities>`
   when their raw is present in S3, else a re-scrape) → they gain a `::` projection.
2. **Then apply Option B** → net effect: the feed shows the **fresh config-528**, drops
   the ~484 out-of-config cities, and **no config city disappears**.

Applying (2) before (1) is forbidden. A stopgap that *hides* cities is not a substitute
for re-projecting the in-config debt. **Owner decides** the package (it reduces the
coverage users see to the active config); execution held-for-gate. The exact
in-config-without-`::` count (i-cond's ~46/~93) is produced by the config-split
(Q2 ∩ `configOnlyCitySlugs()`); the re-projectable fraction (raw present vs source
broken) is extraction's characterization.

**Reversibility confirmed**: pure read-path predicate; no migration, no delete; toggled by
config flag; instantly revertible. Orthogonal to §3 cleanup and to the coverage-gap
re-projection.

## 9. Root architecture finding — the atomic self-heal path is input-starved (owner archi-debt)

**Measured (k8s RO)**: `graph/{city}/latest.json` exists for **1** city in docs-preprod
(sainte-martine). `project-graph-from-s3` (the ATOMIC projection — `upsertGraphAtomic` +
`materializeSeveredSources`, the path that WOULD delete severed/orphans) reads exactly that
key (`project-graph-from-s3.ts:67,72`), and `graph/latest.json` is written **only by the
grounding pipeline** (`emit-graphify34-candidates` / `filet-auto-link-pv` /
`graphify-34-enrich`), never by worker-live. worker-live writes `parsed/` +
`ontology/project-state.json` and feeds PG via `projectStateToGraph → upsertGraph` (**pure,
additive**).

**Why orphans accumulate**: the only **at-scale** PG path (worker-live, 528 cities) is pure
additive — it cannot delete a superseded id. The **self-healing** path (atomic) is
**input-starved** — it runs only at the grounded-cohort scale. So the two paths are NOT
redundant (they carry *different graphs*: detection vs grounded/canonical), but the
self-heal never runs at scale.

**Why worker-live can't just switch to atomic**: its pure upsert is **deliberate** — an
atomic REPLACE keyed on the detection projection would delete the grounding citations
(`gate3` would in fact abort it). So self-heal-at-scale requires an at-scale **merged**
canonical graph (detection + grounding), not a detection-only atomic feed.

**Design position on the CronJob** (i-cond's 3 questions):
1. **KEEP** `project-graph-from-s3` — it is the grounding re-assert, correctly scoped; not
   vestigial, and it should *not* be the 528-detection path. **DROP** = no. The real
   at-scale self-heal is a *separate* fix.
2. The manual §3 cleanup is a **one-shot bridge** for the legacy id-scheme backlog (which
   the atomic can't self-clear — gate-abort on legacy ids); once an at-scale merged-graph
   atomic writer exists, it self-heals going forward and the cleanup is not recurring.
3. Option B (§8) is a **transition stopgap only** — the structural fix (at-scale merged
   atomic writer) makes it removable.

**The archi-debt (for the owner board)**: produce the merged canonical `graph/{city}/latest.json`
at scale and make an atomic projection the single at-scale PG writer → orphans resolved by
construction, grounding preserved. This is the durable end-state; #626's direct pure feed
was the correct interim (get PG fed) and would be retired by it. **Non-urgent, design-only;
does not block the nightly scrape** (which feeds PG via worker-live, independent of the
projection CronJob).
