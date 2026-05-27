# SPEC_EVOL — ÉV1 Socle: states model + scoring grids (detailed) — v2

> **Status**: EVOL — detailed spec for **evolution ÉV1** (`feat/socle-states-scoring`),
> the foundation of the post-SOCLE evolution track (`PLAN.md` §3bis).
> **v2**: revised after a double agent review (Opus 4.7 xhigh + agy Gemini 3.5),
> both **NO-GO→addressed in one revision**. Blockers resolved: availability doctrine
> (§3.4.0), `Signal` entity + `signalId` (§2.0), real/simulation `mode` discriminator
> (§2.7), `aggregate()` robustness (§3.4). Critiques archived in
> `docs/spec/reviews/SPEC_EVOL_SOCLE_STATES_SCORING_review-{opus,agy}.md`.
> **Parent**: `SPEC_EVOL_PROCESS_E2E.md` (§3 states, §4 scoring, §9.1, §10).
> **Calibrated against** the 3 real pilots in `packages/radar-domain/src/valleyfield-dossiers.ts`
> (06V, PR #15). All new code/text in English.

## 1. Scope & non-goals

**In scope (ÉV1).** The shared data + scoring foundation every later evolution
(Radar T1, Opportunités T2, T0, …) builds on:
1. Enriched **states model** — the `Signal` entity + 1→N link, signal→N-opportunities
   cardinality + physical pre-filters, lot `confirmed`/`zonePolygonSource`/`metadata`,
   signal status, action taxonomy + simple decision journal, **real/simulation `mode`
   discriminator**, temporal memory, per-datum provenance.
2. **Scoring model** — the two distinct measures (T1 sort /10, T2 opportunity 0-5),
   the six T2 grids fully specified 0-5, the **availability doctrine** + **non-disponible
   renormalization + recommendation cap** algorithm (robust), the **per-axis score
   envelope**, and a grid **version stamp**.
3. A configurable **"Grilles de score" view** with hover rationale.
4. The **numeric calibration table** on the 3 real pilots (§5) — the honest result that
   locks the grids before reuse.
5. **Micro-rules** from the v4 review: append-only journal *shape*, default PII masking
   *intent*, micro-lot contiguity detection.

**Non-goals (deferred to later evolutions).**
- The Radar T1 feed UI and "Approfondir" flow (ÉV2).
- The Opportunités T2 funnel, the **global réel/sim toggle UI**, multi-session memory UI (ÉV3).
- The grid-editing UI + **frozen-past-scores recompute engine** (ÉV3 — ÉV1 ships only the version stamp).
- T0 onboarding / source proposal (ÉV4).
- **Journal grant-hardening at the Postgres role** and **PII masking enforcement** —
  ÉV1 ships the shapes/intent; enforcement lands when a writer/owner-display exists (ÉV3/ÉV4).
- `@sentropic/h2a` spike, `@sentropic/flow` chat, signed `ENGAGEMENT` artifacts (ÉV5).
- Crypto signing of the journal (deferred technical report — `SPEC_EVOL_OPERATING_MODEL.md`).
- Continuous automation + per-stage benchmark (ÉV7).

This spec defines **data shapes + algorithms + their calibration**; the lot-by-lot
build sequence lives in `plan/EV1-BRANCH_feat-socle-states-scoring.md`.

## 2. States model

### 2.0 Signal entity (T1) — the upstream node of the 1→N link
The foundation claims "1 signal → N opportunities", so the `Signal` shape and the
back-reference are first-class in ÉV1 (ÉV2's Radar feed renders and sorts on them):
```ts
interface Signal {
  id: string;
  type: SignalType;          // residential-rezoning | cptaq | ppcmoi | derogation-relevant |
                             // political-intention | public-consultation | plan-urbanisme |
                             // grid-cos-modification | requalification-tod | public-investment |
                             // derogation-irrelevant
  value: number;             // /10 triage prior, table §3.2 — NEVER multiplied by confidence
  confidence: Confidence;    // shown separately from value
  status: SignalStatus;      // §2.3
  sourceRefs: string[];      // backing evidence sourceId[]
  detectedAt: string;        // ISO timestamp
  bylaw?: string;            // linking key (§2.6)
  zone?: string;             // linking key
}
```
`OpportunityDossier` gains **`signalId: string`** — the downstream side of the 1→N link.

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
under-exploited small lots: the cluster gets an **`assemblyClusterId`** (a shared
identity, not just a per-lot boolean) and is kept as an assembly candidate. This is
the anti-pattern to "blindly exclude by area" called out in
`SPEC_EVOL_PROCESS_E2E.md` §10. Contiguity uses cadastre geometry (`confirmed: true`
lots only); when geometry is unconfirmed, the cluster is flagged `hypothesis` and
surfaced for human review, never auto-created as a dossier.

### 2.2 Lot enrichment
Extend the lot shape (`OpportunityDossier.lots[]` in `opportunity.ts`):
- `confirmed: boolean` — `false` when the lot is linked to a zone by address/street
  proximity (today's case in all 3 pilots), `true` when a geometric intersection
  with the zone polygon is validated.
- `zonePolygonSource: ZonePolygonSource` — provenance of the zone boundary used for
  the lot↔zone link. **Extensible** enum:
  `"open-data-ckan" | "wms-municipal" | "vectorised-pdf" | "hypothese-street-name" | "other"`
  (`"other"` keeps the door open for unforeseen sources without a migration).
- `assemblyClusterId?: string` — set by the contiguity rule (§2.1).
- `metadata?: Record<string, unknown>` — a generic escape hatch for downstream
  geometric/regulatory data (COS, max units, gabarit) that ÉV3 will need, avoiding a
  heavy migration later.

All 3 pilots are `confirmed: false` / `zonePolygonSource: "hypothese-street-name"`
today (zone vector polygons are not in open data; the lot↔zone link is a
street-name hypothesis). The model represents that honestly rather than imply
geometric certainty.

### 2.3 Signal status (T1)
`SignalStatus = "nouveau" | "à-approfondir" | "écarté" | "surveillance"`, timestamped.
Status transitions are journaled (§2.4). This is the field ÉV2's Radar feed renders
and sorts on.

### 2.4 Action taxonomy + decision journal
Full PROCESS §6 taxonomy, ordered by engagement:
`rejeter < surveiller < qualifier-avec-expert < approcher-propriétaire < monter-dossier-acquisition`.

In V1, **human decisions** (qualification, go/no-go, status change) are **journaled
simply**:
```ts
interface JournalEntry {
  id: string;
  who: string; role: string;           // PRINCIPAL = a human, never the AI
  action: string; target: string;      // e.g. "qualifier-avec-expert" on dossier X
  at: string;                          // ISO timestamp
  rationale?: string;
  mode: "real" | "simulation";         // §2.7 — partitions real vs simulated decisions
  supersedes?: string;                 // append-only correction → prior entry id
}
```
**Sign decisions, never each data item** — N opportunities × M data points would
explode; the decision is the unit of accountability. Signed `ENGAGEMENT` artifacts are
ÉV5+ (`SPEC_EVOL_PROCESS_E2E.md` §11).

**Append-only journal — shape in ÉV1, grant-hardening deferred.** The journal is the
substrate for multi-session memory (§2.5), so its *shape* (append-only semantics,
`supersedes` corrections, no in-place edits in app logic) is ÉV1 scope. The
**Postgres role-level `UPDATE`/`DELETE` revocation** is deferred to when a real writer
exists (ÉV3 memory UI) — no crypto in V1; this is software-enforced append-only.

### 2.5 Temporal memory + document linking
- **Timeline.** A dossier evolves across sessions: an ordered list of timestamped
  events (`{ at, kind, ref, note }`). The 2-year retro-analysis (ÉV4) feeds this same
  timeline — not a T0-only structure.
- **Document linking.** Relate `avis ↔ règlement ↔ PV ↔ vidéo` by **bylaw number /
  zone** (VISION §4.4/§7). In the pilots this is the link between e.g.
  `avis-referendum-150-49`, `regl-150-49-texte`, and the YouTube council session —
  same `bylaw: "150-49"`.

### 2.6 Per-datum provenance
`Verification` today has **3** values (`fait · hypothese · non-disponible`, see
`opportunity.ts:12`). ÉV1 **adds** `simulé` → 4 values. `simulé` = "instructed by the
human · simulated hypothesis" (the réel/sim story); it is the per-datum complement of
the dossier/journal-level `mode` (§2.7). This addition is listed in the migration §7.

### 2.7 Real/simulation `mode` discriminator
The global réel/sim **toggle UI** is ÉV3, but the **substrate must exist in ÉV1** so a
simulated decision never pollutes the real append-only journal (agy review). Both
`OpportunityDossier` and `JournalEntry` carry **`mode: "real" | "simulation"`**
(default `"real"`). Queries and the journal partition on `mode`; real exports never
include simulation rows. This is the dossier/journal complement of the per-datum
`simulé` (§2.6).

## 3. Scoring model

### 3.1 Two distinct measures (not one that refines)
- **Signal sort (T1)** = a per-type triage prior (VISION §6). Scale **/10**.
- **Opportunity score (T2)** = a multi-axis composite (PROCESS §3). Scale **0-5**.

The misleading "90 → 63, one score refining" narrative is abandoned
(`SPEC_EVOL_PROCESS_E2E.md` §4.1). Two measures, two uses: T1 surfaces a
"hot-by-type" signal; T2 produces a reality-anchored opportunity score.

> **Honest note (review):** the T2 score is **often** more modest once constraints are
> integrated, **but not always** — renormalizing over available axes (§3.4)
> mathematically **imputes the missing axis at the weighted mean of the known axes**.
> In this pilot set, dropping market actually **raises** 2 of 3 scores vs the naive
> 5-axis value (3.15→3.18, 3.30→3.35) and lowers 1 (2.65→2.59). The honesty lives in
> the **`partial` flag + recommendation cap**, not in the headline number being lower.

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

Resolves the VISION §6 internal ambiguity **by score**: CPTAQ 8 > PPCMOI 7.

### 3.3 T2 grids — 0-5 per axis (weights 30/20/20/15/15)
`0` means absolute block/absence (PROCESS §3/§6), so the scale is **0-5, not 1-5**.
Each axis grid is **configurable + version-stamped**; descriptions below are v1 defaults.

**Potentiel (30 %) — amplitude only** (legal maturity lives in Timing → no double-count):
| Lvl | Description |
|---|---|
| 0 | No residential opening (zoning unchanged / non-residential). |
| 1 | Negligible (minor derogation, no density gain). |
| 2 | Minor opening (slight use/density tweak). |
| 3 | Moderate residential opening (density/use clearly increased). |
| 4 | Strong (markedly increased density/use — e.g. U→H conversion, conditional +50 log/ha). |
| 5 | Major **and** aligned with municipal intentions (structural rezoning matching the plan d'urbanisme). |

> "En vigueur" is **removed from level 5** (anti-asymmetry — `SPEC_EVOL_PROCESS_E2E.md` §4.3).

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
> **demand/decision in progress = lower risk + positive signal**. An axis whose **only**
> constraint signal is an *unintersected/indeterminate* polygon is **non-disponible**
> (§3.4.0) — but an axis already grounded by zone-grain facts (BDZI/GRHQ queries) stays
> **available** with the hypothetical polygon merely lowering `confidence`. Unknown ≠
> favourable.

**Timing (20 %)** — separate **horizon** (long ≠ bad; VISION §9) from **competitive visibility**:
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
> `confirmed: false`); "aqueduc/égout services" must be sourced.

**Valeur marché (15 %)** — comparables/permits/absorption (full 0-5):
| Lvl | Description |
|---|---|
| 0 | No market / declining absorption. |
| 1 | Weak (high vacancy, slow absorption). |
| 2 | Soft (below-average zone demand). |
| 3 | Moderate (active demand, balanced — zone-level comparables present). |
| 4 | Strong (tight, above-average absorption with zone comparables). |
| 5 | Very tight (near-zero vacancy + zone comparables confirming a premium). |

> **Tier C → non-disponible by default.** The axis measures **zone-level** valuation/
> absorption. JLR/Centris zone comparables are paid and absent in all pilots. MRC
> permits and CMHC vacancy are **regional-grain** data — a *different scale* (§3.4.0):
> they raise/lower dossier **confidence/context**, they **do not place a level** on the
> zone market scale. Never fabricate. Absent zone-grain comparables, the axis is
> non-disponible and the recommendation is capped (§3.4).

### 3.4.0 Availability doctrine — the boundary (review blocker, resolved)
An axis is **`available`** when at least one piece of evidence places a level on
**that axis's own measurement scale, at the grain the axis measures**, even if a
sub-component is hypothetical (which lowers `confidence`, not availability). An axis is
**`non-disponible`** when no evidence places a level at the axis's grain — *unknown is
not a low level, it is no level*.

This resolves the apparent §3.3↔§5 contradiction **without asymmetry**:
- **Risk** is grounded by **zone-grain facts** (BDZI REST = 0 flood, GRHQ hydrography
  queried on the zone bbox) → **available**; the unconfirmed CPTAQ polygon intersection
  is a sub-component hypothesis → `confidence: low`, not non-disponible.
- **Market** has **no zone-grain evidence** (zone comparables absent; MRC/CMHC are
  regional) → **non-disponible**. The difference from risk is *factual* (risk has
  zone-grain data, market does not), not a double standard.

### 3.4 Non-disponible handling — renormalization + recommendation cap (robust)
1. **Classify each axis** by the §3.4.0 doctrine: `available` or `non-disponible`.
2. **Renormalize weights over the available axes only** (drop non-disponible, re-scale
   remaining to sum 1). This is a **mean-imputation** of the missing axis (§3.1 note) —
   acceptable *only because* the cap (step 4) blocks engagement.
3. Mark the score **partial** when any axis is non-disponible; expose
   `availableWeightSum` as the honesty meter. **Floor**: if `availableWeightSum < 0.50`
   the dossier is **"too thin to score"** → no numeric score, status forced to
   `surveiller`. (This floor is **wired in code**, not a note.)
4. **Recommendation cap.** When the score is partial, the recommendation is **bounded
   to `{rejeter, surveiller, qualifier-avec-expert}`** — the engagement actions
   (`approcher-propriétaire`, `monter-dossier-acquisition`) are **blocked** until the
   gap is lifted. `qualifier-avec-expert` stays allowed because it is the escalation
   that *lifts* the gap.
   - **Cap is weight-blind in V1 (acknowledged limit):** any non-disponible axis — even
     the 15 % market — triggers the same block as a missing 30 % potentiel. This is a
     deliberate conservative V1 choice (a missing key proof blocks engagement); a
     weight-aware cap is an ÉV7 refinement.
   - **Supersedes the parent wording**: `SPEC_EVOL_PROCESS_E2E.md` §4.3/§4.4/§11 say
     "cap at *surveillance*". ÉV1 caps one notch higher at `qualifier-avec-expert`
     (escalation that lifts the gap). Recorded here as an explicit supersession; the
     parent's one-line wording is reconciled in a separate docs touch (not ÉV1 code scope).
5. **Never fabricate a neutral value.** Unknown ≠ favourable; a non-disponible axis is
   excluded, not scored 2.5.

```ts
// radar-scoring (new package): replaces the naive weightedScore in opportunity.ts
type Availability = "available" | "non-disponible";
interface AxisScore { level: number | null; availability: Availability; /* + envelope §3.5 */ }

const WEIGHT_FLOOR = 0.50;

function aggregate(axes: Record<Axis, AxisScore>, weights: Record<Axis, number>) {
  // invariant: available ⇔ level !== null  (assert, else throw — no silent 0)
  for (const [k, a] of Object.entries(axes)) {
    const ok = (a.availability === "available") === (a.level !== null);
    if (!ok) throw new Error(`axis ${k}: availability/level mismatch`);
  }
  const avail = Object.entries(axes).filter(([, a]) => a.availability === "available");
  const wSum  = avail.reduce((s, [k]) => s + weights[k as Axis], 0);
  const partial = avail.length < Object.keys(axes).length;
  if (wSum < WEIGHT_FLOOR) {                       // floor + division-by-zero guard
    return { score: null, partial, availableWeightSum: wSum,
             tooThin: true, recommendationCap: "surveiller" as const };
  }
  const score = avail.reduce((s, [k, a]) => s + (a.level! * weights[k as Axis]) / wSum, 0);
  const cap = partial ? "qualifier-avec-expert" : "monter-dossier-acquisition";
  return { score, partial, availableWeightSum: wSum, tooThin: false, recommendationCap: cap };
}
```

### 3.5 Per-axis score envelope
```ts
interface AxisScore {
  level: number | null;                       // 0-5, null ⇔ non-disponible (invariant §3.4)
  availability: "available" | "non-disponible";
  confidence: "high" | "medium" | "low";      // lowered when the level rests on a hypothesis
  evidenceRefs: string[];                      // sourceId[] backing the level
  rationale: string;
  gridVersion: string;                         // grid the level was scored under (stamp)
}
```
This makes "level rests on a hypothesis" (e.g. CPTAQ adjacency in H-609-4/U-521)
first-class: the axis stays `available` but `confidence: "low"`, feeding the cap logic
and the hover view.

### 3.6 Grid version stamp (recompute engine deferred)
Grids are editable (Grilles view §4) + **version-stamped**: every score stores the
`gridVersion`/`weightsVersion` it was computed under, so a later grid edit is visible
and never silently rewrites a displayed score. The **frozen-past-scores recompute
engine** (re-score on demand under a new version) is **deferred to ÉV3**, when scores
are persisted and re-scored at scale — ÉV1 needs only the stamp for the hover display.

## 4. "Grilles de score" view (configurable) + hover
A screen listing, per axis: weight + the editable 0-5 descriptions + VISION/PROCESS
traceability + version stamp. Every score shown elsewhere displays on hover a
**mini-grid** (0-5, current level highlighted) + **rationale + evidence + confidence +
grid version**. Editing a grid bumps the version stamp (§3.6). UAT: the view renders
the v1 grids of §3.3 and the calibrated pilot scores of §5 with correct
`partial`/`tooThin`/cap badges.

## 5. Calibration on the 3 real pilots
The honest result that locks the grids. By the §3.4.0 doctrine, **market is
`non-disponible` in all three** (no zone-grain comparables; MRC/CMHC are regional), so
each score is **partial over 4 axes** (potentiel/risque/timing/faisabilité), weights
renormalized `30/20/20/15 → /0.85 = 0.353/0.235/0.235/0.176`, `availableWeightSum =
0.85 > 0.50` (above the floor), and **capped at `qualifier-avec-expert`**.

| Axis | H-609-4 | U-521→H-521 | H-143/H-143-1 |
|---|---|---|---|
| Potentiel (0.353) | 4 `available` high | 4 `available` high | 3 `available` high |
| Risque (0.235) | 3 `available` **low** (BDZI/GRHQ facts; CPTAQ A-939 hypothesis) | 2 `available` **low** (canal 159 ha + A-912 hypotheses) | 1 `available` high (CPTAQ A-118 confirmed + GRHQ Saint-Laurent facts) |
| Timing (0.235) | 3 `available` (référendaire open, outcome unknown) | 4 `available` (most advanced) | 4 `available` (PHV completed) |
| Faisabilité (0.176) | 2 `available` low (0 vacant lot, assembly) | 3 `available` low (BO 17 866 m²) | 2 `available` low (large lots, CPTAQ+riverain) |
| **Marché** | **non-disponible** | **non-disponible** | **non-disponible** |
| **Partial score /5** | **3.18** | **3.35** | **2.59** |
| availableWeightSum | 0.85 | 0.85 | 0.85 |
| Recommendation (capped) | Surveiller | Qualifier avec expert | Surveiller avec prudence |

Notes:
- **Availability follows the §3.4.0 grain doctrine**: risk is `available` (BDZI/GRHQ
  are zone-grain facts) with `confidence: low` where the CPTAQ piece is hypothetical;
  market is `non-disponible` (only regional-grain data). No double standard.
- The partial scores (3.18 / 3.35 / 2.59) sit close to — and for 2 of 3 **above** — the
  old naive 5-axis values (3.15 / 3.30 / 2.65), because dropping market imputes the mean
  (§3.1). The honesty is the explicit `partial` + blocked engagement, not a lower number.
- This table is regenerated by the calibration test (§7) so it cannot drift from code.

## 6. Micro-rules (v4 review) — ÉV1 ships shapes/intent, enforcement deferred
1. **Append-only journal** — shape + `supersedes` in ÉV1 (§2.4); Postgres role-level
   `UPDATE`/`DELETE` revocation deferred to when a writer exists (ÉV3).
2. **Default PII masking** — *intent* recorded: owner/personal info is masked at display
   by default (Loi 25), reveal access-journaled. The pilots already exclude owner names
   (LFM art. 72), so ÉV1 has nothing to mask (Grilles view shows no owner); **enforcement
   lands when a view first displays owner data (ÉV3/ÉV4)**.
3. **Micro-lot contiguity detection** — `assemblyClusterId` instead of blind area
   exclusion (§2.1).

## 7. Schema/code migration summary
- `packages/radar-domain/src/schemas/`: new `Signal` (§2.0) + `signalId` on dossier;
  lot `confirmed`/`zonePolygonSource`(+`other`)/`assemblyClusterId`/`metadata`;
  `SignalStatus`; `mode` on dossier + journal; `Verification` += `simulé` (3→4);
  `AxisScore` envelope (§3.5); `OpportunityScore` aggregate; timeline + journal-entry shapes.
- New **`packages/radar-scoring`** package: grids (v1 defaults §3.3), `aggregate()` with
  the availability doctrine + renormalization + floor + cap + invariant guards (§3.4),
  grid version stamp (§3.6), pre-filter + contiguity helpers (§2.1).
- `packages/radar-domain/src/valleyfield-dossiers.ts`: migrate the 3 pilots to the
  enriched model (axis envelopes; market non-disponible; `mode: "real"`) — the
  calibration fixture.
- New UI: `ui/src/lib/components/scoring/**` (Grilles view §4) + hover mini-grid.
- `api/drizzle/*.sql`: max 1 additive migration (journal table with `mode` + `supersedes`
  + per-axis envelope columns). **Grant-hardening NOT in this migration** (deferred §6).

## 8. Acceptance criteria
1. `aggregate()` renormalizes over available axes, **guards `wSum`/floor 0.50** (no NaN,
   `tooThin` path), enforces the `available ⇔ level≠null` invariant, and never invents a
   neutral level; unit tests cover all-available, one-non-disponible, market-non-disponible,
   all-non-disponible (tooThin), and the invariant violation (throws).
2. A partial score caps the recommendation to `qualifier-avec-expert`; engagement actions
   are unreachable while any axis is non-disponible.
3. The calibration test reproduces §5 (3.18 / 3.35 / 2.59, all partial, all capped) from
   the migrated pilot fixtures.
4. `Signal` + `signalId` exist and a signal can fan out to N dossiers (1→N link tested).
5. Real and simulation decisions are **partitioned by `mode`**: a simulation decision
   never appears in a real-mode journal query (tested).
6. Editing a grid bumps the version stamp; scores keep their stamped version (no silent
   retroactive rewrite — recompute engine is ÉV3).
7. The Grilles view renders the v1 grids + hover envelope; UAT on root `dev` ports.
8. Lot pre-filters drop sub-threshold lots **except** contiguous assembly clusters
   (shared `assemblyClusterId`).
9. The journal append-only *shape* rejects in-app edits; corrections use `supersedes`.

## 9. Open questions / deferred
- Exact contiguity adjacency test (shared edge vs buffer distance) — needs confirmed
  cadastre geometry, today unavailable; ÉV1 ships the `assemblyClusterId` + hypothesis
  path, the geometric test lands when zone polygons arrive (ÉV2/ÉV4 ingestion).
- T1 sub-type values (5–7 band) for the added signal types — confirm with VISION owner.
- (Resolved in v2: availability doctrine §3.4.0, weight floor 0.50 wired §3.4, Signal
  entity §2.0, real/sim `mode` §2.7, cap supersession §3.4, `simulé` migration §7.)
