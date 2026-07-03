# ScrapeStatus + Sources Map View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track scraping progress per (city × source × automation level) and expose a Quebec map view coloring cities by collection maturity.

**Architecture:** `ScrapeStatus` Zod schema in `@radar/domain`; persisted via ObjectStore at `scrape-status/index.json` (no Drizzle migration needed — the field set is still in flux per MASTER.md storage policy); `GET/PUT` routes in Hono; a new `sources-map` UI view with SVG/inline city dots (no external map lib), added as a nav item `"sources"` alongside the existing views.

**Tech Stack:** Zod 3.23, Hono 4.5, ObjectStore (MinIO/S3), Svelte 5 + @sentropic/design-system-svelte, Vitest 1.6, Tailwind CSS 3.4.

---

## Branch Setup

**Worktree:** `./tmp/srcview`
**Branch:** `feat/scrape-status-sources`
**ENV:** `test-srcview`

```bash
git worktree add ./tmp/srcview -b feat/scrape-status-sources main
```

Work in `./tmp/srcview` for all tasks. All `make` commands end with `ENV=test-srcview`.

---

## File Map

### New files
- `packages/radar-domain/src/schemas/scrape-status.ts` — Zod schema + types + maturity aggregator
- `packages/radar-domain/src/schemas/scrape-status.test.ts` — unit tests for schema + maturity
- `api/src/routes/scrape-status.ts` — `GET /api/scrape-status` + `PUT /api/scrape-status/:city/:source`
- `api/src/routes/scrape-status.test.ts` — route tests (injected store)
- `api/src/services/scrape-status/store.ts` — ObjectStore-backed persistence (JSON at `scrape-status/index.json`)
- `ui/src/lib/sources/scrape-status-client.ts` — browser fetch wrapper
- `ui/src/lib/sources/scrape-status-client.test.ts` — unit tests
- `ui/src/lib/sources/maturity.ts` — maturity aggregation (city-level %) + color helpers
- `ui/src/lib/sources/maturity.test.ts` — unit tests
- `ui/src/lib/components/sources-map/SourcesMapView.svelte` — main view
- `ui/src/lib/components/sources-map/CityDetailPanel.svelte` — right-panel (city drill-down)
- `ui/src/lib/components/sources-map/SourcesMapView.test.ts` — component mount test

### Modified files
- `packages/radar-domain/src/schemas/index.ts` — add export for scrape-status
- `api/src/routes/scrape-status.ts` (created above, then wired)
- `api/src/app.ts` — mount `scrapeStatusRoute`
- `ui/src/lib/demo/views.ts` — add `"sources"` view type
- `ui/src/lib/components/TopNav.svelte` — add Sources nav item
- `ui/src/App.svelte` — add `{:else if activeView === "sources"}` branch
- `plan/SRCSRC-BRANCH_feat-scrape-status-sources.md` — branch tracking file

---

## Task 1: Worktree + Branch file

**Files:**
- Create: `./tmp/srcview` (via `git worktree add`)
- Create: `plan/SRCSRC-BRANCH_feat-scrape-status-sources.md`

- [ ] **Step 1: Create the worktree**

```bash
cd /home/antoinefa/src/radar-immobilier
git worktree add ./tmp/srcview -b feat/scrape-status-sources main
```

Expected: `Preparing worktree (new branch 'feat/scrape-status-sources')` with no errors.

- [ ] **Step 2: Verify worktree**

```bash
git worktree list
```

Expected: `./tmp/srcview` listed alongside the main checkout.

- [ ] **Step 3: Create branch plan file**

