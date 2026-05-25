# Vertical slice réel Valleyfield — Implementation Plan

> **For agentic workers:** implement lot-by-lot. Each lot ends with its lot-gate.
> Make-only (no direct docker/npm/node). `ENV=<env>` last in every `make` command.
> Anti-invention rule: every datum carries source+date+confidence, else
> "Information non disponible". Spec: `docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`.

**Goal:** Materialize the PROCESS 6-phase funnel end-to-end on 3 real Valleyfield
opportunities, with a real investigation of available data sources, surfaced as a
demo deep-dive.

**Architecture:** Typed domain model (Zod) in `packages/radar-domain`; a real
source-investigation that fetches public/open data (Données Québec, rôle
open-data, cadastre, geospatial constraints, avis PDF, YouTube) into raw S3 +
traced evidence; 3 populated `OpportunityDossier` fiches; a Svelte demo view
rendering the funnel + evidence + weighted score. Advances BR-06 + BR-07.

**Tech Stack:** TypeScript, Zod (radar-domain), Svelte 5 + DS sentropic (ui),
Données Québec CKAN API, geospatial (GeoJSON), obscura (rendering/fetch), S3
(MinIO local), `yt-dlp`+whisper for YouTube, all via `make`.

## Pilot opportunities
1. **H-609-4** (règl. 150-49) · 2. **U-521→H-521** (règl. 150-51) · 3. **H-143/H-143-1** (règl. 150-49-1).

