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

export interface CiblageDeps {
  store: ObjectStore;
}

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
): Hono {
  const app = new Hono();
  const store = injectedStore ?? createCiblageStore(deps.store);

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

  return app;
}