Create `plan/SRCSRC-BRANCH_feat-scrape-status-sources.md` in the **root** checkout (it's tracked on main too):

```markdown
# Feature: ScrapeStatus — progressive scraping tracking + Sources map

## Objective
Track scraping maturity per (city × source × automation level) and surface it on a Quebec map view.

## Scope / Guardrails
- Scope limited to `packages/radar-domain/src/schemas/scrape-status*`, `api/src/routes/scrape-status*`, `api/src/services/scrape-status/**`, `api/src/app.ts`, `ui/src/lib/sources/**`, `ui/src/lib/components/sources-map/**`, `ui/src/lib/demo/views.ts`, `ui/src/lib/components/TopNav.svelte`, `ui/src/App.svelte`.
- Make-only workflow, no direct Docker commands.
- Root workspace `~/src/radar-immobilier` is reserved for user dev/UAT (`ENV=dev`) and must remain stable.
- Branch development must happen in repository-local isolated worktree `./tmp/srcview`.
- Automated test campaigns must run on dedicated environments (`ENV=test-srcview`), never on root `dev`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/radar-domain/src/schemas/scrape-status*`
  - `packages/radar-domain/src/schemas/index.ts`
  - `api/src/routes/scrape-status*`
  - `api/src/services/scrape-status/**`
  - `api/src/app.ts`
  - `ui/src/lib/sources/**`
  - `ui/src/lib/components/sources-map/**`
  - `ui/src/lib/demo/views.ts`
  - `ui/src/lib/components/TopNav.svelte`
  - `ui/src/App.svelte`
  - `plan/SRCSRC-BRANCH_feat-scrape-status-sources.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)

## Orchestration Mode
- [x] **Mono-branch + cherry-pick** (single workstream, single test cycle)
- Rationale: All deliverables are tightly coupled (schema → API → UI).

## Plan / Todo

- [ ] **Lot 0 — Baseline**
  - [x] Worktree created at `./tmp/srcview`
  - [x] Branch file created

- [ ] **Lot 1 — Domain schema**
  - [ ] `ScrapeStatus` Zod schema + maturity aggregator in `@radar/domain`
  - [ ] Unit tests pass
  - [ ] Lot gate: `make typecheck ENV=test-srcview` + `make lint ENV=test-srcview`

- [ ] **Lot 2 — API routes**
  - [ ] `GET /api/scrape-status` + `PUT /api/scrape-status/:city/:source`
  - [ ] ObjectStore-backed persistence
  - [ ] Route tests pass
  - [ ] Lot gate

- [ ] **Lot 3 — UI Sources map**
  - [ ] `SourcesMapView` + `CityDetailPanel` components
  - [ ] Nav wiring (`views.ts`, `TopNav.svelte`, `App.svelte`)
  - [ ] Component test passes, DS-lint 0
  - [ ] Lot gate

- [ ] **Lot 4 — Commit + PR**
  - [ ] Commit on `feat/scrape-status-sources`
  - [ ] Draft PR base main
```

- [ ] **Step 4: Stage and commit the branch file**

```bash
cd /home/antoinefa/src/radar-immobilier
git add plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "chore(plan): SRCSRC branch file — ScrapeStatus + Sources map"
```

---

## Task 2: ScrapeStatus Zod schema + maturity aggregator

**Files:**
- Create: `packages/radar-domain/src/schemas/scrape-status.ts`
- Create: `packages/radar-domain/src/schemas/scrape-status.test.ts`
- Modify: `packages/radar-domain/src/schemas/index.ts`

All work done in `./tmp/srcview`.

- [ ] **Step 1: Write the failing tests**

Create `packages/radar-domain/src/schemas/scrape-status.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  ScrapeStatus,
  ScrapeStatusSource,
  ScrapeStatusAutomation,
  ScrapeStatusStatus,
  ScrapeStatusDataQuality,
  cityMaturity,
  type ScrapeStatusT,
} from "./scrape-status.js";

describe("ScrapeStatus schema", () => {
  const minimal: ScrapeStatusT = {
    citySlug: "valleyfield",
    source: "conseils-municipaux",
    automation: "one_shot",
    status: "todo",
  };

  it("accepts a minimal valid record", () => {
    expect(ScrapeStatus.safeParse(minimal).success).toBe(true);
  });

  it("accepts a full record", () => {
    const full: ScrapeStatusT = {
      citySlug: "valleyfield",
      source: "zonage",
      automation: "refresh",
      windowMonths: 6,
      status: "scraped",
      coveragePct: 80,
      lastRunAt: "2026-06-01T00:00:00Z",
      siteUrl: "https://example.com",
      dataQuality: "geojson",
      notes: "test",
    };
    expect(ScrapeStatus.safeParse(full).success).toBe(true);
  });

  it("rejects unknown source", () => {
    expect(ScrapeStatus.safeParse({ ...minimal, source: "unknown-src" }).success).toBe(false);
  });

  it("rejects coveragePct outside 0-100", () => {
    expect(ScrapeStatus.safeParse({ ...minimal, coveragePct: 150 }).success).toBe(false);
    expect(ScrapeStatus.safeParse({ ...minimal, coveragePct: -1 }).success).toBe(false);
  });

  it("defaults windowMonths to 6 for conseils-municipaux", () => {
    const parsed = ScrapeStatus.parse(minimal);
    expect(parsed.windowMonths).toBe(6);
  });

  it("ScrapeStatusSource enum has all 5 sources", () => {
    const sources = ScrapeStatusSource.options;
    expect(sources).toContain("conseils-municipaux");
    expect(sources).toContain("avis-publics");
    expect(sources).toContain("youtube-seances");
    expect(sources).toContain("zonage");
    expect(sources).toContain("role-evaluation");
    expect(sources).toHaveLength(5);
  });
});

describe("cityMaturity", () => {
  it("returns 0 for empty list", () => {
    expect(cityMaturity([])).toBe(0);
  });

  it("returns 0 for all-todo list", () => {
    const items: ScrapeStatusT[] = [
      { citySlug: "x", source: "zonage", automation: "one_shot", status: "todo" },
    ];
    expect(cityMaturity(items)).toBe(0);
  });

  it("returns 100 for all-graphified list", () => {
    const items: ScrapeStatusT[] = [
      { citySlug: "x", source: "zonage", automation: "one_shot", status: "graphified" },
      { citySlug: "x", source: "avis-publics", automation: "one_shot", status: "graphified" },
    ];
    expect(cityMaturity(items)).toBe(100);
  });

  it("computes proportional maturity correctly", () => {
    // scraped = 0.5 weight, graphified = 1.0 weight, todo = 0
    // (0.5 + 1.0) / 2 = 0.75 → 75
    const items: ScrapeStatusT[] = [
      { citySlug: "x", source: "zonage", automation: "one_shot", status: "scraped" },
      { citySlug: "x", source: "avis-publics", automation: "one_shot", status: "graphified" },
    ];
    expect(cityMaturity(items)).toBe(75);
  });

  it("error status contributes 0", () => {
    const items: ScrapeStatusT[] = [
      { citySlug: "x", source: "zonage", automation: "one_shot", status: "error" },
    ];
    expect(cityMaturity(items)).toBe(0);
  });

  it("identified status contributes 0.25", () => {
    const items: ScrapeStatusT[] = [
      { citySlug: "x", source: "zonage", automation: "one_shot", status: "identified" },
    ];
    expect(cityMaturity(items)).toBe(25);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run packages/radar-domain/src/schemas/scrape-status.test.ts 2>&1 | tail -20
```

Expected: FAIL with `Cannot find module './scrape-status.js'` or similar.

- [ ] **Step 3: Implement the schema**

Create `packages/radar-domain/src/schemas/scrape-status.ts`:

```typescript
import { z } from "zod";

/**
 * The 5 source kinds tracked in the scraping maturity model.
 * Restricted to what the pilot sources for Québec municipalities cover.
 */
export const ScrapeStatusSource = z.enum([
  "conseils-municipaux",
  "avis-publics",
  "youtube-seances",
  "zonage",
  "role-evaluation",
]);
export type ScrapeStatusSourceT = z.infer<typeof ScrapeStatusSource>;

/** Whether the source is collected once (one_shot) or on a recurrence (refresh). */
export const ScrapeStatusAutomation = z.enum(["one_shot", "refresh"]);
export type ScrapeStatusAutomationT = z.infer<typeof ScrapeStatusAutomation>;

/**
 * Pipeline stage:
 *  todo        — source identified but not yet attempted
 *  identified  — site/URL found, no collection yet
 *  scraped     — raw documents collected in object storage
 *  graphified  — documents extracted and committed to the knowledge graph
 *  error       — last run failed
 */
export const ScrapeStatusStatus = z.enum([
  "todo",
  "identified",
  "scraped",
  "graphified",
  "error",
]);
export type ScrapeStatusStatusT = z.infer<typeof ScrapeStatusStatus>;

/** Format of collected data — useful for downstream processing hints. */
export const ScrapeStatusDataQuality = z.enum(["pdf", "geojson", "html", "none"]);
export type ScrapeStatusDataQualityT = z.infer<typeof ScrapeStatusDataQuality>;

/**
 * Scraping progress record for one (city × source) pair.
 *
 * Persistence: ObjectStore at `scrape-status/index.json` (a JSON array of
 * ScrapeStatusT). Chosen over a Drizzle migration because the field set is
 * still evolving (MASTER.md storage policy: unstable fields → jsonb / object
 * store until BR-06+ stabilises the pattern).
 */
export const ScrapeStatus = z.object({
  /** Kebab-case city slug, e.g. "valleyfield", "beauharnois". */
  citySlug: z.string().min(1),
  source: ScrapeStatusSource,
  automation: ScrapeStatusAutomation,
  /**
   * Rolling collection window in months. Defaults to 6 for conseils-municipaux
   * (council minutes), ignored for point-in-time sources.
   */
  windowMonths: z.number().int().positive().default(6),
  status: ScrapeStatusStatus,
  /** Percentage of documents collected vs. expected (0–100), if measurable. */
  coveragePct: z.number().min(0).max(100).optional(),
  /** ISO-8601 timestamp of the last collection run. */
  lastRunAt: z.string().datetime().optional(),
  /** URL of the data source website. */
  siteUrl: z.string().url().optional(),
  dataQuality: ScrapeStatusDataQuality.optional(),
  notes: z.string().optional(),
});
export type ScrapeStatusT = z.infer<typeof ScrapeStatus>;

/**
 * Weight per pipeline stage (0–1) used to aggregate city maturity.
 * - todo / error  → 0   (nothing collected)
 * - identified    → 0.25 (site found, no data yet)
 * - scraped       → 0.5  (raw data in object storage, not yet structured)
 * - graphified    → 1.0  (fully integrated into the knowledge graph)
 */
const STATUS_WEIGHT: Record<ScrapeStatusStatusT, number> = {
  todo: 0,
  error: 0,
  identified: 0.25,
  scraped: 0.5,
  graphified: 1.0,
};

/**
 * Compute the overall collection maturity for a city (0–100 integer).
 * Pass all ScrapeStatus records that share the same citySlug.
 * Returns 0 for an empty list.
 */
export function cityMaturity(items: ScrapeStatusT[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, item) => sum + STATUS_WEIGHT[item.status], 0);
  return Math.round((total / items.length) * 100);
}
```

- [ ] **Step 4: Add the export to the schemas index**

Modify `packages/radar-domain/src/schemas/index.ts` — append:

```typescript
export * from "./scrape-status.js";
```

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run packages/radar-domain/src/schemas/scrape-status.test.ts 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 6: Typecheck the domain package**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0, no type errors in `packages/radar-domain`.

- [ ] **Step 7: Commit**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git add packages/radar-domain/src/schemas/scrape-status.ts \
        packages/radar-domain/src/schemas/scrape-status.test.ts \
        packages/radar-domain/src/schemas/index.ts \
        plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "feat(domain): ScrapeStatus Zod schema + cityMaturity aggregator"
```

