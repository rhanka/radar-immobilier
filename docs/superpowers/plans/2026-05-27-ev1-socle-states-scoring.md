# ÉV1 Socle — States Model + Scoring Grids Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared states + scoring foundation (enriched domain schemas, a new `@radar/scoring` package with availability-aware aggregation, the 3-pilot calibration, and a configurable Grilles view) that every later evolution reuses.

**Architecture:** `@radar/domain` stays pure Zod types — it gains the `Signal` entity, the per-axis `AxisScore` envelope, `JournalEntry`, the `mode` discriminator and lot enrichment. A new `@radar/scoring` package owns the v1 grids, the robust `aggregate()` (availability doctrine → renormalization → 0.50 floor → recommendation cap, with input validation), pre-filter + contiguity helpers, and the real/sim boundary filter. The 3 Valleyfield pilots migrate to the new envelope and a calibration test pins `3.18 / 3.35 / 2.59`. The Grilles Svelte view renders the grids + hover envelope.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Zod 3, Vitest, Svelte 5, npm workspaces, Make-only (`make … ENV=test-socle-states-scoring`, `ENV` last).

**Spec:** `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` (v2.1). **Branch contract:** `plan/EV1-BRANCH_feat-socle-states-scoring.md`.

**Conventions every task follows:**
- All imports between local modules use the `.js` extension (ESM), e.g. `import { Signal } from "./signal.js"`.
- New schema files are re-exported from `packages/radar-domain/src/schemas/index.ts`.
- Tests are `*.test.ts` next to the source, `import { describe, it, expect } from "vitest"`.
- Per-task verification: `make typecheck ENV=test-socle-states-scoring` then `make test ENV=test-socle-states-scoring` (packages) / `make test-ui ENV=test-socle-states-scoring` (UI). Commit with `make commit MSG="…"` (no `git add -A`; stage named files).

---

## File structure

| File | Responsibility |
|---|---|
| `packages/radar-domain/src/schemas/common.ts` | add `Mode` enum; extend `Verification` with `simulé` |
| `packages/radar-domain/src/schemas/signal.ts` (new) | `SignalType`, `SignalStatus`, `Signal` |
| `packages/radar-domain/src/schemas/journal.ts` (new) | `Action`, `JournalEntry`, `TimelineEvent` |
| `packages/radar-domain/src/schemas/score.ts` (new) | `Axis`, `AxisScore` (refine invariant), `OpportunityScore` |
| `packages/radar-domain/src/schemas/opportunity.ts` | lot enrichment, `signalId`, `mode`; keep legacy `weightedScore` until Task 10 |
| `packages/radar-scoring/` (new package) | grids + `aggregate()` + pre-filters + contiguity + real/sim filter |
| `packages/radar-domain/src/valleyfield-dossiers.ts` | migrate to envelope + `@radar/scoring`; calibration |
| `packages/radar-domain/src/valleyfield-dossiers.test.ts` (new) | calibration test (3.18/3.35/2.59) |
| `ui/src/lib/components/scoring/GrillesView.svelte` (new) + `ScoreHover.svelte` (new) | configurable grids + hover |
| `ui/src/lib/scoring/grilles-data.ts` (new) + `.test.ts` | UI-side grid presentation data |
| `api/drizzle/000X_socle_journal_scores.sql` (new, EV1-EX1) | append-only journal + per-axis columns |

---

## Task 1: `common.ts` — `Mode` + `Verification += simulé`

**Files:** Modify `packages/radar-domain/src/schemas/common.ts`; Test `packages/radar-domain/src/schemas/common.test.ts` (create).

> Note: `Verification`/`Confidence` are currently declared in `opportunity.ts`. This task introduces the shared `Mode` and the 4-value `Verification` in `common.ts` and re-points `opportunity.ts` to import them (Task 3). Check `common.ts` for an existing `Verification`/`Confidence` first; if absent, add here.

