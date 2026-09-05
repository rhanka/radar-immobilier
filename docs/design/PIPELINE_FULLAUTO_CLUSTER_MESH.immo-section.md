# PIPELINE_FULLAUTO_CLUSTER_MESH — immo-owned section (DRAFT for architect review)

> **Status**: DRAFT for the architect. Standalone section for i-cond to fold into the
> canonical doc (track `01M1S25MVCND04YZN76KTVNGAE`). immo owns two deliverables:
> **(1)** the canonical-graph + atomic-sole-writer end-state, **(2)** the geo→graph
> feeding contract (PROPOSED — pending geo-cond co-sign). Architecture is the
> architect's; this section GROUNDS the spine against the code and CORRECTS it where
> reality differs (measure-first, `file:line`). No code changed; no purge proposed here.
> Companion: `CLEANUP_LEGACY_ORPHANS.md` (the one-shot legacy bridge) — reused, not
> contradicted.

---

## 0. TL;DR — the P0 quick-win (lead)

**Two stages resolve the orphan debt AND de-starve the projection immediately — with no
AI, no vision, no cluster-mesh, and no owner AI/mesh decision required.** They are the
most profitable, least-blocked phase of the whole pipeline and are **independent of the
LLM / satellite-vision / mesh layers** (those layer on later, above this backbone).

- **E4 — deterministic canonical MERGE (the gap to build).** Assemble
  `graph/{city}/latest.json` = `MERGE(detection, grounding, geo)` from explicit S3 layer
  inputs, deterministically and idempotently. This is the **missing piece**: today
  `graphify-34-enrich` "phase A" re-projects the **already-in-PG (polluted)** state
  additively (`graphify-34-enrich.ts:67-73`, reads `subgraphForCity`) instead of merging
  fresh detection + grounding. E4 replaces that back-read with a real merge.
- **E5 — `upsertGraphAtomic` becomes the SOLE PG writer at scale.**
  `project-graph-from-s3` already reads the canonical and calls the atomic
  (`project-graph-from-s3.ts:64-76,124`); run it across the config-528. Because grounding
  is **inside** the merged input, the gates **no longer abort** (gate3 sees no dropped
  docSha) and orphans **auto-resolve** (REPLACE + `step-3` delete).

Net effect: orphans resolved by construction, grounding preserved, projection no longer
input-starved (`CLEANUP §9`) — shippable before any AI/mesh work begins. Everything below
details E4/E5 (Deliverable 1) and the geo layer's feed contract (Deliverable 2).

---

## A. Grounding corrections (spine vs measured code)

The architecture holds. Four points in the spine's framing need correction against the
code; none invalidates the target.

| # | Spine framing | Measured reality | Evidence |
|---|---|---|---|
| A1 | «graph/latest.json producers: emit-graphify34-candidates, filet-auto-link-pv, graphify-34-enrich» | Only **two** of those write the canonical key; **emit-graphify34-candidates does NOT** (it writes a *scratch* prefix); and **two shell writers** also publish it, bypassing the TS guard | see A1 below |
| A2 | «grounding writes the canonical, detection feeds PG» | The canonical is today **derived FROM PG** (`subgraphForCity`) then re-projected back — there is **no independent S3 detection contribution** | `graphify-34-snapshot.ts:136-146`, `graphify-34-enrich.ts:67-92` |
| A3 | «a detection-only atomic REPLACE would delete grounding — gate3 aborts it» | **Confirmed exactly.** gate3 = `findMissingSourceRefs`, identity = `docSha` alone | `graph-store.ts:793-814`, `:1068-1085` |
| A4 | «concurrent writers racing on graph/latest.json» | A CAS/optimistic lock **already exists** (`canonical-graph-writer.ts`), but the two **shell** writers bypass it (declared limit) | `canonical-graph-writer.ts:20-34,366-408` |

**A1 — the real writer set of `graph/<city>/latest.json`** (`canonicalGraphKey`,
`object-store.ts:46`):

- `graphify-34-enrich.ts` — **writes** (guarded): reads PG `subgraphForCity` → enrich →
  `writeCanonicalCityGraph` → re-project via `upsertGraphAtomic` (`:67-92`).