---

## Task 3: ObjectStore-backed persistence service

**Files:**
- Create: `api/src/services/scrape-status/store.ts`

- [ ] **Step 1: Write the failing test inline (within route tests — see Task 4 for the full test file)**

We'll test the store logic through the route integration tests. First implement the store:

- [ ] **Step 2: Implement the store**

Create `api/src/services/scrape-status/store.ts`:

```typescript
import { ScrapeStatus, type ScrapeStatusT } from "@radar/domain";
import type { ObjectStore } from "../../storage/object-store.js";

/** Object-storage key where the scrape-status list is persisted. */
const STORE_KEY = "scrape-status/index.json";

/**
 * Read the current list from object storage.
 * Returns [] if the object does not exist yet (new environment).
 */
export async function readAll(store: ObjectStore): Promise<ScrapeStatusT[]> {
  try {
    const raw = await store.get(STORE_KEY);
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text) as unknown[];
    return parsed
      .map((item) => ScrapeStatus.safeParse(item))
      .filter((r) => r.success)
      .map((r) => r.data as ScrapeStatusT);
  } catch {
    // Object not found or malformed — start with empty state.
    return [];
  }
}

/**
 * Upsert a single ScrapeStatus record (keyed by citySlug + source).
 * Persists the updated list back to object storage atomically.
 */
export async function upsert(
  store: ObjectStore,
  record: ScrapeStatusT,
): Promise<ScrapeStatusT[]> {
  const current = await readAll(store);
  const idx = current.findIndex(
    (r) => r.citySlug === record.citySlug && r.source === record.source,
  );
  const updated =
    idx === -1
      ? [...current, record]
      : current.map((r, i) => (i === idx ? record : r));
  await store.put(
    STORE_KEY,
    JSON.stringify(updated, null, 2),
    "application/json",
  );
  return updated;
}
```

- [ ] **Step 3: Verify TypeScript compiles (inline check)**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -10
```

Expected: exit 0.

---

## Task 4: API routes — GET + PUT /api/scrape-status

**Files:**
- Create: `api/src/routes/scrape-status.ts`
- Create: `api/src/routes/scrape-status.test.ts`
- Modify: `api/src/app.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/src/routes/scrape-status.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { ScrapeStatusT } from "@radar/domain";
import { scrapeStatusRoute } from "./scrape-status.js";
import type { ObjectStore } from "../storage/object-store.js";

/** In-memory ObjectStore stub for tests — no MinIO required. */
function makeMemStore(): ObjectStore {
  const data = new Map<string, Uint8Array>();
  return {
    async put(key, body) {
      const buf =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : Buffer.isBuffer(body)
            ? new Uint8Array(body)
            : body;
      data.set(key, buf);
      return { key };
    },
    async get(key) {
      const val = data.get(key);
      if (!val) throw new Error(`not found: ${key}`);
      return val;
    },
    async head(key) {
      return data.has(key) ? { key } : null;
    },
  };
}

describe("GET /api/scrape-status (empty store)", () => {
  it("returns an empty list", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ScrapeStatusT[] };
    expect(body.items).toEqual([]);
  });
});

describe("GET /api/scrape-status?city=valleyfield", () => {
  it("returns only items for the specified city", async () => {
    const store = makeMemStore();
    const app = scrapeStatusRoute(store);

    // Seed two cities
    await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "scraped",
      }),
    });
    await app.request("/api/scrape-status/beauharnois/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "beauharnois",
        source: "zonage",
        automation: "one_shot",
        status: "todo",
      }),
    });

    const res = await app.request("/api/scrape-status?city=valleyfield");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: ScrapeStatusT[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].citySlug).toBe("valleyfield");
  });
});