- [ ] **Step 1: Write the failing test**
```ts
// common.test.ts
import { describe, it, expect } from "vitest";
import { Mode, Verification } from "./common.js";

describe("Mode", () => {
  it("accepts real and simulation", () => {
    expect(Mode.safeParse("real").success).toBe(true);
    expect(Mode.safeParse("simulation").success).toBe(true);
    expect(Mode.safeParse("prod").success).toBe(false);
  });
});

describe("Verification", () => {
  it("has 4 values including simulé", () => {
    for (const v of ["fait", "hypothese", "non-disponible", "simulé"])
      expect(Verification.safeParse(v).success).toBe(true);
  });
});
```
- [ ] **Step 2: Run to verify it fails** — `make test ENV=test-socle-states-scoring` → FAIL (`Mode`/`simulé` undefined).
- [ ] **Step 3: Implement**
```ts
// common.ts — append
import { z } from "zod";
export const Mode = z.enum(["real", "simulation"]);
export type ModeT = z.infer<typeof Mode>;
export const Verification = z.enum(["fait", "hypothese", "non-disponible", "simulé"]);
export type VerificationT = z.infer<typeof Verification>;
```
- [ ] **Step 4: Run to verify it passes** — `make test ENV=test-socle-states-scoring` → PASS.
- [ ] **Step 5: Commit** — `git add packages/radar-domain/src/schemas/common.ts packages/radar-domain/src/schemas/common.test.ts && make commit MSG="feat(domain): Mode enum + Verification simulé value"`

---

## Task 2: `signal.ts` — Signal entity (T1)

**Files:** Create `packages/radar-domain/src/schemas/signal.ts` + `signal.test.ts`; Modify `schemas/index.ts`.

- [ ] **Step 1: Write the failing test**
```ts
// signal.test.ts
import { describe, it, expect } from "vitest";
import { Signal, SignalType, SignalStatus } from "./signal.js";

const base = {
  id: "sig-1", type: "residential-rezoning", value: 10, confidence: "high",
  status: "nouveau", sourceRefs: ["avis-1"], detectedAt: "2026-02-25", mode: "real",
};

describe("Signal", () => {
  it("accepts a valid residential-rezoning signal", () => {
    expect(Signal.safeParse(base).success).toBe(true);
  });
  it("rejects an out-of-range value (>10)", () => {
    expect(Signal.safeParse({ ...base, value: 11 }).success).toBe(false);
  });
  it("rejects an unknown type", () => {
    expect(SignalType.safeParse("nope").success).toBe(false);
  });
  it("enumerates the 4 statuses", () => {
    for (const s of ["nouveau", "à-approfondir", "écarté", "surveillance"])
      expect(SignalStatus.safeParse(s).success).toBe(true);
  });
});
```
- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).
- [ ] **Step 3: Implement**
```ts
// signal.ts
import { z } from "zod";
import { Confidence } from "./opportunity.js";   // reuse existing Confidence
import { Mode } from "./common.js";

export const SignalType = z.enum([
  "residential-rezoning", "cptaq", "ppcmoi", "derogation-relevant",
  "political-intention", "public-consultation", "plan-urbanisme",
  "grid-cos-modification", "requalification-tod", "public-investment",
  "derogation-irrelevant",
]);
export type SignalTypeT = z.infer<typeof SignalType>;

export const SignalStatus = z.enum(["nouveau", "à-approfondir", "écarté", "surveillance"]);
export type SignalStatusT = z.infer<typeof SignalStatus>;

export const Signal = z.object({
  id: z.string().min(1),
  type: SignalType,
  value: z.number().min(0).max(10),        // /10 triage prior — never multiplied by confidence
  confidence: Confidence,
  status: SignalStatus,
  sourceRefs: z.array(z.string()).default([]),
  detectedAt: z.string().min(4),
  bylaw: z.string().optional(),
  zone: z.string().optional(),
  mode: Mode.default("real"),
});
export type SignalT = z.infer<typeof Signal>;
```
- [ ] **Step 4: Add the T1 type→value default table (spec §3.2)** — append to `signal.ts`:
```ts
// Default /10 triage prior per type (VISION §6). value + confidence are NEVER multiplied.
export const SIGNAL_TYPE_VALUES: Record<SignalTypeT, number> = {
  "residential-rezoning": 10, "cptaq": 8, "ppcmoi": 7, "derogation-relevant": 5,
  "political-intention": 6, "public-consultation": 6, "plan-urbanisme": 7,
  "grid-cos-modification": 6, "requalification-tod": 7, "public-investment": 5,
  "derogation-irrelevant": 1,
};
```
and a test: `expect(SIGNAL_TYPE_VALUES["cptaq"]).toBeGreaterThan(SIGNAL_TYPE_VALUES["ppcmoi"])` (CPTAQ 8 > PPCMOI 7, spec §3.2).
- [ ] **Step 5: Re-export** — add `export * from "./signal.js";` to `schemas/index.ts`.
- [ ] **Step 6: Run to verify it passes** — `make test ENV=test-socle-states-scoring` → PASS.
- [ ] **Step 7: Commit** — stage `signal.ts`, `signal.test.ts`, `schemas/index.ts` → `make commit MSG="feat(domain): Signal entity (T1) + SignalType/SignalStatus + type→value table"`