## Scope / Guardrails
- Root reserved for UAT (`ENV=dev`, fixed ports, http://localhost:5301).
- Dev in `./tmp/feat-vertical-slice-valleyfield`; tests on `ENV=test-vertical-slice`.
- Branch ports (conductor convention): API 8806 / UI 5306 / Maildev 1106 /
  Postgres 5536 / S3 9106-9107 / Obscura 9306 (test env only; never the UAT block).
- Make-only; `ENV` last. Raw docs → S3; structured → versioned Zod (`jsonb` if unstable).
- Anti-invention (VISION/PROMPT + rules/MASTER "Fair Benchmarking").

## Branch Scope Boundaries (MANDATORY)
- **Allowed**: `plan/06V-BRANCH_feat-vertical-slice-valleyfield.md`, `PLAN.md`,
  `docs/spec/SPEC_EVOL_VERTICAL_SLICE_VALLEYFIELD.md`,
  `docs/spec/SPEC_EVOL_DATA_MODEL.md`, `packages/radar-domain/src/**`,
  `packages/radar-sources/src/sources/_spikes/**`,
  `api/src/services/**`, `api/src/routes/**`, `ui/src/**`,
  `docs/investigation/**` (raw findings notes).
- **Forbidden**: `Makefile`, `docker-compose*.yml`, `rules/**`,
  `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`, `plan/NN-BRANCH_*` (others),
  `docs/spec/input/**`, production source adapters outside `_spikes/**`.
- **Conditional**: `api/drizzle/*.sql` (max 1 additive migration if a dossier
  table is needed — prefer jsonb), `package.json`/`-lock` (only if a lib like a
  CKAN/geo/transcription client is strictly required; prefer existing + obscura).

## Orchestration Mode
- [x] Multi-agent: investigation lots are parallelizable per source layer /
  opportunity (disjoint paths). Conductor verifies scope before concurrent writes.

## UAT Management
- UAT on root fixed ports (http://localhost:5301) once the demo view renders the
  3 dossiers. Never a per-branch UAT port.

---

## Lot 0 — Baseline & branch
- [ ] Read `rules/MASTER.md`, `rules/sources.md`, `rules/scoring.md`,
  `docs/spec/input/{VISION,PROMPT,PROCESS}.md`, this spec.
- [ ] Worktree `./tmp/feat-vertical-slice-valleyfield` confirmed; `tmp/` ignored.
- [ ] Confirm `ENV=test-vertical-slice` mapping + branch ports above.
- [ ] Lot gate: `make ps-all` shows no port clash for the branch block.

## Lot 1 — Domain model (TDD)
**Files:** Create `packages/radar-domain/src/schemas/opportunity.ts`,
`packages/radar-domain/src/schemas/opportunity.test.ts`.
- [ ] Step 1 — failing test `opportunity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EvidenceItem, SourceRole, OpportunityDossier, PROCESS_WEIGHTS, weightedScore } from "./opportunity";

describe("opportunity schemas", () => {
  it("validates an evidence item with traceability", () => {
    const ev = EvidenceItem.parse({
      phase: "signal", sourceId: "avis-publics-valleyfield",
      label: "Avis 150-49", url: "https://x/y.pdf", date: "2026-02-25",
      obtentionMode: "download", confidence: "high", verification: "fait", value: "densité 50 log/ha",
    });
    expect(ev.phase).toBe("signal");
  });
  it("rejects an evidence item missing a source url when verified", () => {
    expect(() => EvidenceItem.parse({
      phase: "signal", sourceId: "x", label: "y", date: "2026-01-01",
      obtentionMode: "download", confidence: "low", verification: "fait",
    })).toThrow();
  });
  it("computes the PROCESS weighted score (30/20/20/15/15)", () => {
    expect(PROCESS_WEIGHTS).toEqual({ potentiel: 0.30, risque: 0.20, timing: 0.20, faisabilite: 0.15, marche: 0.15 });
    expect(weightedScore({ potentiel: 5, risque: 4, timing: 5, faisabilite: 3, marche: 2 })).toBeCloseTo(4.05, 2);
  });
});
```

- [ ] Step 2 — run, expect FAIL: `make test-ui SCOPE=... ENV=test-vertical-slice` (radar-domain test runner) — adjust target to the domain package test command actually wired.
- [ ] Step 3 — implement `opportunity.ts`:

```ts
import { z } from "zod";

export const Phase = z.enum(["signal","ancrage","contraintes","marche","contexte","scoring"]);
export const Verification = z.enum(["fait","hypothese","non-disponible"]);
export const Confidence = z.enum(["high","medium","low"]);

export const EvidenceItem = z.object({
  phase: Phase,
  sourceId: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url().optional(),
  date: z.string().min(4),
  obtentionMode: z.enum(["download","api","scraping","ocr-llm","transcription","manual"]),
  confidence: Confidence,
  verification: Verification,
  value: z.string().optional(),
}).refine((e) => e.verification !== "fait" || !!e.url, {
  message: "a verified ('fait') evidence item requires a source url",
});

export const SourceRole = z.object({
  sourceId: z.string(), phase: Phase, role: z.string(),
  tier: z.enum(["A","B","C"]),
  accessibilite: z.enum(["public-free","public-api","account","paid","manual","excluded"]),
});

export const ScoreSet = z.object({
  potentiel: z.number().min(0).max(5), risque: z.number().min(0).max(5),
  timing: z.number().min(0).max(5), faisabilite: z.number().min(0).max(5),
  marche: z.number().min(0).max(5),
});

export const OpportunityDossier = z.object({
  id: z.string(), title: z.string(), bylaw: z.string(), zone: z.string(),
  address: z.string(),
  lots: z.array(z.object({ noLot: z.string(), matricule: z.string().optional(),
    superficie: z.string().optional(), usage: z.string().optional(),
    valeur: z.string().optional() })),
  evidence: z.array(EvidenceItem),
  scores: ScoreSet, scoreGlobal: z.number(), recommendation: z.string(),
});

export const PROCESS_WEIGHTS = { potentiel: 0.30, risque: 0.20, timing: 0.20, faisabilite: 0.15, marche: 0.15 } as const;
export const weightedScore = (s: z.infer<typeof ScoreSet>) =>
  s.potentiel*PROCESS_WEIGHTS.potentiel + s.risque*PROCESS_WEIGHTS.risque +
  s.timing*PROCESS_WEIGHTS.timing + s.faisabilite*PROCESS_WEIGHTS.faisabilite +
  s.marche*PROCESS_WEIGHTS.marche;

export type EvidenceItem = z.infer<typeof EvidenceItem>;
export type OpportunityDossier = z.infer<typeof OpportunityDossier>;
```

- [ ] Step 4 — run, expect PASS.
- [ ] Step 5 — `make commit MSG="feat(domain): opportunity dossier + evidence + process scoring schemas"`.
- [ ] Lot gate: `make typecheck ENV=test-vertical-slice` + the domain test passes.

## Lot 2 — Investigation Phase 2 (Ancrage foncier) — REAL [parallel-A]
**Files:** Create `packages/radar-sources/src/sources/_spikes/role-cadastre-valleyfield.md`
(findings), raw → S3 `raw/valleyfield/role/`.
- [ ] Locate + fetch the open-data rôle d'évaluation for Salaberry-de-Valleyfield
  (muni **70052**): `RL70052_2026.xml` via donneesouvertes.affmunqc.net (the file
  Codex C2 confirmed). Store raw in S3 (`make s3-*`). Record exact URL + date.
- [ ] Fetch the **cadastre allégé** layer (Données Québec) covering the 3 zones;
  extract candidate `NO_LOT` for streets in H-609-4 (Champlain, Saint-Jean-Baptiste,
  Salaberry…), U-521→H-521 (Larocque/Sainte-Marie…), H-143-1 (Grande-Île/Ovide…).
- [ ] For ≥3 real lots per opportunity: extract matricule/superficie/usage/valeur
  from the rôle XML (or mark "non disponible"). Write findings with source+date.
- [ ] Lot gate: `git diff --check`; findings file lists **real lots with source
  links** (or explicit "non disponible") for each of the 3 opportunities.

## Lot 3 — Investigation Phase 3 (Contraintes géospatiales) — REAL [parallel-B]
**Files:** Create `packages/radar-sources/src/sources/_spikes/contraintes-geo-valleyfield.md`.
- [ ] Fetch Données Québec geospatial layers: **BDZI** (zones inondables), **GRHQ**
  (hydrographie), **CPTAQ** (zone agricole) for the Valleyfield sector. Record dataset
  URLs + dates.
- [ ] Intersect each opportunity zone footprint (from Lot 2 streets/lots) with the
  3 constraint layers; classify each: bloquant / coûteux / négociable / informatif.
  Flag CPTAQ proximity for H-143-1 (A-118). Mark unconfirmed intersections as hypothesis.
- [ ] Lot gate: `git diff --check`; constraints documented per opportunity with
  source + confidence.

## Lot 4 — Investigation Phases 1/4/5 (Signal, Marché, Contexte) — REAL [parallel-C]
**Files:** Create `packages/radar-sources/src/sources/_spikes/signal-marche-contexte-valleyfield.md`.
- [ ] Phase 1: pull the avis PDF for 150-49/150-51/150-49-1 (cloudfront URLs in
  `SPEC_EVOL_DEMO_FINDINGS_SCORING.md`) → S3; extract zones/densities/dates (OCR/LLM
  if needed). Attempt Tier B: zonage grilles PDF for the 3 zones (densité, hauteur,
  stationnement) — record or "non disponible".
- [ ] Phase 4: query Données Québec **permis de construction** for Valleyfield
  sector near the 3 zones (recent activity). Note transactions/JLR/Centris = Tier C
  manque.
- [ ] Phase 5: pull **StatCan** profile for Salaberry-de-Valleyfield (population,
  ménages, revenu, croissance) + any transport/MRC catalyst. Record source+date.
- [ ] Lot gate: `git diff --check`; each phase has ≥1 real traced evidence item per
  opportunity (or "non disponible").

## Lot 5 — Investigation YouTube (Tier B) — REAL [parallel-D]
**Files:** Create `packages/radar-sources/src/sources/_spikes/youtube-conseil-valleyfield.md`.
- [ ] Locate the Ville YouTube channel (footer link: youtube.com/user/VilleValleyfield);
  list recent conseil séances; identify those discussing 150-49/150-51 (titles/dates).
- [ ] Obtain transcript for ≥1 relevant séance: captions API first; else `yt-dlp`
  audio + whisper (run via a make/obscura-mediated container — no host node). Store
  transcript in S3.
- [ ] Extract densification/zonage/intention mentions; link to the dossier (bylaw/zone).
  If captions/transcription not obtainable in this pass → mark Tier-B-partial,
  document the blocker (not a failure).
- [ ] Lot gate: `git diff --check`; either a real transcript excerpt linked to a
  dossier, or a documented feasibility blocker with the exact attempted method.

## Lot 6 — Consolidation: 3 dossiers + data model spec
**Files:** Create `api/src/services/opportunity/valleyfield-dossiers.ts` (builds 3
`OpportunityDossier` from Lots 2-5 findings), `docs/spec/SPEC_EVOL_DATA_MODEL.md`.
- [ ] Step 1 — failing test `valleyfield-dossiers.test.ts`: asserts 3 dossiers,
  each `OpportunityDossier.parse(...)` valid, each has ≥1 evidence per phase present
  in the investigation (or verification "non-disponible"), and `scoreGlobal ===
  weightedScore(scores)`.
- [ ] Step 2 — run, expect FAIL.
- [ ] Step 3 — implement `valleyfield-dossiers.ts` populating the 3 dossiers
  **only with traced findings from Lots 2-5** (no invention; "non-disponible" where
  the investigation found nothing). Compute scores from PROCESS criteria with the
  evidence behind each.
- [ ] Step 4 — run, expect PASS.
- [ ] Write `SPEC_EVOL_DATA_MODEL.md`: universal vs local fields observed, jsonb
  candidates, what the real data forced vs the v1 guess.
- [ ] Step 5 — `make commit MSG="feat(api): build 3 valleyfield opportunity dossiers from real findings"`.
- [ ] Lot gate: `make typecheck` + `make lint` + dossier test pass, `ENV=test-vertical-slice`.

## Lot 7 — Demo UI: "Opportunité bout-en-bout" view (TDD)
**Files:** Create `ui/src/lib/demo/opportunity-dossiers.ts` (the 3 dossiers as UI
data, imported from domain types), `ui/src/lib/components/opportunity/OpportunityFunnel.svelte`,
`ui/src/lib/components/opportunity/OpportunityFunnel.test.ts`; modify
`ui/src/App.svelte` + `ui/src/lib/components/NavMenu.svelte` (4th view "Opportunité").
- [ ] Step 1 — failing test: `opportunity-dossiers.test.ts` asserts 3 dossiers,
  each with the 6 phases represented and every evidence item carrying a sourceUrl or
  verification "non-disponible".
- [ ] Step 2 — run, expect FAIL (`make test-ui SCOPE=src/lib/demo/opportunity-dossiers.test.ts ENV=test-vertical-slice`).
- [ ] Step 3 — implement `opportunity-dossiers.ts` (mirror the api dossiers; single
  source of truth = the domain type) + `OpportunityFunnel.svelte` rendering: phase
  rail (6 phases), per-phase evidence cards (source link + fait/hypothèse/non-dispo
  tag), the lots table, the weighted score with per-criterion evidence; add the 4th
  nav entry "Opportunité" + a dossier switcher (3 opportunities).
- [ ] Step 4 — run, expect PASS.
- [ ] Step 5 — `make commit MSG="feat(ui): opportunity bout-en-bout funnel view (3 dossiers)"`.
- [ ] Lot gate: `make typecheck` + `make lint` + `make test-ui` + `make build`,
  `ENV=test-vertical-slice`.

## Lot 8 — UAT + PR + close
- [ ] UAT on root: present the 4th view on http://localhost:5301; verify the 3
  dossiers render the 6 phases + traced evidence + score (Playwright snapshot).
- [ ] Update `PLAN.md` §1.
- [ ] Push; open PR; CI green (full 40-char SHA).
- [ ] Merge commit only; preserve branch; move this file to `plan/done/`.
</content>