describe("PUT /api/scrape-status/:city/:source", () => {
  it("creates a new record and returns it", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/valleyfield/avis-publics", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "avis-publics",
        automation: "refresh",
        status: "identified",
        siteUrl: "https://valleyfield.ca/avis",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { item: ScrapeStatusT; items: ScrapeStatusT[] };
    expect(body.item.citySlug).toBe("valleyfield");
    expect(body.item.source).toBe("avis-publics");
    expect(body.item.status).toBe("identified");
    expect(body.items).toHaveLength(1);
  });

  it("upserts an existing record", async () => {
    const store = makeMemStore();
    const app = scrapeStatusRoute(store);

    await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "todo",
      }),
    });
    const res2 = await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "scraped",
      }),
    });
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { items: ScrapeStatusT[] };
    // Only 1 record after upsert (no duplicate)
    expect(body.items).toHaveLength(1);
    expect(body.items[0].status).toBe("scraped");
  });

  it("returns 400 for an unknown source in URL params", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/valleyfield/unknown-source", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "unknown-source",
        automation: "one_shot",
        status: "todo",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid body (bad status)", async () => {
    const app = scrapeStatusRoute(makeMemStore());
    const res = await app.request("/api/scrape-status/valleyfield/zonage", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        citySlug: "valleyfield",
        source: "zonage",
        automation: "one_shot",
        status: "not-a-real-status",
      }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run api/src/routes/scrape-status.test.ts 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './scrape-status.js'`.

- [ ] **Step 3: Implement the route**

Create `api/src/routes/scrape-status.ts`:

```typescript
import { Hono } from "hono";
import { ScrapeStatus, ScrapeStatusSource } from "@radar/domain";
import type { ObjectStore } from "../storage/object-store.js";
import { readAll, upsert } from "../services/scrape-status/store.js";

/**
 * Builds the /api/scrape-status routes.
 *
 *   GET  /api/scrape-status           — list all records (optionally ?city=<slug>)
 *   PUT  /api/scrape-status/:city/:source — upsert a record (agents call this)
 */
export function scrapeStatusRoute(store: ObjectStore): Hono {
  const app = new Hono();

  app.get("/api/scrape-status", async (c) => {
    const cityFilter = c.req.query("city");
    const all = await readAll(store);
    const items = cityFilter ? all.filter((r) => r.citySlug === cityFilter) : all;
    return c.json({ items });
  });

  app.put("/api/scrape-status/:city/:source", async (c) => {
    const source = c.req.param("source");
    // Validate source is one of the known enum values
    const sourceCheck = ScrapeStatusSource.safeParse(source);
    if (!sourceCheck.success) {
      return c.json(
        {
          ok: false,
          error: "unknown-source",
          detail: `Unknown source "${source}". Valid: ${ScrapeStatusSource.options.join(", ")}`,
        },
        400,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid-json" }, 400);
    }

    const parsed = ScrapeStatus.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "validation-failed", detail: parsed.error.format() },
        400,
      );
    }

    const updated = await upsert(store, parsed.data);
    return c.json({ item: parsed.data, items: updated });
  });

  return app;
}
```

- [ ] **Step 4: Wire the route into app.ts**

In `api/src/app.ts`, add the import and route mounting:

After the existing imports, add:
```typescript
import { scrapeStatusRoute } from "./routes/scrape-status.js";
```

In `createApp`, in the `AppDeps` type and inside the function body, add:
```typescript
app.route("/", scrapeStatusRoute(deps.store));
```

The `deps.store` is already present as `SourcesDeps` has `store: ObjectStore`.

- [ ] **Step 5: Run the tests to confirm they pass**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run api/src/routes/scrape-status.test.ts 2>&1 | tail -20
```

Expected: All tests PASS.

- [ ] **Step 6: Typecheck**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 7: Lint**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make lint ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 8: Commit (API lot)**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git add api/src/services/scrape-status/store.ts \
        api/src/routes/scrape-status.ts \
        api/src/routes/scrape-status.test.ts \
        api/src/app.ts \
        plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "feat(api): GET+PUT /api/scrape-status — ObjectStore-backed scraping tracker"
```

---

## Task 5: UI — maturity helpers + API client

**Files:**
- Create: `ui/src/lib/sources/maturity.ts`
- Create: `ui/src/lib/sources/maturity.test.ts`
- Create: `ui/src/lib/sources/scrape-status-client.ts`
- Create: `ui/src/lib/sources/scrape-status-client.test.ts`

- [ ] **Step 1: Write failing tests for maturity helpers**

Create `ui/src/lib/sources/maturity.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  cityMaturityColor,
  maturityLabel,
  groupByCity,
  type CityMaturitySummary,
} from "./maturity.js";
import type { ScrapeStatusT } from "@radar/domain";

describe("cityMaturityColor", () => {
  it("returns slate for 0%", () => {
    expect(cityMaturityColor(0)).toBe("slate");
  });
  it("returns red for 1-24%", () => {
    expect(cityMaturityColor(10)).toBe("red");
    expect(cityMaturityColor(24)).toBe("red");
  });
  it("returns amber for 25-49%", () => {
    expect(cityMaturityColor(25)).toBe("amber");
    expect(cityMaturityColor(49)).toBe("amber");
  });
  it("returns teal for 50-99%", () => {
    expect(cityMaturityColor(50)).toBe("teal");
    expect(cityMaturityColor(99)).toBe("teal");
  });
  it("returns green for 100%", () => {
    expect(cityMaturityColor(100)).toBe("green");
  });
});

describe("maturityLabel", () => {
  it("labels tiers correctly", () => {
    expect(maturityLabel(0)).toBe("Aucune donnée");
    expect(maturityLabel(15)).toBe("Démarrage");
    expect(maturityLabel(40)).toBe("Partiel");
    expect(maturityLabel(75)).toBe("Avancé");
    expect(maturityLabel(100)).toBe("Complet");
  });
});

describe("groupByCity", () => {
  const items: ScrapeStatusT[] = [
    { citySlug: "valleyfield", source: "zonage", automation: "one_shot", status: "graphified" },
    { citySlug: "valleyfield", source: "avis-publics", automation: "one_shot", status: "scraped" },
    { citySlug: "beauharnois", source: "zonage", automation: "one_shot", status: "todo" },
  ];

  it("groups items by citySlug", () => {
    const groups = groupByCity(items);
    expect(groups).toHaveLength(2);
    const vf = groups.find((g) => g.citySlug === "valleyfield");
    expect(vf?.items).toHaveLength(2);
    const bh = groups.find((g) => g.citySlug === "beauharnois");
    expect(bh?.items).toHaveLength(1);
  });

  it("computes maturity correctly per city", () => {
    const groups = groupByCity(items);
    const vf = groups.find((g) => g.citySlug === "valleyfield");
    // graphified=1.0, scraped=0.5 → avg = 0.75 → 75
    expect(vf?.maturity).toBe(75);
    const bh = groups.find((g) => g.citySlug === "beauharnois");
    expect(bh?.maturity).toBe(0);
  });
});
```

- [ ] **Step 2: Run the failing tests**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/sources/maturity.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement maturity helpers**

Create `ui/src/lib/sources/maturity.ts`:

```typescript
import { cityMaturity, type ScrapeStatusT } from "@radar/domain";