---

## Task 3: `opportunity.ts` — lot enrichment, `signalId`, `mode`

**Files:** Modify `packages/radar-domain/src/schemas/opportunity.ts`; extend `opportunity.test.ts`.

- [ ] **Step 1: Write the failing test** (append to `opportunity.test.ts`)
```ts
import { OpportunityDossier } from "./opportunity.js";
describe("OpportunityDossier ÉV1 enrichment", () => {
  const minimal = {
    id: "d1", title: "t", bylaw: "150-49", zone: "H-609-4", address: "a",
    signalId: "sig-1", mode: "real",
    lots: [{ noLot: "1", confirmed: false, zonePolygonSource: "hypothese-street-name" }],
    evidence: [], scores: { potentiel: 4, risque: 3, timing: 3, faisabilite: 2, marche: 3 },
    scoreGlobal: 3.15, recommendation: "Surveiller",
  };
  it("requires signalId and accepts the lot enrichment fields", () => {
    expect(OpportunityDossier.safeParse(minimal).success).toBe(true);
  });
  it("rejects an unknown zonePolygonSource", () => {
    const bad = structuredClone(minimal);
    bad.lots[0].zonePolygonSource = "satellite";
    expect(OpportunityDossier.safeParse(bad).success).toBe(false);
  });
});
```
- [ ] **Step 2: Run to verify it fails** — FAIL (`signalId` unknown / strict lot shape).
- [ ] **Step 3: Implement** — in `opportunity.ts`, replace the inline `Verification`/`Confidence` with imports from `common.ts` (keep `Confidence` exported here for `signal.ts`), and extend the lot + dossier:
```ts
import { Mode, Verification } from "./common.js";   // Verification now from common (4 values)

export const ZonePolygonSource = z.enum([
  "open-data-ckan", "wms-municipal", "vectorised-pdf", "hypothese-street-name", "other",
]);

// inside OpportunityDossier.lots[] object:
//   noLot: z.string(),
//   matricule: z.string().optional(),
//   superficie: z.string().optional(),
//   usage: z.string().optional(),
//   valeur: z.string().optional(),
       confirmed: z.boolean().default(false),
       zonePolygonSource: ZonePolygonSource.default("hypothese-street-name"),
       assemblyClusterId: z.string().optional(),
       metadata: z.record(z.unknown()).optional(),

// top-level OpportunityDossier additions:
  signalId: z.string().min(1),
  mode: Mode.default("real"),
```
Remove the now-duplicated local `Verification`/`Confidence` enum *definitions* if they moved to `common.ts` (re-export `Confidence` from here so `signal.ts` import keeps working: `export { Confidence } from "./...";` — or keep `Confidence` defined here and only move `Verification`).
- [ ] **Step 4: Run to verify it passes** — `make typecheck ENV=test-socle-states-scoring` + `make test ENV=test-socle-states-scoring` → PASS.
- [ ] **Step 5: Commit** — `make commit MSG="feat(domain): lot confirmed/zonePolygonSource/metadata + dossier signalId/mode"`

---

## Task 4: `score.ts` — `AxisScore` envelope + `OpportunityScore`; `journal.ts`

