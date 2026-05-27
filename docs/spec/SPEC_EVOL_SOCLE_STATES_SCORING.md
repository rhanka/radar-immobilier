# SPEC_EVOL — ÉV1 Socle: states model + scoring grids (detailed)

> **Status**: EVOL — detailed spec for **evolution ÉV1** (`feat/socle-states-scoring`),
> the foundation of the post-SOCLE evolution track (`PLAN.md` §3bis).
> **Parent**: `SPEC_EVOL_PROCESS_E2E.md` (§3 states, §4 scoring, §9.1, §10).
> **Calibrated against** the 3 real pilots in `packages/radar-domain/src/valleyfield-dossiers.ts`
> (06V, PR #15). All new code/text in English.

## 1. Scope & non-goals

**In scope (ÉV1).** The shared data + scoring foundation every later evolution
(Radar T1, Opportunités T2, T0, …) builds on:
1. Enriched **states model** — signal→N-opportunities cardinality + physical
   pre-filters, lot `confirmed`/`zonePolygonSource`, signal status, action
   taxonomy + simple decision journal, temporal memory, per-datum provenance.
2. **Scoring model** — the two distinct measures (T1 sort /10, T2 opportunity
   0-5), the six T2 grids fully specified 0-5, the **non-disponible renormalization
   + recommendation cap** algorithm, the **per-axis score envelope**, and grid
   **versioning**.
3. A configurable **"Grilles de score" view** with hover rationale.
4. The **numeric calibration table** on the 3 real pilots (§5) — the honest
   result that locks the grids before reuse.
5. **Micro-rules** from the v4 review: append-only software journal, default PII
   masking, micro-lot contiguity detection.

**Non-goals (deferred to later evolutions).**
- The Radar T1 feed UI and "Approfondir" flow (ÉV2).
- The Opportunités T2 funnel, the global réel/sim toggle, multi-session memory UI (ÉV3).
- T0 onboarding / source proposal (ÉV4).
- `@sentropic/h2a` spike, `@sentropic/flow` chat, signed `ENGAGEMENT` artifacts (ÉV5).
- Crypto signing of the journal (deferred technical report — `SPEC_EVOL_OPERATING_MODEL.md`).
- Continuous automation + per-stage benchmark (ÉV7).

This spec defines **data shapes + algorithms + their calibration**; the lot-by-lot
build sequence lives in `plan/EV1-BRANCH_feat-socle-states-scoring.md`.

## 2. States model

### 2.1 Cardinality signal → N opportunities + physical pre-filters
One **signal** (T1, upstream) yields **N opportunities/dossiers** (T2, downstream).
A single rezoning can touch hundreds of lots, so **physical pre-filters run before
T2 dossier creation** to avoid saturation. Defaults (all configurable):

| Pre-filter | Default | Rationale |
|---|---|---|
| `minLotAreaM2` | 350 | Below this a single lot rarely supports meaningful densification. |
| `maxBuildingToLandValueRatio` | 0.80 | A lot whose building value ≫ land value is already optimally built. |
| `excludeRecentBuiltMicroLots` | true | Recently-built small lots are not redevelopment targets. |

**Micro-lot contiguity exception (v4 micro-rule).** A lot failing `minLotAreaM2`
is **not dropped** if it is geometrically contiguous to one or more other
under-exploited small lots: flag the cluster as an **assembly candidate**
(`assemblyCandidate: true`) and keep it. This is the anti-pattern to "blindly
exclude by area" called out in `SPEC_EVOL_PROCESS_E2E.md` §10. Contiguity uses
the cadastre geometry (`confirmed: true` lots only); when geometry is unconfirmed,
the cluster is flagged `hypothesis` and surfaced for human review, never
auto-created as a dossier.

### 2.2 Lot enrichment
Extend the lot shape (`OpportunityDossier.lots[]` in `opportunity.ts`):
- `confirmed: boolean` — `false` when the lot is linked to a zone by address/street
  proximity (today's case in all 3 pilots), `true` when a geometric intersection
  with the zone polygon is validated.
- `zonePolygonSource: "open-data-ckan" | "wms-municipal" | "vectorised-pdf" | "hypothese-street-name"`
  — provenance of the zone boundary used for the lot↔zone link.
- `assemblyCandidate?: boolean` — set by the contiguity rule (§2.1).

All 3 pilots are `confirmed: false` / `zonePolygonSource: "hypothese-street-name"`
today (zone vector polygons are not in open data; the lot↔zone link is a
street-name hypothesis). The model must represent that honestly rather than imply
geometric certainty.

### 2.3 Signal status (T1)
A signal carries a timestamped status:
`nouveau · à-approfondir · écarté · surveillance`. Status transitions are
journaled (§2.4). This is the field ÉV2's Radar feed renders and sorts on.

### 2.4 Action taxonomy + decision journal
Full PROCESS §6 taxonomy, ordered by engagement:
`rejeter < surveiller < qualifier-avec-expert < approcher-propriétaire < monter-dossier-acquisition`.

In V1, **human decisions** (qualification, go/no-go, status change) are **journaled
simply**: `{ who, role, action, target, timestamp, rationale? }`. **Sign decisions,
never each data item** — N opportunities × M data points would explode; the
decision is the unit of accountability. Signed `ENGAGEMENT` artifacts are ÉV5+
(`SPEC_EVOL_PROCESS_E2E.md` §11).

**Append-only software journal (v4 micro-rule).** The journal is a Postgres table
with **no `UPDATE`/`DELETE`** granted at the application role; corrections are new
rows referencing the prior entry (`supersedes: uuid`). No crypto in V1 — this is
software-enforced append-only, not signed. The journal is also the substrate for
multi-session memory (§2.5), so it is in ÉV1 scope, not gold-plating.

### 2.5 Temporal memory + document linking
- **Timeline.** A dossier evolves across sessions: an ordered list of timestamped
  events (`{ at, kind, ref, note }`). The 2-year retro-analysis (ÉV4) feeds this
  same timeline — it is not a T0-only structure.
- **Document linking.** Relate `avis ↔ règlement ↔ PV ↔ vidéo` by **bylaw number /
  zone** so context can be reconstructed (VISION §4.4/§7). In the pilots this is
  the link between e.g. `avis-referendum-150-49`, `regl-150-49-texte`, and the
  YouTube council session — same `bylaw: "150-49"`.

### 2.6 Per-datum provenance
The existing enum `fait · hypothese · non-disponible · simulé` (`Verification` in
`opportunity.ts`) stays. `simulé` = "instructed by the human · simulated
hypothesis" (the réel/sim story, ÉV3). ÉV1 adds **per-axis provenance** to the
score envelope (§3.5) so a score's availability is first-class, not buried in
free-text evidence.

## 3. Scoring model

### 3.1 Two distinct measures (not one that refines)
- **Signal sort (T1)** = a per-type triage prior (VISION §6). Scale **/10**.
- **Opportunity score (T2)** = a multi-axis composite (PROCESS §3). Scale **0-5**.

The misleading "90 → 63, one score refining" narrative is abandoned
(`SPEC_EVOL_PROCESS_E2E.md` §4.1). Two measures, two uses: T1 surfaces a
"hot-by-type" signal; T2 produces a reality-anchored opportunity score, usually
more modest once constraints/feasibility/market are integrated.

### 3.2 T1 signal-type table (value + confidence shown separately)
Value and confidence are **displayed separately, never multiplied** (multiplying
buries the high-value/uncertain signals we most want to surface).

| Signal type | Value /10 |
|---|---|
| Residential rezoning | 10 |
| CPTAQ dezoning demand/decision | 8 |
| PPCMOI | 7 |
| Relevant derogation | 5 |
| Political intention (PV), announced public consultation, plan-d'urbanisme refonte, COS/grid modification, requalification/TOD, public investment | 5–7 (per sub-type, configurable) |
| Irrelevant derogation | 1 (filtered out) |

This resolves the VISION §6 internal ambiguity ("Priorité 2 PPCMOI 7" vs
"Priorité 4 CPTAQ 8") **by score**: CPTAQ 8 > PPCMOI 7.

### 3.3 T2 grids — 0-5 per axis (weights 30/20/20/15/15)
`0` means absolute block/absence (PROCESS §3/§6), so the scale is **0-5, not 1-5**.
Each axis grid is **configurable + versioned**; descriptions below are the v1
defaults.

**Potentiel (30 %) — amplitude only** (legal maturity lives in Timing → no
double-count):
| Lvl | Description |
|---|---|
| 0 | No residential opening (zoning unchanged / non-residential). |
| 1 | Negligible (minor derogation, no density gain). |
| 2 | Minor opening (slight use/density tweak). |
| 3 | Moderate residential opening (density/use clearly increased). |
| 4 | Strong (markedly increased density/use — e.g. U→H conversion, conditional +50 log/ha). |
| 5 | Major **and** aligned with municipal intentions (structural rezoning matching the plan d'urbanisme). |

> "En vigueur" is **removed from level 5** (anti-asymmetry: the best find is still
> barely visible — `SPEC_EVOL_PROCESS_E2E.md` §4.3).

**Risque de contrainte (20 %, inverted — 5 = no constraint):**
| Lvl | Description |
|---|---|
| 0 | Absolute blocker: permanently-protected agricultural zone **with no dezoning demand** / flood 0-20 yr / contamination. |
| 1 | Severe: several heavy constraints (e.g. confirmed CPTAQ adjacency **+** riverain PPRLPI bands). |
| 2 | Costly major: one heavy constraint, expensive mitigation. |
| 3 | Negotiable / mitigable. |
| 4 | Minor. |
| 5 | No constraint. |

> **CPTAQ disambiguation**: protected zone *without demand* = low; a dezoning
> **demand/decision in progress = lower risk + positive signal** (reconciles the
> §4.2 paradox). "Non-intersected / indeterminate" is **not** 5 → mark the axis
> **non-disponible** (§3.4). Unknown ≠ favourable.

**Timing (20 %)** — separate **horizon** (long ≠ bad; VISION §9 targets the
structural long term) from **competitive visibility**:
| Lvl | Description |
|---|---|
| 0 | No catalyst. |
| 1 | Very long horizon, no active process. |
| 2 | Early signals. |
| 3 | Process in progress (consultation / référendaire open). |
| 4 | Advanced process (adopted, awaiting final adoption / PHV completed). |
| 5 | Window open **and** low competitive visibility measured (proxy: no recent notarized transaction since the 1st project — **Tier C → often non-disponible**, marked hypothesis). |

**Faisabilité foncière (15 %)** — form/access/area/assembly:
| Lvl | Description |
|---|---|
| 0 | Infeasible (no buildable area, no access). |
| 1 | Very constrained (tiny / landlocked). |
| 2 | Difficult (zone fully built, assembly required / 0 vacant lot at rôle). |
| 3 | Moderate (a large candidate lot exists; zone attribution is a hypothesis). |
| 4 | Good (clear buildable lot + access; services likely). |
| 5 | Excellent (large vacant lot, confirmed services, easy assembly). |

> Owner-dependent levels rest on a **hypothesis** (name redacted, LFM art. 72 →
> `confirmed: false`); "aqueduc/égout services" must be sourced (not guaranteed in
> open data).

**Valeur marché (15 %)** — comparables/permits/absorption:
| Lvl | Description |
|---|---|
| 0 | No market / declining. |
| 3 | Moderate, active demand (zone-level comparables present). |
| 5 | Strong, tight market with zone-level comparables. |

> **Tier C → non-disponible by default.** JLR/Centris transaction data is paid and
> absent in all pilots. Macro proxies (MRC permits, vacancy rate) are recorded as
> **context/confidence, not a market score** — **never fabricate** a level. Absent
> zone-level comparables, the axis is non-disponible and the recommendation is
> capped at surveillance (§3.4).

### 3.4 Non-disponible handling — renormalization + recommendation cap
The gap the socle flagged. Algorithm:

1. **Classify each axis** by availability: `available` (a level is grounded in
   `fait`/`hypothese` evidence), `non-disponible` (no evidence lets you place a
   level — e.g. zone-level market, unintersected CPTAQ polygon).
2. **Renormalize weights over the available axes only.** Drop non-disponible axes;
   re-scale the remaining weights to sum to 1.
3. Mark the score **partial** when any axis is non-disponible; expose
   `availableWeightSum` (the un-renormalized weight covered) as the honesty meter.
4. **Recommendation cap.** When the score is partial (a key proof is missing), the
   recommendation is **bounded to `{rejeter, surveiller, qualifier-avec-expert}`** —
   the engagement actions (`approcher-propriétaire`, `monter-dossier-acquisition`)
   are **blocked** until the gap is lifted (PROCESS §3 "high score without recent
   proof → surveillance"). `qualifier-avec-expert` stays allowed because it is the
   escalation that *lifts* the gap.
5. **Never fabricate a neutral value.** Unknown ≠ favourable; a non-disponible axis
   is excluded, not scored 2.5.

```ts
// radar-scoring (new package): replaces the naive weightedScore in opportunity.ts
type Availability = "available" | "non-disponible";
interface AxisScore { level: number | null; availability: Availability; /* + envelope §3.5 */ }

function aggregate(axes: Record<Axis, AxisScore>, weights: Record<Axis, number>) {
  const avail = Object.entries(axes).filter(([, a]) => a.availability === "available");
  const wSum  = avail.reduce((s, [k]) => s + weights[k as Axis], 0);          // e.g. 0.85
  const score = avail.reduce((s, [k, a]) => s + (a.level! * weights[k as Axis]) / wSum, 0);
  const partial = avail.length < Object.keys(axes).length;
  const cap = partial ? "qualifier-avec-expert" : "monter-dossier-acquisition"; // max allowed
  return { score, partial, availableWeightSum: wSum, recommendationCap: cap };
}
```

### 3.5 Per-axis score envelope
Each axis carries, not just a number:
```ts
interface AxisScore {
  level: number | null;                       // 0-5, null when non-disponible
  availability: "available" | "non-disponible";
  confidence: "high" | "medium" | "low";      // lowered when level rests on hypothesis
  evidenceRefs: string[];                      // sourceId[] backing the level
  rationale: string;
  gridVersion: string;                         // grid the level was scored under
}
```
This makes "level rests on a hypothesis" (e.g. CPTAQ adjacency in H-609-4/U-521)
first-class: the axis stays `available` but `confidence: "low"`, feeding the cap
logic and the hover view.

### 3.6 Grid versioning
Grids are editable + versioned. Past scores are **frozen under their grid version**;
recomputation is **on demand, never automatic-retroactive**. A dossier stores
`weightsVersion` + per-axis `gridVersion` so a later grid edit does not silently
rewrite history.

## 4. "Grilles de score" view (configurable) + hover
A screen listing, per axis: weight + the editable 0-5 descriptions + VISION/PROCESS
traceability + version. Every score shown elsewhere (opportunity views) displays on
hover a **mini-grid** (0-5, current level highlighted) + **rationale + evidence +
confidence + grid version**. Editing a grid creates a new version (§3.6); it never
mutates frozen scores. UAT: the view renders the v1 grids of §3.3 and the calibrated
pilot scores of §5 with correct partial/cap badges.

## 5. Calibration on the 3 real pilots
The honest result that locks the grids. **Market is `non-disponible` in all three**
(no zone-level comparables; macro proxies are context only), so each score is
**partial over 4 axes** (potentiel/risque/timing/faisabilité), weights renormalized
`30/20/20/15 → /0.85 = 0.353/0.235/0.235/0.176`, and **capped at
`qualifier-avec-expert`**.

| Axis | H-609-4 | U-521→H-521 | H-143/H-143-1 |
|---|---|---|---|
| Potentiel (0.353) | 4 `fait` | 4 `fait` | 3 `fait` |
| Risque (0.235) | 3 `hypothèse` (CPTAQ A-939 unconfirmed) | 2 `hypothèse` (canal 159 ha + A-912 unconfirmed) | 1 `fait` (CPTAQ A-118 confirmed + GRHQ Saint-Laurent) |
| Timing (0.235) | 3 `fait` (référendaire open, outcome unknown) | 4 `fait` (most advanced) | 4 `fait` (PHV completed) |
| Faisabilité (0.176) | 2 `hypothèse` (0 vacant lot, assembly) | 3 `hypothèse` (BO 17 866 m²) | 2 `hypothèse` (large lots, CPTAQ+riverain) |
| **Marché (excluded)** | **non-disponible** | **non-disponible** | **non-disponible** |
| **Partial score /5** | **3.18** | **3.35** | **2.59** |
| availableWeightSum | 0.85 | 0.85 | 0.85 |
| Recommendation (capped) | Surveiller | Qualifier avec expert | Surveiller avec prudence |

Notes:
- The partial scores (3.18 / 3.35 / 2.59) sit close to the old naive 5-axis values
  (3.15 / 3.30 / 2.65) because the dropped market level happened to be near the
  mean — but the **provenance is now honest**: the score is explicitly partial and
  the engagement actions are blocked, which the naive aggregate hid.
- H-143's `risque=1` is the only axis grounded in `fait` constraint evidence
  (confirmed A-118 adjacency); the other two pilots' risque rests on geometric
  hypotheses → `confidence: low`, reinforcing the cap.
- This table is regenerated by the calibration test (§7) so it cannot drift from code.

## 6. Micro-rules (v4 review)
1. **Append-only software journal** — Postgres, no `UPDATE`/`DELETE` at app role;
   corrections via `supersedes` rows (§2.4).
2. **Default PII masking** — owner/personal info masked at display by default
   (Loi 25); reveal is access-journaled. The pilots already keep owner names out of
   the model (LFM art. 72); this rule makes masking the default rendering posture.
3. **Micro-lot contiguity detection** — assembly candidates instead of blind area
   exclusion (§2.1).

## 7. Schema/code migration summary
- `packages/radar-domain/src/schemas/opportunity.ts`: lot `confirmed` /
  `zonePolygonSource` / `assemblyCandidate`; `Signal` status enum; `AxisScore`
  envelope (§3.5); `OpportunityScore` aggregate; timeline + journal-entry shapes.
- New **`packages/radar-scoring`** package: grids (v1 defaults §3.3), `aggregate()`
  with renormalization + cap (§3.4), grid versioning, pre-filter + contiguity
  helpers (§2.1).
- `packages/radar-domain/src/valleyfield-dossiers.ts`: migrate the 3 pilots to the
  enriched model (axis envelopes + market non-disponible) — this is the calibration
  fixture.
- New UI: `ui/src/lib/components/scoring/**` (Grilles view §4) + hover mini-grid.
- `api/drizzle/*.sql`: max 1 additive migration (append-only journal table +
  per-axis columns) — declared as a conditional path in the branch plan.

## 8. Acceptance criteria
1. `aggregate()` renormalizes over available axes and never invents a neutral level;
   unit tests cover all-available, one-non-disponible, and market-non-disponible.
2. A partial score caps the recommendation to `qualifier-avec-expert`; engagement
   actions are unreachable while any axis is non-disponible.
3. The calibration test reproduces §5 (3.18 / 3.35 / 2.59, all partial, all capped)
   from the migrated pilot fixtures.
4. Editing a grid creates a new version; previously-scored dossiers keep their
   frozen levels until an explicit on-demand recompute.
5. The Grilles view renders the v1 grids + hover envelope; UAT on root `dev` ports.
6. Lot pre-filters drop sub-threshold lots **except** contiguous assembly clusters.
7. The journal rejects `UPDATE`/`DELETE` at the app role; corrections use `supersedes`.

## 9. Open questions / deferred
- Exact contiguity adjacency test (shared edge vs buffer distance) — needs confirmed
  cadastre geometry, today unavailable; ÉV1 ships the flag + hypothesis path, the
  geometric test lands when zone polygons arrive (ÉV2/ÉV4 ingestion).
- Whether `availableWeightSum` has a hard floor below which a dossier is "too thin
  to score" (candidate: < 0.50) — propose 0.50, confirm in calibration review.
- T1 sub-type values (5–7 band) for the added signal types — confirm with VISION owner.
