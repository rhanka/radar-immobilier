import { Hono } from "hono";
import {
  collectAvisPublicsValleyfield,
  type CollectOutcome,
} from "../services/automation/avis-publics-valleyfield.js";

/** Registry of REAL, key-less collectors exposed by the automation endpoint. */
const COLLECTORS: Record<string, () => Promise<CollectOutcome>> = {
  "avis-publics-valleyfield": () => collectAvisPublicsValleyfield(),
};

/**
 * Builds the /api/automation routes.
 *
 * POST /api/automation/collect/:source runs a real, server-side, key-less
 * collector and returns `{ source, sourceUrl, fetchedAt, count, items }` on
 * success, or a typed `{ ok: false, error, detail }` on failure (with an
 * appropriate HTTP status). The connector never crashes the request.
 */
export function automationRoute(): Hono {
  const app = new Hono();

  app.post("/api/automation/collect/:source", async (c) => {
    const source = c.req.param("source");
    const collector = COLLECTORS[source];
    if (!collector) {
      return c.json(
        {
          ok: false,
          error: "unknown-source",
          detail: `No real collector registered for "${source}"`,
          available: Object.keys(COLLECTORS),
        },
        404,
      );
    }

    const outcome = await collector();
    if (!outcome.ok) {
      // 502 for upstream-source failures, the connector itself did not crash.
      return c.json(outcome, 502);
    }
    return c.json(outcome, 200);
  });

  return app;
}
