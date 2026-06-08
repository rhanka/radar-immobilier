import {
  AVIS_PUBLICS_SOURCE_ID,
  createAvisPublicsValleyfieldAdapter,
  type SourceAdapter,
} from "@radar/sources";
import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import { runRecueil } from "../services/sources/recueil.js";

export interface SourcesDeps {
  store: ObjectStore;
}

/**
 * Registry of REAL RECUEIL adapters keyed by source id. Each factory builds a
 * stateless SourceAdapter (J0 contract). Adding a source = one entry here plus
 * the adapter in `@radar/sources`.
 */
const ADAPTERS: Record<string, () => SourceAdapter> = {
  [AVIS_PUBLICS_SOURCE_ID]: () => createAvisPublicsValleyfieldAdapter(),
};

/**
 * Builds the /api/sources routes (RECUEIL stage).
 *
 * POST /api/sources/collect/:source runs the source's adapter, stores the raw
 * payload(s) in object storage (before any extraction), and returns
 * `{ ok, source, count, rawDocIds, fetchedAt }`. Upstream failures come back as
 * a typed `{ ok: false, error, detail }` with HTTP 502 — the job never crashes
 * the request.
 */
export function sourcesRoute(deps: SourcesDeps): Hono {
  const app = new Hono();

  app.post("/api/sources/collect/:source", async (c) => {
    const source = c.req.param("source");
    const factory = ADAPTERS[source];
    if (!factory) {
      return c.json(
        {
          ok: false,
          error: "unknown-source",
          detail: `No RECUEIL adapter registered for "${source}"`,
          available: Object.keys(ADAPTERS),
        },
        404,
      );
    }

    const outcome = await runRecueil(source, factory(), deps.store);
    if (!outcome.ok) {
      return c.json(outcome, 502);
    }
    return c.json(
      {
        ok: true,
        source: outcome.source,
        count: outcome.count,
        rawDocIds: outcome.rawDocIds,
        fetchedAt: outcome.fetchedAt,
      },
      200,
    );
  });

  return app;
}