**Files:** Create `packages/radar-domain/src/schemas/score.ts` + `score.test.ts`, `journal.ts` + `journal.test.ts`; update `schemas/index.ts`.

- [ ] **Step 1: Write the failing test (`score.test.ts`)**
```ts
import { describe, it, expect } from "vitest";
import { AxisScore, Axis } from "./score.js";

describe("AxisScore invariant (available ⇔ level≠null)", () => {
  it("accepts available with a level", () => {
    expect(AxisScore.safeParse({ level: 3, availability: "available",
      confidence: "low", evidenceRefs: ["e"], rationale: "r", gridVersion: "v1" }).success).toBe(true);
  });
  it("accepts non-disponible with null level", () => {
    expect(AxisScore.safeParse({ level: null, availability: "non-disponible",
      confidence: "low", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(true);
  });
  it("rejects available with null level", () => {
    expect(AxisScore.safeParse({ level: null, availability: "available",
      confidence: "low", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(false);
  });
  it("rejects a level out of [0,5]", () => {
    expect(AxisScore.safeParse({ level: 6, availability: "available",
      confidence: "high", evidenceRefs: [], rationale: "r", gridVersion: "v1" }).success).toBe(false);
  });
  it("lists the 5 axes", () => {
    for (const a of ["potentiel","risque","timing","faisabilite","marche"])
      expect(Axis.safeParse(a).success).toBe(true);
  });
});
```
- [ ] **Step 2: Run to verify it fails** — FAIL (module not found).
- [ ] **Step 3: Implement (`score.ts`)**
```ts
import { z } from "zod";
import { Confidence } from "./opportunity.js";

export const Axis = z.enum(["potentiel", "risque", "timing", "faisabilite", "marche"]);
export type AxisT = z.infer<typeof Axis>;
export const Availability = z.enum(["available", "non-disponible"]);

export const AxisScore = z.object({
  level: z.number().min(0).max(5).nullable(),
  availability: Availability,
  confidence: Confidence,
  evidenceRefs: z.array(z.string()).default([]),
  rationale: z.string(),
  gridVersion: z.string(),
}).refine(
  (a) => (a.availability === "available") === (a.level !== null),
  { message: "invariant: available ⇔ level !== null" },
);
export type AxisScoreT = z.infer<typeof AxisScore>;

export const OpportunityScore = z.object({
  axes: z.record(Axis, AxisScore),
  weightsVersion: z.string(),
  partial: z.boolean(),
  tooThin: z.boolean(),
  score: z.number().min(0).max(5).nullable(),
  availableWeightSum: z.number(),
  recommendationCap: z.enum(["surveiller", "qualifier-avec-expert", "monter-dossier-acquisition"]),
});
export type OpportunityScoreT = z.infer<typeof OpportunityScore>;
```
- [ ] **Step 4: Write + implement `journal.ts`**
```ts
// journal.test.ts
import { describe, it, expect } from "vitest";
import { JournalEntry, Action } from "./journal.js";
describe("JournalEntry", () => {
  it("accepts an append-only decision with mode + supersedes", () => {
    expect(JournalEntry.safeParse({ id: "j2", who: "fabien", role: "PRINCIPAL",
      action: "qualifier-avec-expert", target: "d1", at: "2026-05-27T00:00:00Z",
      mode: "real", supersedes: "j1" }).success).toBe(true);
  });
  it("orders the engagement taxonomy", () => {
    expect(Action.options).toEqual([
      "rejeter","surveiller","qualifier-avec-expert","approcher-propriétaire","monter-dossier-acquisition"]);
  });
});
```
```ts
// journal.ts
import { z } from "zod";
import { Mode } from "./common.js";
export const Action = z.enum([
  "rejeter","surveiller","qualifier-avec-expert","approcher-propriétaire","monter-dossier-acquisition"]);
export const JournalEntry = z.object({
  id: z.string(), who: z.string(), role: z.string(),
  action: z.string(), target: z.string(), at: z.string(),
  rationale: z.string().optional(), mode: Mode, supersedes: z.string().optional(),
});
export const TimelineEvent = z.object({ at: z.string(), kind: z.string(), ref: z.string(), note: z.string().optional() });
export type JournalEntryT = z.infer<typeof JournalEntry>;
```
- [ ] **Step 5: Re-export + run** — add `export * from "./score.js"; export * from "./journal.js";` to `schemas/index.ts`; `make test ENV=test-socle-states-scoring` → PASS.
- [ ] **Step 6: Commit** — `make commit MSG="feat(domain): AxisScore envelope (refine invariant) + OpportunityScore + JournalEntry"`