- `filet-auto-link-pv.ts` — **writes** (guarded): reads S3 `latest.json` → adds
  `provisional` rawRefs → `writeCanonicalCityGraph` → re-project atomic (`:259-306`).
- `emit-graphify34-candidates.ts` — **does NOT write the canonical key.** It writes a
  *scratch* prefix (`scratch/graphify34-candidates/<city>/latest.json` + optional
  `--s3-prefix`, `:143-192`). The guard `S3ObjectStore.put()` **refuses** the canonical
  key (`object-store.ts:83`, `CanonicalGraphWriteRefused`); the code comment says so
  (`:180-181`). It is a candidate/report emitter, not a producer.
- **Shell writers** publishing the canonical via `s5cmd`, **bypassing** the TS guard:
  `tools/graphify-v23/gate.sh:155` and `tools/grounding/publish-citation-grounding.sh:52`.
  `canonical-graph-writer.ts:30-34` declares this as an unprotected limit.

**Consequence for the design**: the merge-step must SUBSUME these five paths into a
single owner; the shell writers are exactly the unguarded race the merge-step removes.

---

## B. Deliverable 1 — canonical merged graph + atomic sole-writer

### B.1 Target end-state (the spine, unchanged)

One **canonical merged graph** per city at `graph/{city}/latest.json` =
`MERGE(detection, grounding, geo)`, and a **single ATOMIC PG writer**
(`upsertGraphAtomic`, successor of `project-graph-from-s3`) run at the scale of the
config-528 as the **only** PG writer. Because grounding is *inside* the canonical, the
atomic REPLACE self-heals orphans (`step-3` orphan delete + `materializeSeveredSources`)
**without** dropping grounding citations.

### B.2 The canonical graph shape (measured, `graph-store.ts:44-145`)

```
{ municipality?, ontology_version? ("2.0".."2.3"), graphify_pass? ("3.4"),
  nodes: Node[],  links?: Link[],  edges?: Link[] }   // links AND edges both accepted
Node = { id, type|file_type, label?, status?, description?,
         refs?: Ref[], properties?: {…business props: etape, instrument, effet_densifiant…},
         source_file?, community?, community_name? }
Link = { source|src|from, target|tgt|to, type|relation|rel,
         refs?: Ref[], confidence?, confidence_score?, source_file?, properties? }
Ref  = { docSha?, rawRef?, page?, excerpt?|citation?|quote?|text?,
         provisional?, linkSource? }
```

Both `links` and `edges` are unioned on read (`graph-store.ts:842`, `:992`). Snapshots
emit `nodes`+`edges` (`graphify-34-snapshot.ts:137-146`). The **id** is the natural key
(`ON CONFLICT (id)`); the **edge** natural key is `(src_id, dst_id, kind)`.

### B.3 Why worker-live is pure today — gate3 proof (A3, confirmed)

`worker-live` writes to S3 **only** `ontology/{city}/project-state.json`
(`exploitation.ts:162-163` → `projectStateKey` = `ontology/<city>/project-state.json`,
`project-state.ts:29-30`) plus RECUEIL `parsed/`; it **never** writes `graph/…`. It feeds
PG via `projectStateToGraph(state) → upsertGraph` (`exploitation.ts:169-181`), the **pure
additive** union (`ON CONFLICT (id)`, `#616` provenance-union of `props.refs`,
`graph-store.ts:877-893`), opt-in on real DB creds (`decidePgFeed`, `#626/#628`).

If `worker-live` instead did an atomic REPLACE keyed on the **detection-only**
projection, gate3 (`findMissingSourceRefs`, `graph-store.ts:793-814`) would compare each
node's before-`docSha` set to its after-set — identity = **`docSha` alone** (page is an
allowed refinement, `generated://` excluded) — find the grounding-added docShas *missing*
from the detection re-emit, and **abort the whole city** (`:1068-1085`). Hence pure is
deliberate, and **self-heal-at-scale REQUIRES the merged canonical**, not a detection-only
atomic feed. `intendedRemovals` exempts per-node intentional drops (`:707,:797`).

### B.4 E4 — the deterministic canonical MERGE (the gap to build)

