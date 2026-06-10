import {
  CiblagePlanInput,
  CiblagePlanPatch,
  type CiblagePlanInputT,
  type CiblagePlanPatchT,
} from "@radar/domain";
import { ALL_PRIORITY_SOURCE_BINDINGS } from "@radar/sources";
import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  createCiblageStore,
  type CiblageStore,
} from "../services/ciblage/ciblage-store.js";
import { createJobsStore } from "../services/pipeline/jobs-store.js";
import {
  defaultAdapterRegistry,
  type AdapterRegistry,
} from "../services/pipeline/adapter-registry.js";
import {
  runCiblagePlan,
  type RunCiblagePlanResult,
} from "../services/pipeline/executor.js";

export interface CiblageDeps {
  store: ObjectStore;
  /**
   * Optional dedicated store for raw scraped documents. When provided, RECUEIL
   * writes raw bytes here (e.g. SCW `radar-immobilier-docs`) while ciblage plans,
   * jobs, and project-state remain on `store`. Absent ⇒ `store` handles all
   * (local-dev MinIO default).
   */
  scrapeStore?: ObjectStore;
}

/**
 * Injectable run hook: drives recueil→exploitation for an enabled plan and
 * returns the produced Job. Tests inject a fixture-backed runner (no network);
 * production wires the default registry of REAL network adapters.
 */
export type CiblageRunner = (planId: string) => Promise<RunCiblagePlanResult>;

/** Set of REAL, selectable source-binding ids (anti-invention guard). */
const KNOWN_SOURCE_BINDING_IDS = new Set(
  ALL_PRIORITY_SOURCE_BINDINGS.map((b) => b.sourceId),
);

/**
 * Reject any source-binding id that is not a real `prioritySources` binding.
 * Returns the offending ids (empty array = all valid). This is the anti-invention
 * guard: a ciblage plan can only target sources that actually exist.
 */
function unknownBindingIds(ids: readonly string[]): string[] {
  return ids.filter((id) => !KNOWN_SOURCE_BINDING_IDS.has(id));
}

/**
 * Builds the /api/ciblage routes (CIBLAGE — pipeline stage 1).
 *
 * Pure declaration: these endpoints only read/write `CiblagePlan` documents. NO
 * collection is triggered (that is the RECUEIL execution lot). The plan id is
 * what a later recueil run stamps onto each collected RawDocument provenance
 * (`ciblagePlanId`).
 *
 *   GET    /api/ciblage           — list plans + the selectable source catalogue
 *   GET    /api/ciblage/:id       — one plan
 *   POST   /api/ciblage           — create (validated `CiblagePlanInput`)
 *   PATCH  /api/ciblage/:id       — edit (validated `CiblagePlanPatch`)
 *   DELETE /api/ciblage/:id       — delete
 *
 * A `store` (CiblageStore) can be injected for tests; production builds one over
 * the injected ObjectStore.
 */
export function ciblageRoute(
  deps: CiblageDeps,
  injectedStore?: CiblageStore,
  injectedRunner?: CiblageRunner,
  injectedRegistry?: AdapterRegistry,
): Hono {
  const app = new Hono();
  const store = injectedStore ?? createCiblageStore(deps.store);

  /**
   * Default runner: build the production adapter registry (REAL public-data
   * adapters) and drive the executor over the plan, persisting the Job. Tests
   * inject `injectedRunner` (fixture adapters, no network) instead.
   */
  const run: CiblageRunner =
    injectedRunner ??
    ((planId: string) =>
      runCiblagePlan({
        ciblageStore: store,
        jobsStore: createJobsStore(deps.store),
        objectStore: deps.store,
        ...(deps.scrapeStore ? { scrapeStore: deps.scrapeStore } : {}),
        registry: injectedRegistry ?? defaultAdapterRegistry(),
        planId,
      }));

  /** List plans + the REAL source-binding catalogue the picker selects from. */
  app.get("/api/ciblage", async (c) => {
    const plans = await store.list();
    return c.json({
      ok: true,
      plans,
      // The picker offers ONLY these real bindings (no fabricated sources).
      sourceBindings: ALL_PRIORITY_SOURCE_BINDINGS.map((b) => ({
        sourceId: b.sourceId,
        kind: b.kind,
        ...(b.city !== undefined ? { city: b.city } : {}),
        tier: b.tier,
        cadence: b.cadence,
      })),
    });
  });

  app.get("/api/ciblage/:id", async (c) => {
    const plan = await store.get(c.req.param("id"));
    if (!plan) {
      return c.json({ ok: false, error: "not-found" }, 404);
    }
    return c.json({ ok: true, plan });
  });

  app.post("/api/ciblage", async (c) => {
    const parsed = CiblagePlanInput.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "invalid-plan", details: parsed.error.issues },
        400,
      );
    }
    const input: CiblagePlanInputT = parsed.data;
    const bad = unknownBindingIds(input.sourceBindingIds);
    if (bad.length > 0) {
      return c.json(
        {
          ok: false,
          error: "unknown-source-binding",
          detail: `Not in the priority-sources catalogue: ${bad.join(", ")}`,
          unknown: bad,
        },
        400,
      );
    }
    const plan = await store.create(input);
    return c.json({ ok: true, plan }, 201);
  });

  app.patch("/api/ciblage/:id", async (c) => {
    const parsed = CiblagePlanPatch.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return c.json(
        { ok: false, error: "invalid-patch", details: parsed.error.issues },
        400,
      );
    }
    const patch: CiblagePlanPatchT = parsed.data;
    if (patch.sourceBindingIds !== undefined) {
      const bad = unknownBindingIds(patch.sourceBindingIds);
      if (bad.length > 0) {
        return c.json(
          {
            ok: false,
            error: "unknown-source-binding",
            detail: `Not in the priority-sources catalogue: ${bad.join(", ")}`,
            unknown: bad,
          },
          400,
        );
      }
    }
    const plan = await store.update(c.req.param("id"), patch);
    if (!plan) {
      return c.json({ ok: false, error: "not-found" }, 404);
    }
    return c.json({ ok: true, plan });
  });

  app.delete("/api/ciblage/:id", async (c) => {
    const removed = await store.remove(c.req.param("id"));
    if (!removed) {
      return c.json({ ok: false, error: "not-found" }, 404);
    }
    return c.json({ ok: true });
  });

  /**
   * POST /api/ciblage/:id/run — EXECUTE the pipeline for an enabled plan.
   *
   * Drives RECUEIL → EXPLOITATION over each (citySlug × sourceBinding) the plan
   * declares (reusing the existing collect+exploit path), stamping the plan id
   * onto every collected RawDocument (`ciblagePlanId`), and persists a `Job`
   * record. Runs synchronously and returns the finished Job so the UI can show
   * the outcome immediately; the run is responsive at demo scale (idempotent
   * recueil, bounded sources). A failing source becomes a failed step + a
   * `partial` job — the request never 500s on an upstream outage.
   */
  app.post("/api/ciblage/:id/run", async (c) => {
    const result = await run(c.req.param("id"));
    if (!result.ok) {
      const httpStatus =
        result.error === "plan-not-found"
          ? 404
          : result.error === "plan-disabled"
            ? 409
            : 400;
      return c.json(
        { ok: false, error: result.error, detail: result.detail },
        httpStatus,
      );
    }
    return c.json({ ok: true, job: result.job }, 200);
  });

  return app;
}