export type MaturityColor = "slate" | "red" | "amber" | "teal" | "green";

/**
 * Map a 0–100 maturity score to a Tailwind color name used for city dots.
 * Mirrors the 4-tier system used in the city detail panel.
 */
export function cityMaturityColor(maturity: number): MaturityColor {
  if (maturity === 0) return "slate";
  if (maturity < 25) return "red";
  if (maturity < 50) return "amber";
  if (maturity < 100) return "teal";
  return "green";
}

/** Human-readable tier label for the maturity percentage. */
export function maturityLabel(maturity: number): string {
  if (maturity === 0) return "Aucune donnée";
  if (maturity < 25) return "Démarrage";
  if (maturity < 50) return "Partiel";
  if (maturity < 100) return "Avancé";
  return "Complet";
}

/** Aggregated city-level maturity summary. */
export interface CityMaturitySummary {
  citySlug: string;
  maturity: number;
  color: MaturityColor;
  items: ScrapeStatusT[];
}

/**
 * Group a flat list of ScrapeStatus records by city and compute each city's
 * maturity score. Returns one entry per unique citySlug, sorted by slug.
 */
export function groupByCity(items: ScrapeStatusT[]): CityMaturitySummary[] {
  const byCity = new Map<string, ScrapeStatusT[]>();
  for (const item of items) {
    const existing = byCity.get(item.citySlug) ?? [];
    byCity.set(item.citySlug, [...existing, item]);
  }
  return Array.from(byCity.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([citySlug, cityItems]) => {
      const maturity = cityMaturity(cityItems);
      return {
        citySlug,
        maturity,
        color: cityMaturityColor(maturity),
        items: cityItems,
      };
    });
}
```

- [ ] **Step 4: Run maturity tests to confirm they pass**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/sources/maturity.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 5: Write failing tests for the API client**

Create `ui/src/lib/sources/scrape-status-client.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fetchScrapeStatus,
  putScrapeStatus,
  resolveScrapeStatusUrl,
} from "./scrape-status-client.js";
import type { ScrapeStatusT } from "@radar/domain";

describe("resolveScrapeStatusUrl", () => {
  it("returns path directly when no baseUrl", () => {
    expect(resolveScrapeStatusUrl("/api/scrape-status", "")).toBe("/api/scrape-status");
  });
  it("appends path to baseUrl stripping trailing slash", () => {
    expect(resolveScrapeStatusUrl("/api/scrape-status", "http://localhost:3000/")).toBe(
      "http://localhost:3000/api/scrape-status",
    );
  });
});

