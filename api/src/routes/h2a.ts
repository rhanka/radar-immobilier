/**
 * EV10: Real h2a coordination journal API (Hono).
 *
 * The radar decisions (qualifier / surveiller / approcher) flow through a REAL
 * `@sentropic/h2a` signed, hash-chained journal (see `services/h2a`). This
 * route exposes that journal to the Coordination UI view.
 *
 *   GET  /api/h2a/journal     : the chain-verified journal (entries + actors + policy)
 *   POST /api/h2a/decisions   : record a PRINCIPAL decision + CONDUCTOR ack
 *   GET  /api/h2a/policy      : the radar POLICY artifacts
 *
 * The store is a process-lifetime in-memory chain (the demo has no journal
 * persistence layer yet). A restart mints a fresh keyring and resets the chain;
 * the truth is re-derived, never faked.
 */

import { Hono } from "hono";
import { z } from "zod";

import { createJournalStore, type H2AJournalStore } from "../services/h2a/journal-store.js";
import { RADAR_POLICIES, RADAR_SCOPE } from "../services/h2a/policy.js";

const decisionSchema = z.object({
  kind: z.enum(["qualifier", "surveiller", "approcher"]),
  entity: z.string().trim().min(1).max(200),
  rationale: z.string().trim().max(2000).optional(),
});

/** Process-lifetime default store for the running demo API. */
const defaultStore = createJournalStore();

/**
 * Builds the /api/h2a routes. A `store` can be injected for tests; production
 * uses the shared process-lifetime store.
 */
export function h2aRoute(store: H2AJournalStore = defaultStore): Hono {
  const app = new Hono();

  /** The chain-verified journal snapshot. */
  app.get("/api/h2a/journal", (c) => c.json(store.snapshot()));

  /** The radar POLICY artifacts. */
  app.get("/api/h2a/policy", (c) => c.json({ scope: RADAR_SCOPE, policies: RADAR_POLICIES }));

  /** Record a PRINCIPAL decision + its CONDUCTOR acknowledgement. */
  app.post("/api/h2a/decisions", async (c) => {
    const parsed = decisionSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
    }
    const { kind, entity, rationale } = parsed.data;
    const snapshot = store.recordDecision({
      kind,
      entity,
      ...(rationale ? { rationale } : {}),
    });
    return c.json(snapshot, 201);
  });

  return app;
}