---

## Task 5: Scaffold `@radar/scoring` package

**Files:** Create `packages/radar-scoring/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`.

- [ ] **Step 1: Failing smoke test (`src/index.test.ts`)**
```ts
import { describe, it, expect } from "vitest";
import { GRID_VERSION } from "./index.js";
describe("@radar/scoring", () => { it("exposes a grid version", () => { expect(GRID_VERSION).toBe("v1"); }); });
```
- [ ] **Step 2: Create `package.json`** (mirror `@radar/domain`)
```json
{
  "name": "@radar/scoring", "version": "0.0.0", "private": true, "type": "module",
  "description": "Availability-aware opportunity scoring (grids, aggregate, pre-filters) for radar-immobilier.",
  "license": "UNLICENSED", "main": "./src/index.ts", "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "@radar/domain": "*", "zod": "^3.23.8" },
  "devDependencies": { "typescript": "5.4.5", "vitest": "^1.6.0" }
}
```
- [ ] **Step 3: Create `tsconfig.json`** — `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src/**/*.ts"] }`
- [ ] **Step 4: Create `src/index.ts`** — `export const GRID_VERSION = "v1";` (grids/aggregate added next tasks). Install workspace link: `make install ENV=test-socle-states-scoring`.
- [ ] **Step 5: Run** — `make typecheck ENV=test-socle-states-scoring` + `make test ENV=test-socle-states-scoring` → PASS.
- [ ] **Step 6: Commit** — `make commit MSG="feat(scoring): scaffold @radar/scoring package"`

---

## Task 6: v1 grids (5 axes, 0-5 + weights)