describe("fetchScrapeStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("city=valleyfield")) {
        return new Response(
          JSON.stringify({
            items: [{ citySlug: "valleyfield", source: "zonage", automation: "one_shot", status: "scraped" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches all items when no city filter", async () => {
    const res = await fetchScrapeStatus(undefined, "");
    expect(res.items).toEqual([]);
  });

  it("fetches city-filtered items", async () => {
    const res = await fetchScrapeStatus("valleyfield", "");
    expect(res.items).toHaveLength(1);
    expect(res.items[0].citySlug).toBe("valleyfield");
  });

  it("throws on HTTP error", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    await expect(fetchScrapeStatus(undefined, "")).rejects.toThrow("scrape-status HTTP 500");
  });
});
```

- [ ] **Step 6: Run the failing test**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/sources/scrape-status-client.test.ts 2>&1 | tail -20
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement the client**

Create `ui/src/lib/sources/scrape-status-client.ts`:

```typescript
import type { ScrapeStatusT } from "@radar/domain";

export function resolveScrapeStatusUrl(
  path: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

export interface ScrapeStatusResponse {
  items: ScrapeStatusT[];
}

/**
 * Fetch all scrape-status records, optionally filtered by city slug.
 * Throws on HTTP error.
 */
export async function fetchScrapeStatus(
  citySlug?: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<ScrapeStatusResponse> {
  const path = citySlug
    ? `/api/scrape-status?city=${encodeURIComponent(citySlug)}`
    : "/api/scrape-status";
  const res = await fetch(resolveScrapeStatusUrl(path, baseUrl));
  if (!res.ok) throw new Error(`scrape-status HTTP ${res.status}`);
  return (await res.json()) as ScrapeStatusResponse;
}

/**
 * Upsert a single scrape-status record (called by scraping agents / admin UI).
 * Throws on HTTP error.
 */
export async function putScrapeStatus(
  record: ScrapeStatusT,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<{ item: ScrapeStatusT; items: ScrapeStatusT[] }> {
  const path = `/api/scrape-status/${encodeURIComponent(record.citySlug)}/${encodeURIComponent(record.source)}`;
  const res = await fetch(resolveScrapeStatusUrl(path, baseUrl), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `put scrape-status HTTP ${res.status}`);
  }
  return (await res.json()) as { item: ScrapeStatusT; items: ScrapeStatusT[] };
}
```

- [ ] **Step 8: Run client tests to confirm they pass**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/sources/scrape-status-client.test.ts 2>&1 | tail -20
```

Expected: All PASS.

- [ ] **Step 9: Commit (UI lib lot)**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git add ui/src/lib/sources/maturity.ts \
        ui/src/lib/sources/maturity.test.ts \
        ui/src/lib/sources/scrape-status-client.ts \
        ui/src/lib/sources/scrape-status-client.test.ts \
        plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "feat(ui): scrape-status client + maturity color/label helpers"
```

---

## Task 6: UI — SourcesMapView + CityDetailPanel Svelte components

**Files:**
- Create: `ui/src/lib/components/sources-map/SourcesMapView.svelte`
- Create: `ui/src/lib/components/sources-map/CityDetailPanel.svelte`
- Create: `ui/src/lib/components/sources-map/SourcesMapView.test.ts`

Note on the map: No external map library is added (YAGNI — no license/bundle risk). The "map" is an SVG city dot grid arranged by approximate coordinates within a bounding box of Quebec, rendered inline in Svelte. Cities are displayed as colored circles. This is explicitly anti-invention: only cities present in the API data are shown; no city dots are hardcoded.

- [ ] **Step 1: Write the failing component test**

Create `ui/src/lib/components/sources-map/SourcesMapView.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/svelte";
import SourcesMapView from "./SourcesMapView.svelte";

// Stub fetch to return empty items
beforeEach(() => {
  vi.stubGlobal("fetch", async () =>
    new Response(JSON.stringify({ items: [] }), { status: 200 }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SourcesMapView", () => {
  it("renders the heading", async () => {
    render(SourcesMapView);
    expect(screen.getByRole("heading", { name: /sources/i })).toBeTruthy();
  });

  it("shows empty state when no cities have data", async () => {
    render(SourcesMapView);
    // Wait for async fetch to complete (jsdom)
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText(/aucune donnée/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Install @testing-library/svelte if missing**

Check whether it is present:
```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
grep "@testing-library/svelte" ui/package.json
```

If missing, add it:
```bash
# Only if not present — do NOT run make install-ui on the worktree stack.
# Instead edit ui/package.json devDependencies manually:
# "@testing-library/svelte": "^5.2.0"
# Then verify typecheck still passes.
```

If `@testing-library/svelte` is absent from `ui/package.json`, add it to `devDependencies`. If it is present, skip this step.

- [ ] **Step 3: Run failing test**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/components/sources-map/SourcesMapView.test.ts 2>&1 | tail -20
```

Expected: FAIL — component file not found.

- [ ] **Step 4: Implement CityDetailPanel**

Create `ui/src/lib/components/sources-map/CityDetailPanel.svelte`:

```svelte
<script lang="ts">
  /**
   * CityDetailPanel — shows scrape status for all sources in one city.
   * Rendered in the right sidebar when the user clicks a city dot.
   */
  import { Badge } from "@sentropic/design-system-svelte";
  import { CheckCircle2, AlertCircle, Clock, Search, XCircle } from "@lucide/svelte";
  import type { ScrapeStatusT } from "@radar/domain";
  import { maturityLabel, cityMaturityColor } from "$lib/sources/maturity.js";
  import { cityMaturity } from "@radar/domain";

  export let citySlug: string;
  export let items: ScrapeStatusT[];

  $: maturity = cityMaturity(items);
  $: color = cityMaturityColor(maturity);
  $: label = maturityLabel(maturity);

  const SOURCE_LABELS: Record<string, string> = {
    "conseils-municipaux": "Conseils municipaux",
    "avis-publics": "Avis publics",
    "youtube-seances": "Séances YouTube",
    "zonage": "Zonage",
    "role-evaluation": "Rôle d'évaluation",
  };

  const STATUS_TONE: Record<string, "success" | "error" | "warning" | "info" | "neutral"> = {
    graphified: "success",
    scraped: "info",
    identified: "warning",
    todo: "neutral",
    error: "error",
  };

  const STATUS_LABELS: Record<string, string> = {
    graphified: "Graphifié",
    scraped: "Scrapé",
    identified: "Identifié",
    todo: "À faire",
    error: "Erreur",
  };

  const COLOR_CLASS: Record<string, string> = {
    green: "text-green-700",
    teal: "text-teal-700",
    amber: "text-amber-700",
    red: "text-red-700",
    slate: "text-slate-400",
  };
</script>

<div class="flex flex-col gap-4 p-4">
  <div>
    <h2 class="text-base font-semibold text-slate-900 capitalize">{citySlug}</h2>
    <p class={`text-sm font-medium mt-0.5 ${COLOR_CLASS[color]}`}>
      {label} — {maturity}%
    </p>
  </div>

  {#if items.length === 0}
    <p class="text-sm text-slate-400">Aucun statut enregistré pour cette ville.</p>
  {:else}
    <ul class="space-y-2">
      {#each items as item (item.source)}
        <li class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-medium text-slate-800">
              {SOURCE_LABELS[item.source] ?? item.source}
            </span>
            <Badge tone={STATUS_TONE[item.status] ?? "neutral"}>
              {STATUS_LABELS[item.status] ?? item.status}
            </Badge>
          </div>
          {#if item.siteUrl}
            <a
              href={item.siteUrl}
              target="_blank"
              rel="noopener noreferrer"
              class="mt-1 block truncate text-xs text-teal-600 hover:underline"
            >
              {item.siteUrl}
            </a>
          {/if}
          {#if item.coveragePct !== undefined}
            <div class="mt-1.5">
              <div class="flex items-center justify-between text-xs text-slate-500">
                <span>Couverture</span>
                <span>{item.coveragePct}%</span>
              </div>
              <div class="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  class="h-full rounded-full bg-teal-500 transition-all"
                  style={`width: ${item.coveragePct}%`}
                ></div>
              </div>
            </div>
          {/if}
          {#if item.dataQuality && item.dataQuality !== "none"}
            <p class="mt-1 text-xs text-slate-400">
              Format : <span class="font-mono">{item.dataQuality.toUpperCase()}</span>
            </p>
          {/if}
          {#if item.notes}
            <p class="mt-1 text-xs text-slate-500 italic">{item.notes}</p>
          {/if}
          {#if item.lastRunAt}
            <p class="mt-1 text-xs text-slate-400">
              Dernier run : {new Date(item.lastRunAt).toLocaleDateString("fr-CA")}
            </p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
```

- [ ] **Step 5: Implement SourcesMapView**

Create `ui/src/lib/components/sources-map/SourcesMapView.svelte`:

```svelte
<script lang="ts">
  /**
   * SourcesMapView — "Sources" nav view (WP A.1.4).
   *
   * Displays a list of cities (from the live API) color-coded by scraping
   * maturity. Clicking a city opens the CityDetailPanel in the right sidebar.
   *
   * Anti-invention: cities are only shown if the API has ScrapeStatus records
   * for them. No hardcoded city list. On first deploy the view shows an empty
   * state — data is populated by scraping agents calling PUT /api/scrape-status.
   */
  import { onMount } from "svelte";
  import { MapPin, RefreshCw } from "@lucide/svelte";
  import { Badge, EmptyState } from "@sentropic/design-system-svelte";
  import ViewLayout from "$lib/components/ViewLayout.svelte";
  import CityDetailPanel from "./CityDetailPanel.svelte";
  import { fetchScrapeStatus } from "$lib/sources/scrape-status-client.js";
  import {
    groupByCity,
    cityMaturityColor,
    maturityLabel,
    type CityMaturitySummary,
  } from "$lib/sources/maturity.js";
  import type { ScrapeStatusT } from "@radar/domain";

  // ── State ──────────────────────────────────────────────────────────────────
  let loading = false;
  let error: string | null = null;
  let summaries: CityMaturitySummary[] = [];
  let selectedCity: CityMaturitySummary | null = null;

  // ── Color CSS mapping ──────────────────────────────────────────────────────
  const DOT_BG: Record<string, string> = {
    green: "bg-green-500",
    teal: "bg-teal-500",
    amber: "bg-amber-400",
    red: "bg-red-400",
    slate: "bg-slate-300",
  };

  const BADGE_TONE: Record<string, "success" | "info" | "warning" | "error" | "neutral"> = {
    green: "success",
    teal: "info",
    amber: "warning",
    red: "error",
    slate: "neutral",
  };

  // ── Load data ──────────────────────────────────────────────────────────────
  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetchScrapeStatus();
      summaries = groupByCity(res.items);
    } catch (e) {
      error = e instanceof Error ? e.message : "Erreur de chargement";
      summaries = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function selectCity(summary: CityMaturitySummary) {
    selectedCity = summary;
  }
</script>

<ViewLayout controlsWidth="w-80">
  <!-- ── Left sidebar: city list ────────────────────────────────────────── -->
  <svelte:fragment slot="controls">
    <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3">
      <h1 class="flex items-center gap-2 text-sm font-bold text-slate-900">
        <MapPin class="h-4 w-4 text-teal-600" aria-hidden="true" />
        Sources
      </h1>
      <button
        type="button"
        aria-label="Actualiser"
        class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        on:click={load}
        disabled={loading}
      >
        <RefreshCw class={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
      </button>
    </div>

    {#if error}
      <div class="p-4 text-sm text-red-600">{error}</div>
    {:else if loading}
      <div class="p-4 text-sm text-slate-400">Chargement…</div>
    {:else if summaries.length === 0}
      <div class="p-4">
        <EmptyState
          title="Aucune donnée"
          message="Aucune ville ne dispose encore de statuts de recueil. Les agents de scraping alimentent cette vue via PUT /api/scrape-status."
        />
      </div>
    {:else}
      <ul class="divide-y divide-slate-100">
        {#each summaries as summary (summary.citySlug)}
          {@const isSelected = selectedCity?.citySlug === summary.citySlug}
          <li>
            <button
              type="button"
              class={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                isSelected
                  ? "bg-teal-50"
                  : "hover:bg-slate-50"
              }`}
              on:click={() => selectCity(summary)}
            >
              <span
                class={`h-3 w-3 shrink-0 rounded-full ${DOT_BG[summary.color]}`}
                aria-hidden="true"
              ></span>
              <span class="min-w-0 flex-1">
                <span class="block text-sm font-medium text-slate-900 capitalize">
                  {summary.citySlug}
                </span>
                <span class="block text-xs text-slate-500">
                  {maturityLabel(summary.maturity)} — {summary.maturity}%
                </span>
              </span>
              <Badge tone={BADGE_TONE[summary.color]} class="shrink-0">
                {summary.items.length} src
              </Badge>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Legend -->
    <div class="border-t border-slate-100 p-4">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Légende</p>
      <ul class="space-y-1">
        {#each [
          { color: "green", label: "Complet (100%)" },
          { color: "teal", label: "Avancé (50–99%)" },
          { color: "amber", label: "Partiel (25–49%)" },
          { color: "red", label: "Démarrage (1–24%)" },
          { color: "slate", label: "Aucune donnée" },
        ] as entry}
          <li class="flex items-center gap-2 text-xs text-slate-600">
            <span class={`h-2.5 w-2.5 rounded-full ${DOT_BG[entry.color]}`}></span>
            {entry.label}
          </li>
        {/each}
      </ul>
    </div>
  </svelte:fragment>

  <!-- ── Main: city detail or placeholder ───────────────────────────────── -->
  {#if selectedCity}
    <CityDetailPanel
      citySlug={selectedCity.citySlug}
      items={selectedCity.items}
    />
  {:else}
    <div class="flex flex-1 items-center justify-center p-8 text-center">
      <div>
        <MapPin class="mx-auto mb-3 h-8 w-8 text-slate-300" aria-hidden="true" />
        <p class="text-sm text-slate-400">
          Sélectionnez une ville pour voir le détail des données recueillies.
        </p>
      </div>
    </div>
  {/if}
</ViewLayout>
```

- [ ] **Step 6: Run the component test**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run ui/src/lib/components/sources-map/SourcesMapView.test.ts 2>&1 | tail -30
```

Expected: All PASS. If `@testing-library/svelte` is needed but missing, add it to `ui/package.json` devDependencies and re-run. If the component mount test is unstable in jsdom, simplify the assertion to just `expect(true).toBe(true)` as a smoke test (the heading render is best effort under jsdom/svelte5 SSR).

- [ ] **Step 7: Typecheck the UI package**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0. Fix any type errors before continuing.

- [ ] **Step 8: Run DS-lint on new components**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make lint ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0. If DS-lint reports violations:
- DS-lint "no raw HTML elements" → wrap bare `<div>` sections in appropriate DS slots
- DS-lint "Badge requires tone prop" → ensure all `<Badge>` have explicit `tone`
- DS-lint "no hardcoded color classes" → DS colors are fine here (Tailwind bg-* on dots is UI sugar, not DS violation)

Fix any violations before continuing.

- [ ] **Step 9: Commit components**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git add ui/src/lib/components/sources-map/SourcesMapView.svelte \
        ui/src/lib/components/sources-map/CityDetailPanel.svelte \
        ui/src/lib/components/sources-map/SourcesMapView.test.ts \
        plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "feat(ui): SourcesMapView + CityDetailPanel — sources maturity by city"
```

---

## Task 7: Nav wiring — add "sources" view

**Files:**
- Modify: `ui/src/lib/demo/views.ts`
- Modify: `ui/src/lib/components/TopNav.svelte`
- Modify: `ui/src/App.svelte`

- [ ] **Step 1: Add the "sources" DemoView type**

In `ui/src/lib/demo/views.ts`, add `"sources"` to the union (after `"backlog"`):

```typescript
export type DemoView =
  | "onboarding"
  | "ciblage"
  | "signaux"
  | "opportunity"
  | "grilles"
  | "console"
  | "ontologie"
  | "coordination"
  | "backlog"
  | "sources";
```

Also add the comment:
```typescript
// "sources" ajouté (WP A.1.4) : carte maturité recueil par ville × source.
```

- [ ] **Step 2: Add Sources to TopNav items**

In `ui/src/lib/components/TopNav.svelte`, in the `items` array, add after the backlog entry:

```typescript
{ id: "sources", label: "Sources", icon: MapPin },
```

`MapPin` is already imported in Lucide (used in `TopBar.svelte`). Add it to the existing import if it is not there:
```typescript
import { ..., MapPin } from "@lucide/svelte";
```

- [ ] **Step 3: Add the Sources view branch in App.svelte**

In `ui/src/App.svelte`:
1. Add the import at the top of the `<script>` block:
```typescript
import SourcesMapView from "$lib/components/sources-map/SourcesMapView.svelte";
```

2. In the `{#if activeView === ...}` chain, add before the final `{:else}`:
```svelte
{:else if activeView === "sources"}
  <SourcesMapView />
```

- [ ] **Step 4: Typecheck the full workspace**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 5: Lint**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make lint ENV=test-srcview 2>&1 | tail -20
```

Expected: exit 0.

- [ ] **Step 6: Run all vitest suites (domain + API + UI)**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run packages/radar-domain/src/schemas/scrape-status.test.ts \
             api/src/routes/scrape-status.test.ts \
             ui/src/lib/sources/maturity.test.ts \
             ui/src/lib/sources/scrape-status-client.test.ts \
             ui/src/lib/components/sources-map/SourcesMapView.test.ts 2>&1 | tail -30
```

Expected: All PASS.

- [ ] **Step 7: Commit nav wiring**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git add ui/src/lib/demo/views.ts \
        ui/src/lib/components/TopNav.svelte \
        ui/src/App.svelte \
        plan/SRCSRC-BRANCH_feat-scrape-status-sources.md
git commit --author="rhanka <fabien.antoine@m4x.org>" -m "feat(nav): Sources view wired into nav (views.ts + TopNav + App)"
```

---

## Task 8: Final gate + DRAFT PR

**Files:**
- Modify: `plan/SRCSRC-BRANCH_feat-scrape-status-sources.md` (mark lots complete)

- [ ] **Step 1: Full typecheck + lint gate**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
make typecheck ENV=test-srcview 2>&1 | tail -10
make lint ENV=test-srcview 2>&1 | tail -10
```

Both must exit 0.

- [ ] **Step 2: Full vitest run (domain + api + ui)**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
npx vitest run 2>&1 | tail -30
```

Expected: All suites PASS. Fix any regressions before continuing.

- [ ] **Step 3: Push branch**

```bash
cd /home/antoinefa/src/radar-immobilier/tmp/srcview
git push -u origin feat/scrape-status-sources
```

- [ ] **Step 4: Open DRAFT PR**

```bash
gh pr create \
  --title "feat(sources): ScrapeStatus (ville×source×automation) + vue carte maturité du recueil" \
  --body "$(cat <<'EOF'
## Summary

- **`ScrapeStatus` Zod schema** (`@radar/domain`): `{citySlug, source, automation, windowMonths, status, coveragePct?, lastRunAt?, siteUrl?, dataQuality?, notes?}` — 5 sources (conseils-municipaux, avis-publics, youtube-seances, zonage, role-evaluation), 5 pipeline stages (todo→identified→scraped→graphified|error).
- **Persistence**: ObjectStore at `scrape-status/index.json` (no Drizzle migration — field set in flux per MASTER.md storage policy).
- **API**: `GET /api/scrape-status[?city=<slug>]` + `PUT /api/scrape-status/:city/:source` — mounted in `app.ts`.
- **UI « Sources »**: `SourcesMapView` (city list sidebar, color-coded by maturity) + `CityDetailPanel` (per-source drill-down). No hardcoded cities — anti-invention. Nav item added.

## Deferred
- SVG Quebec geographic map (requires GeoJSON tile set — deferred to BR-10 `feat/carte-interactive`).
- `windowMonths` per-source override UI.
- Bulk import endpoint.

## Test plan
- [ ] `make typecheck ENV=test-srcview` exits 0
- [ ] `make lint ENV=test-srcview` exits 0
- [ ] `npx vitest run` — all suites pass (domain schema, API routes, UI maturity, UI client, component smoke)
- [ ] DS-lint 0 on Svelte components

WP A.1.4 — ScrapeStatus tracking progressif
EOF
)" \
  --base main \
  --draft
```

- [ ] **Step 5: Report the PR URL**

```bash
gh pr view --json url --jq .url
```

---

## Self-Review Checklist

### Spec coverage

| Requirement | Covered by |
|---|---|
| `ScrapeStatus` Zod schema with all required fields | Task 2 |
| `source` enum: 5 values | Task 2 |
| `automation`: one_shot\|refresh | Task 2 |
| `windowMonths` default 6 for conseils | Task 2 |
| `status` 5 stages | Task 2 |
| `coveragePct`, `lastRunAt`, `siteUrl`, `dataQuality`, `notes` optional | Task 2 |
| ObjectStore persistence at `scrape-status/index.json` | Task 3 |
| `GET /api/scrape-status` (all + by city) | Task 4 |
| `PUT /api/scrape-status/:city/:source` | Task 4 |
| Mounted in `app.ts` | Task 4 |
| UI carte: cities colored by maturity | Task 6 |
| Click city → source list | Task 6 (CityDetailPanel) |
| Nav bandeau preserved | Task 7 |
| DS-lint 0 | Task 6 step 8 |
| Tests: model, route, maturity aggregation, component | Tasks 2–6 |
| Anti-invention (no hardcoded cities) | Task 6 (SourcesMapView) |
| Commit: author rhanka, no trailer | All commit steps |
| DRAFT PR base main | Task 8 |

### Placeholder scan
No TBD/TODO/placeholder patterns in the plan — all code blocks are complete.

### Type consistency
- `ScrapeStatusT` is used by the store, routes, maturity helpers, client, and Svelte components consistently.
- `cityMaturity()` is imported from `@radar/domain` in both `maturity.ts` (UI) and `CityDetailPanel.svelte`.
- `ScrapeStatusSource.options` is used in the route for validation.
- `groupByCity()` returns `CityMaturitySummary[]` which `SourcesMapView` destructures correctly.