**What exists today, and why it is not E4.** `graphify-34-enrich` "phase A" is *not* a
merge: it reads the **existing PG projection** (`subgraphForCity`,
`graphify-34-enrich.ts:67`), enriches it (instrument/etape classification), writes it
back to the canonical, and re-projects (`:72-92`). Its input is **already-polluted PG**
(orphans included), so re-projecting cannot heal them and cannot introduce fresh
detection. **E4 replaces the PG back-read with a real merge of explicit fresh inputs**
(detection + grounding + geo), each read from its own S3 layer — never from PG.

**Adapt, don't rebuild, the write path.** The guarded sole-writer of the canonical key
**already exists** (`canonical-graph-writer.ts`). It already guarantees: an archive of the
pre-image before any overwrite (`archiveCityGraphPrefix`, `:233-288`), a read-anchor ETag
capturing the version the new body was derived from (`:129-135,191-219`), and a
**refusal** to publish when the key moved since that read or when the archive does not
cover the version being destroyed (`ConcurrentCanonicalWrite`, `:366-408`, `If-Match`
conditional PUT). E4 **is the new source of `body`** for that existing writer — the
merge-step becomes its single caller. **What is missing** is (a) the merge itself, (b)
folding the two **shell** writers (`gate.sh:155`, `publish-citation-grounding.sh:52`) that
bypass the guard (declared limit, `:30-34`) into this single caller, and (c) the
per-layer S3 inputs (worker-live writes none today, A2).

**Key** = node `id` (`::` scheme). **On id collision across layers**:

1. `props.refs` → **UNION**, deduped, provenance-preserving — reuse the exact `#616`
   pattern already in `upsertGraph` (`graph-store.ts:877-893`) and `mergeRefs`
   (`:437-452`). No citation is ever dropped by the merge.
2. Business `props.properties` and scalar props → **layer with explicit precedence**
   (proposed): `detection` = base layer; `grounding` and `geo` = enrichment layers that
   **override** base for the keys they own, but **never delete** a base key. This mirrors
   `mergeProps` (`graph-store.ts:454-462`: `{…current, …next}` then ref-union) and stays
   compatible with gate1 (`findMissingBusinessProperties`, `:703-729`), which would abort
   a merge that dropped/degraded a business key. Precedence must be **fixed and named**
   in the merge-step, not emergent from producer order.
3. `label`, `type` → last-writer by precedence (grounding/geo > detection) — same as the
   atomic `ON CONFLICT … SET label/type = excluded` (`:1103-1111`).

**Layers → S3 prefixes** (proposed; each producer writes ONLY its own layer, never the
canonical directly):

| Layer | Producer | Proposed prefix |
|---|---|---|
| detection | `worker-live` (new S3 write) | `layers/detection/<city>/latest.json` |
| grounding | graphify-34 phase A / citation-grounding / filet | `layers/grounding/<city>/latest.json` |
| geo | geo-cond lanes (Deliverable 2) | `layers/geo/<city>/latest.json` |
| **canonical (output)** | **merge-step only** | `graph/<city>/latest.json` |

A single **merge-step** reads the three `layers/*/<city>/latest.json`, computes
`MERGE`, and writes the canonical **through the existing guarded writer**
(`writeCanonicalCityGraph`, `canonical-graph-writer.ts:366-408` — read-anchor ETag +
archive + `If-Match`). One writer ⇒ no producer races on the canonical key, and the
shell-writer bypass (A4) is retired by construction.

### B.4a Grounding ⊥ freshness — two ORTHOGONAL input axes (do not collapse)

E4 must treat its detection and grounding inputs as **distinct axes**, because they carry
different guarantees:

- **Freshness (recency)** comes only from a **fresh scrape → re-exploit** of raw/parsed
  (worker-live's RECUEIL + EXPLOITATION, `exploitation.ts:97-160`). Re-projecting an OLD
  raw is **not** a refresh: an in-config city stuck on June data becomes September-fresh
  only after a new scrape (`CLEANUP §7`, the 43 in-config / 14,202-node freshness debt).
- **Grounding (content)** comes from applying a **pre-certified candidate** (0 scrape) —
  it upgrades citations/pages/excerpts and grounds a city, but leaves its **date
  unchanged** (still June).

So `MERGE(detection-from-scrape, grounding-from-candidate, geo)` layers a **recency**
input and a **content** input that are independent: a city can be fresh-but-ungrounded,
grounded-but-stale, both, or neither. E4 must **not** conflate "re-project stored raw"
with "refresh", and must **not** let a grounding candidate mark a city as fresh. This
matches the anti-`refs>0` reasoning in `CLEANUP §8` (a projected detection ref is normal
state, not grounding) and the content-coverage docSha gate (`CLEANUP §3.2`).

### B.5 E5 — atomic sole-writer: self-heal + idempotence

The atomic REPLACE makes PG match the canonical **exactly**: `upsert` present nodes/edges,
then `step-3` delete `citySlug` nodes `NOT IN newNodeIds` + dangling edges
(`graph-store.ts:1132-1166`). Re-running the same canonical is idempotent (same input →
same graph). Orphans (ids absent from the canonical) are deleted. The gates
(gate1 business-props, gate2 completeness COUNT, gate3 source-refs) protect against a
**producer regression** (a layer that silently drops data → city aborted, others
continue). `intendedRemovals` carries **intentional** removals through the gates.
`materializeSeveredSources` (`:340-435`) runs inside the atomic on the merged nodeRows;
it re-materializes a severed per-event source as a CONFORMING ref — it composes with the
merge because it operates on the assembled `nodeRows`/`links` **after** the merge
(open question OQ-D5 on ordering vs the grounding layer's own refs).

### B.6 One-shot legacy bridge (from `CLEANUP_LEGACY_ORPHANS.md`, reused)

The legacy `-`-scheme backlog (Q1 **10,234** superseded orphans / 479 cities; Q2 handled
separately) is **not** in the new `::` canonical, so the atomic *would* delete it — but
the gates read the disappearance as data-loss and **abort** (data appears to vanish).
`CLEANUP_LEGACY_ORPHANS.md §3` clears it **once**: `upsertGraphAtomic(db, C,
cProjection, intendedRemovals = safePurgeIds)` where `safePurgeIds` are legacy nodes whose
`refs ⊆ ⋃ refs(:: nodes of C)` (content-coverage docSha/rawRef gate, §3.2). gate2
(completeness) is **not** exempted — a mis-scoped candidate rolls back, not lost. This is a
**bridge**, not recurring: once the merged canonical + atomic-at-scale exist, self-heal is
by construction and the bridge does not re-run (`CLEANUP §9`).

### B.7 Migration / sequencing + rollback

Ordering (each step independently shippable and reversible):

1. **E4 — build the merge-step + a detection S3 contribution.** Make `worker-live` write
   its detection projection to `layers/detection/<city>/latest.json` (new; it writes none
   today, A2). The merge-step assembles `graph/<city>/latest.json` from the layers via the
   **existing** guarded writer (B.4). **KEEP** `worker-live`'s interim direct pure PG feed
   (`#626`; opt-in on creds `#628/#629`) running in parallel (dual-write) so PG is never
   starved. *Rollback*: stop the merge-step; the direct feed still maintains PG.
2. **E5 — enable the atomic writer at scale** — run `upsertGraphAtomic`
   (`graph-store.ts:979`) via `project-graph-from-s3` (already reads the canonical + lists
   the whole `graph/` prefix, `project-graph-from-s3.ts:64-76,124`) across the config-528.
   Grounding is in the merged input, so gate3 (`:793-814`) no longer aborts and orphans
   auto-resolve (`step-3`, `:1132-1166`). *Rollback*: the atomic is idempotent and
   gate-guarded — disable the CronJob; PG is unchanged by an aborted city.
3. **Run the one-shot bridge** (B.6) to clear the legacy `-`-scheme backlog. *Rollback*:
   per-city transactional; archives exist (`graphify-34-backups/…`).
4. **Retire the interim direct PG feed — LAST, and only after E4+E5 are live AND
   validated.** Once the atomic-at-scale is the proven sole writer, `#626`'s direct pure
   feed (correct for its time) is removed; `decidePgFeed`→`{feed:false}` becomes the
   default (`pg-feed-decision.ts:40-52`). The interim `#626`/`#628`/`#629` direct feed is
   the **bridge that must stay until then**. *Rollback*: re-enable the feed flag.

**Do not reorder E5 before E4** (the atomic would delete detection that has no canonical
contribution yet), **do not run 3 before E5** (the bridge is a thin wrapper over the
atomic path), and **do not retire the direct feed before step 4** (validated). Mirrors the
hard-coupling ordering in `CLEANUP §8`.

### B.8 Open questions — Deliverable 1 (for i-cond)

- **OQ-D1** Merge-step owner: dedicated CronJob vs a `worker-live` post-step? A CronJob
  decouples cadence from the scrape and gives one lock holder; a post-step avoids a
  second scheduler. (immo leans CronJob — one writer, one cadence.)
- **OQ-D2** Producer/layer ordering: is `grounding` always merged *after* `detection`
  for the same run, or may a stale grounding layer override a fresh detection? Proposal:
  precedence is by **layer role**, not by write time — grounding/geo override detection
  regardless of recency; freshness is a *coverage* concern, not a precedence one.
- **OQ-D3** Props precedence rules: confirm the fixed precedence in B.4(2) — which exact
  keys each layer OWNS (e.g. detection owns `etape`/`instrument`/`effet_densifiant`;
  grounding owns `refs` page/excerpt; geo owns geo props) so gate1 never sees a legit
  override as a degradation.
- **OQ-D4** Concurrency/locking on `graph/latest.json`: fold the two shell writers
  (`gate.sh`, `publish-citation-grounding.sh`) into the guarded writer or the merge-step
  (close the `canonical-graph-writer.ts:30-34` declared limit).
- **OQ-D5** `materializeSeveredSources` vs the merge: does it run on merged nodeRows only
  (current: inside the atomic), or should the grounding layer already carry the
  materialized ref so the merge is the single source? (Proposal: keep it in the atomic;
  it is idempotent and its counters are the producer-gap signal, `graph-store.ts:1002`.)
- **OQ-D6** Bootstrap inversion: today grounding derives the canonical FROM PG (A2). The
  detection S3 contribution (step 1) removes that back-read — confirm no consumer depends
  on the PG→S3 direction (`subgraphForCity` in `graphify-34-enrich`, `emit-…`).

---

## C. Deliverable 2 — geo→graph feeding CONTRACT

> **PROPOSED — pending geo-cond co-sign.** immo proposes the seam so geo's three lanes
> (satellite / env / zones) feed the canonical merge (B.4). Grounded against existing
> code; geo-cond owns node-type ownership and layer versioning.

### C.1 Node types + `::` id scheme geo emits

Geo writes its contribution to `layers/geo/<city>/latest.json` (B.4), consumed by the
merge-step. Node ids follow the `::` scheme (`reglement-lifecycle-projection.ts:157,176`
= `bylaw::<muni>::<num>`, `event::<muni>::<event_id>`):

- **Zone** — `zone::<muni>::<realNumber>` (or with a règlement year:
  `zone::<muni>::<year>::<realNumber>`, the shape **already used** in
  `provenance.ts:26` — `zone::salaberry::2026::H-609-4` — and recognized by
  `geo/priority-resolver.ts:148`). `realNumber` = the **règlement zone number** verbatim
  (`H-609-4`), never a derived category.
- **Lot** — geo does **not** mint new Lot ids; it **layers geo props onto existing
  detection Lot nodes** by their existing `::` id (C.2).
- **Overlay** (env constraints) — a **distinct** node type, e.g.
  `overlay::<layer>::<muni>::<featureId>` (`overlay::cptaq::…`,
  `overlay::milieux-humides::…`). Never a Zone node (C.4).

**Edges** (geo → detection, provenance-carrying): `zone_of` (Lot → Zone), `within`
(Lot/Zone → overlay feature), `governed_by` (Zone → `bylaw::…` when the règlement zone
maps to a known bylaw). Edge key stays `(source, target, kind)`.

### C.2 How geo props layer onto detection nodes

A geo enrichment of an existing detection node (a Lot's zoning/satellite attributes) is
emitted as the **same `::` id** the detection layer used, carrying only geo `properties`
+ geo `refs`. The merge (B.4) unions it onto the detection base: `props.refs` union,
geo-owned property keys layered over the base. Geo therefore **must reuse the detection
id**, not mint a parallel one — an id it invents becomes a separate node, not an
enrichment. (This is the id-collision open question OQ-G1.)

### C.3 refs / provenance format, idempotence, S3 location

- **refs**: same `Ref` shape as B.2 — `{docSha, rawRef, page?, excerpt?, linkSource:
  "geo-<layer>"}`. `docSha` = SHA-256 of the geo source document (satellite tile
  manifest, zoning PDF, env dataset extract). This keeps geo refs first-class under
  gate3's docSha identity (`graph-store.ts:764-778`) — a geo docSha is preserved across
  re-projections exactly like a PV docSha.
- **Idempotence / stable ids**: a geo re-run over the same source MUST produce the same
  `::` ids and the same refs (deterministic, like `projectStateToGraph`,
  `project-state-to-graph.ts:32`). Zone/overlay ids are keyed on the **real** feature
  identifier (règlement number, cadastral id), never on a run timestamp.
- **Where geo writes**: `layers/geo/<city>/latest.json` (one file per city per run,
  latest wins). The merge-step is the only writer of `graph/<city>/latest.json`. Geo
  never touches the canonical key (the guard `object-store.ts:83` enforces this for the
  TS path).

### C.4 HARD CONSTRAINT (owner directive — encoded)

- **Zone nodes = REAL regulatory zones ONLY**, keyed by the **real règlement zone
  number** (`zone::<muni>::…::H-609-4`). **No** zone derived by categorization; **no**
  bare `H` / `R` as a Zone identity.
- The land-use category (`ZoneKind = ["H","C","U","I","P","A","autre"]`,
  `entities.ts:52`, derived from the code's first letter via `zoneKindOf`,
  `reglements-urbanisme-parser.ts:65`) is a **property** (`kind`) of a real Zone node —
  **never** its identity, and never a node on its own.
- **Environmental constraints** (CPTAQ, wetlands/`milieux-humides`, flood/`inondation`,
  …) = a **DISTINCT overlay-layer node type** (C.1), **NOT** Zone nodes. (No existing
  code mints Zone nodes from these — they live in scoring/domain schemas only; the
  contract keeps that separation.)
- The **ABCD Zonage** decision is **withdrawn/deferred** — this contract does not depend
  on it and does not reintroduce categorized zones.

### C.5 Open questions — Deliverable 2 (for geo-cond)

- **OQ-G1** Id collisions detection-vs-geo: when detection and geo both describe a Lot,
  is the `::` id byte-identical? Who mints the canonical Lot id, and how does geo learn
  it (read the detection layer, or a shared id-derivation helper)?
- **OQ-G2** Node-type ownership: geo owns `zone::` / `overlay::`; detection owns
  `bylaw::` / `event::` / `signal::`; who owns `lot::`? (Proposal: detection mints Lot,
  geo enriches.)
- **OQ-G3** Layer versioning: does `layers/geo/<city>/latest.json` carry a schema/version
  (like `ontology_version`, `graph-store.ts:140`) so the merge-step can reject an
  incompatible geo layer instead of silently merging it?
- **OQ-G4** Zone→bylaw linkage: when a real règlement zone maps to a `bylaw::` node, does
  geo emit the `governed_by` edge, or does the merge derive it from a shared ref? (Anti-
  invention: only when a shared docSha exists, mirroring `project-state-to-graph.ts:158-178`.)

---

## D. Consolidated OPEN QUESTIONS (for i-cond + geo-cond)

**Deliverable 1 (i-cond):** OQ-D1 merge-step owner (CronJob vs worker-live post-step) ·
OQ-D2 layer ordering / freshness-vs-precedence · OQ-D3 fixed props-precedence + per-layer
key ownership · OQ-D4 fold the two shell writers into the guarded writer (close the
declared bypass) · OQ-D5 `materializeSeveredSources` placement vs the merge · OQ-D6
confirm no consumer depends on the current PG→S3 back-read once detection has its own
S3 contribution.

**Deliverable 2 (geo-cond):** OQ-G1 detection-vs-geo id collisions + who mints the Lot
id · OQ-G2 node-type ownership (who owns `lot::`) · OQ-G3 geo layer schema versioning ·
OQ-G4 Zone→bylaw edge ownership (emit vs derive, anti-invention).

**Cross-cutting flag**: the current grounding path derives the canonical FROM PG (A2) and
two shell writers publish the canonical unguarded (A4). Both are resolved by the same
move — a single merge-step writing the canonical through the guarded writer from explicit
`layers/*` inputs. This is the load-bearing change; everything else in Deliverable 1
sequences around it.