**Files:** Create `packages/radar-scoring/src/grids.ts` + `grids.test.ts`.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { GRIDS, WEIGHTS } from "./grids.js";
describe("v1 grids", () => {
  it("has 5 axes with weights summing to 1", () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Object.keys(GRIDS).sort()).toEqual(["faisabilite","marche","potentiel","risque","timing"]);
    expect(Math.round(sum * 100) / 100).toBe(1);
  });
  it("each axis defines all 6 levels 0..5", () => {
    for (const g of Object.values(GRIDS))
      expect(Object.keys(g.levels).map(Number).sort((a,b)=>a-b)).toEqual([0,1,2,3,4,5]);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `grids.ts` with `WEIGHTS = { potentiel:0.30, risque:0.20, timing:0.20, faisabilite:0.15, marche:0.15 }` and a `GRIDS` record keyed by axis, each `{ axis, weight, version:"v1", levels: {0:"…",1:"…",2:"…",3:"…",4:"…",5:"…"} }` using the exact 0-5 wording from spec §3.3 (potentiel, risque inverted, timing, faisabilité, marché full 0-5). Mirror text verbatim from `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` §3.3.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `make commit MSG="feat(scoring): v1 scoring grids (5 axes, 0-5, weights 30/20/20/15/15)"`

---

## Task 7: `aggregate()` — availability doctrine + renorm + floor + cap + validation

**Files:** Create `packages/radar-scoring/src/aggregate.ts` + `aggregate.test.ts`.

- [ ] **Step 1: Failing tests (cover every AC #1 case)**
```ts
import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregate.js";
import { WEIGHTS } from "./grids.js";
const A = (level, availability="available", confidence="high") =>
  ({ level, availability, confidence, evidenceRefs: [], rationale: "", gridVersion: "v1" });
const ND = A(null, "non-disponible", "low");

describe("aggregate", () => {
  it("all available → exact weighted score, not partial, full cap", () => {
    const r = aggregate({ potentiel:A(4), risque:A(3), timing:A(3), faisabilite:A(2), marche:A(3) }, WEIGHTS);
    expect(r.partial).toBe(false);
    expect(r.recommendationCap).toBe("monter-dossier-acquisition");
    expect(Math.round(r.score*100)/100).toBe(3.15);
  });
  it("market non-disponible → renormalized over 0.85, partial, capped at qualifier-avec-expert", () => {
    const r = aggregate({ potentiel:A(4), risque:A(3), timing:A(3), faisabilite:A(2), marche:ND }, WEIGHTS);
    expect(r.partial).toBe(true);
    expect(r.availableWeightSum).toBeCloseTo(0.85, 5);
    expect(r.recommendationCap).toBe("qualifier-avec-expert");
    expect(Math.round(r.score*100)/100).toBe(3.18);
  });
  it("all non-disponible → tooThin, score null, no NaN, cap surveiller", () => {
    const nd = { potentiel:ND, risque:ND, timing:ND, faisabilite:ND, marche:ND };
    const r = aggregate(nd, WEIGHTS);
    expect(r.tooThin).toBe(true); expect(r.score).toBeNull(); expect(r.recommendationCap).toBe("surveiller");
  });
  it("availableWeightSum below 0.50 floor → tooThin", () => {
    const r = aggregate({ potentiel:ND, risque:ND, timing:ND, faisabilite:A(4), marche:A(5) }, WEIGHTS); // 0.30
    expect(r.tooThin).toBe(true);
  });
  it("throws on level out of [0,5]", () => {
    expect(() => aggregate({ potentiel:A(6), risque:A(3), timing:A(3), faisabilite:A(2), marche:A(3) }, WEIGHTS)).toThrow();
  });
  it("throws on missing/NaN weight", () => {
    const w = { ...WEIGHTS, marche: NaN };
    expect(() => aggregate({ potentiel:A(4), risque:A(3), timing:A(3), faisabilite:A(2), marche:A(3) }, w)).toThrow();
  });
  it("throws on unknown axis", () => {
    expect(() => aggregate({ potentiel:A(4), risque:A(3), timing:A(3), faisabilite:A(2), marche:A(3), bogus:A(1) } , WEIGHTS)).toThrow();
  });
  it("throws on availability/level mismatch", () => {
    expect(() => aggregate({ potentiel:A(null), risque:A(3), timing:A(3), faisabilite:A(2), marche:A(3) }, WEIGHTS)).toThrow();
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `aggregate.ts`** — copy the validated `aggregate()` from spec §3.4 verbatim (the `AXES`-driven version with `WEIGHT_FLOOR = 0.50`, input validation throwing on unknown axis / bad weight / mismatch / level out of `[0,5]`, the `tooThin` path, and the cap). Import `Axis` levels from `@radar/domain` `AxisScore` type.
- [ ] **Step 4: Run** → PASS (all 8 cases, incl. `3.15` full and `3.18` partial).
- [ ] **Step 5: Commit** — `make commit MSG="feat(scoring): robust availability-aware aggregate (renorm + 0.50 floor + cap + input validation)"`

---

## Task 8: Pre-filters + micro-lot contiguity

**Files:** Create `packages/radar-scoring/src/prefilter.ts` + `prefilter.test.ts`.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { applyPreFilters, DEFAULT_PREFILTERS } from "./prefilter.js";
const lot = (noLot, areaM2, confirmed=true) => ({ noLot, areaM2, confirmed });
describe("pre-filters", () => {
  it("drops a sub-350 m² isolated lot", () => {
    const out = applyPreFilters([lot("a", 200)], DEFAULT_PREFILTERS, []);
    expect(out.kept.map(l => l.noLot)).toEqual([]);
  });
  it("keeps sub-threshold lots that are contiguous as an assembly cluster", () => {
    const out = applyPreFilters([lot("a", 200), lot("b", 200)], DEFAULT_PREFILTERS, [["a","b"]]);
    expect(out.kept.map(l => l.noLot).sort()).toEqual(["a","b"]);
    expect(out.kept.every(l => l.assemblyClusterId)).toBe(true);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `DEFAULT_PREFILTERS = { minLotAreaM2: 350, maxBuildingToLandValueRatio: 0.80, excludeRecentBuiltMicroLots: true }`. `applyPreFilters(lots, cfg, contiguityGroups)` keeps a lot if it passes `minLotAreaM2` **or** belongs to a contiguity group (assign a shared `assemblyClusterId`); returns `{ kept, dropped }`. Contiguity input is a list of lot-id groups (geometric test deferred per spec §9; this consumes precomputed groups).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `make commit MSG="feat(scoring): physical pre-filters + micro-lot contiguity (assemblyClusterId)"`

---

## Task 9: Real/sim boundary filter

**Files:** Create `packages/radar-scoring/src/real-boundary.ts` + `real-boundary.test.ts`.

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { filterRealMode } from "./real-boundary.js";
const rows = [
  { id: "1", mode: "real" }, { id: "2", mode: "simulation" },
];
const evidence = [
  { sourceId: "e1", verification: "fait" }, { sourceId: "e2", verification: "simulé" },
];
describe("real-mode boundary (§2.7)", () => {
  it("excludes simulation-mode rows", () => {
    expect(filterRealMode(rows).map(r => r.id)).toEqual(["1"]);
  });
  it("excludes simulé evidence", () => {
    expect(filterRealMode(evidence, "verification").map(e => e.sourceId)).toEqual(["e1"]);
  });
});
```
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** — `filterRealMode(items, key?)`: drop items with `mode === "simulation"` and, when iterating evidence, drop `verification === "simulé"`. A small, typed helper used by real exports/queries.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `make commit MSG="feat(scoring): real-mode boundary filter (mode simulation + simulé evidence)"`

---

## Task 10: Migrate the 3 pilots + calibration test

**Files:** Modify `packages/radar-domain/src/valleyfield-dossiers.ts`; Create `valleyfield-dossiers.test.ts`. (`@radar/domain` adds `@radar/scoring` as a dep — Step 0.)

- [ ] **Step 0:** add `"@radar/scoring": "*"` to `packages/radar-domain/package.json` deps; `make install ENV=test-socle-states-scoring`.
- [ ] **Step 1: Write the failing calibration test**
```ts
import { describe, it, expect } from "vitest";
import { valleyfieldDossiers } from "./valleyfield-dossiers.js";
const expected: Record<string, number> = {
  "valleyfield-h609-4-regl150-49": 3.18,
  "valleyfield-u521-h521-regl150-51": 3.35,
  "valleyfield-h143-h143-1-regl150-49-1": 2.59,
};
describe("calibration (spec §5)", () => {
  it("each pilot is partial, capped at qualifier-avec-expert, market non-disponible", () => {
    for (const d of valleyfieldDossiers) {
      expect(d.opportunityScore.partial).toBe(true);
      expect(d.opportunityScore.recommendationCap).toBe("qualifier-avec-expert");
      expect(d.opportunityScore.axes.marche.availability).toBe("non-disponible");
      expect(Math.round(d.opportunityScore.score * 100) / 100).toBe(expected[d.id]);
    }
  });
});
```
- [ ] **Step 2: Run** → FAIL (`opportunityScore` not on dossiers).
- [ ] **Step 3: Implement** — for each dossier, build the `axes` envelope per spec §5 (potentiel/risque/timing/faisabilité `available` with the calibrated `confidence`; `marche` `non-disponible`, level null), call `aggregate(axes, WEIGHTS)` from `@radar/scoring`, attach `opportunityScore`, set `mode: "real"`, `signalId`, and `confirmed:false`/`zonePolygonSource:"hypothese-street-name"` on lots. Keep `scores`/`scoreGlobal` legacy fields populated for any current consumer, or update consumers (`ui/src/lib/demo/*`) in Task 11.
- [ ] **Step 4: Run** → PASS (3.18 / 3.35 / 2.59, all partial+capped).
- [ ] **Step 5: Commit** — `make commit MSG="feat(domain): migrate 3 pilots to AxisScore envelope + pin calibration (3.18/3.35/2.59)"`

---

## Task 11: Grilles view + hover (UI)

**Files:** Create `ui/src/lib/scoring/grilles-data.ts` (+ `.test.ts`), `ui/src/lib/components/scoring/GrillesView.svelte`, `ui/src/lib/components/scoring/ScoreHover.svelte`. Verify against existing UI test pattern in `ui/src/lib/demo/opportunity-dossiers.test.ts`.

- [ ] **Step 1: Failing data test (`grilles-data.test.ts`)**
```ts
import { describe, it, expect } from "vitest";
import { toGrilleRows } from "./grilles-data.js";
describe("grille presentation", () => {
  it("produces one row per axis with weight % and 6 levels", () => {
    const rows = toGrilleRows();
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveProperty("weightPct");
    expect(Object.keys(rows[0].levels)).toHaveLength(6);
  });
});
```
- [ ] **Step 2: Run** — `make test-ui ENV=test-socle-states-scoring` → FAIL.
- [ ] **Step 3: Implement `grilles-data.ts`** — re-shape `@radar/scoring` `GRIDS`/`WEIGHTS` into `{ axis, label, weightPct, levels }[]` for display.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Implement `GrillesView.svelte`** (Svelte 5 runes) — render each axis row: label, `weightPct`, the 0-5 level descriptions, the v1 version stamp; editable text inputs bound to local state (edit bumps an in-memory version label — persistence is ÉV3). `ScoreHover.svelte` — given an `AxisScore`, show the mini-grid (levels 0-5, current `level` highlighted) + rationale + evidence + confidence + gridVersion + a `partial`/`tooThin` badge.
- [ ] **Step 6: Component test** — mount `GrillesView` (follow `dashboard-layout.test.ts` pattern), assert 5 axis rows + a highlighted level in `ScoreHover` for a `partial` dossier.
- [ ] **Step 7: Run** — `make test-ui ENV=test-socle-states-scoring` → PASS; `make build ENV=test-socle-states-scoring` → OK.
- [ ] **Step 8: UAT** — point root `dev` checkout at this branch (`make dev` from this worktree), verify the Grilles view renders v1 grids + the 3 calibrated pilot scores with correct partial/cap badges at `http://localhost:5301`; restore root afterward.
- [ ] **Step 9: Commit** — `make commit MSG="feat(ui): Grilles de score view + score hover envelope"`

---

## Task 12: Append-only journal migration (EV1-EX1, conditional path)

**Files:** Create `api/drizzle/000X_socle_journal_scores.sql` (number = next in `api/drizzle/`). Declare `EV1-EX1` in the branch `## Feedback Loop` first (reason: persist journal + per-axis score columns; impact: 1 additive migration; rollback: drop table/columns).

- [ ] **Step 1:** Inspect `api/drizzle/` for the latest migration number + the schema style.
- [ ] **Step 2: Write the migration** — additive only: a `decision_journal` table (`id`, `who`, `role`, `action`, `target`, `at timestamptz`, `rationale`, `mode`, `supersedes`) and per-axis score columns (or a `jsonb opportunity_score`) on the opportunities table. **No** `UPDATE`/`DELETE` grant changes (deferred per spec §6).
- [ ] **Step 3: Validate** — `make test ENV=test-socle-states-scoring` boots postgres and applies migrations; confirm green. Add a test asserting an in-app correction uses a new row with `supersedes` (no in-place update path exists in the repository layer).
- [ ] **Step 4: Commit** — `make commit MSG="feat(api): additive migration — decision journal (mode/supersedes) + opportunity score columns"`

---

## Final task: branch close

- [ ] Update `docs/spec/SPEC_EVOL_SOCLE_STATES_SCORING.md` §9 open questions if resolved during build; update `PLAN.md` ÉV1 status; mark the branch plan merge-ready.
- [ ] `make typecheck ENV=test-socle-states-scoring` + `make lint ENV=test-socle-states-scoring` + `make test ENV=test-socle-states-scoring` + `make test-ui ENV=test-socle-states-scoring` + `make build ENV=test-socle-states-scoring` all green.
- [ ] Push; open PR; verify CI green (full 40-char head SHA); merge commit (no squash/rebase); preserve branch; move plan to `plan/done/`.
