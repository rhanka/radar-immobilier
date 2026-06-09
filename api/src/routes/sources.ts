import {
  AVIS_PUBLICS_BEAUHARNOIS_CITY,
  AVIS_PUBLICS_CITY,
  AVIS_PUBLICS_SOURCE_ID,
  createAvisPublicsValleyfieldAdapter,
  createRoleEvaluationMamhAdapter,
  roleSourceId,
  type SourceAdapter,
} from "@radar/sources";
import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import { runRecueil } from "../services/sources/recueil.js";
import { runExploitation } from "../services/sources/exploitation.js";

export interface SourcesDeps {
  store: ObjectStore;
}

/** Pilot-city MAMH rôle codes (Valleyfield 70052, Beauharnois 70022). */
const ROLE_MAMH_VALLEYFIELD = "70052";
const ROLE_MAMH_BEAUHARNOIS = "70022";

/**
 * Registry of REAL RECUEIL adapters keyed by source id. Each factory builds a
 * stateless SourceAdapter (J0 contract). Adding a source = one entry here plus
 * the adapter in `@radar/sources`.
 *
 * The rôle d'évaluation MAMH adapters (WP4 Source #3) make the rôle a REAL
 * collectible source: a collected rôle XML RawDocument flows through the SAME
 * recueil → exploitation pipeline as the avis indexes (the exploitation mention
 * extractor already dispatches role XML → Lot/Valuation mentions). The source id
 * matches the deterministic seed-ontology id, so collect and seed share storage.
 */
const ADAPTERS: Record<string, () => SourceAdapter> = {
  [AVIS_PUBLICS_SOURCE_ID]: () => createAvisPublicsValleyfieldAdapter(),
  [roleSourceId(ROLE_MAMH_VALLEYFIELD)]: () =>
    createRoleEvaluationMamhAdapter({
      codeMamh: ROLE_MAMH_VALLEYFIELD,
      city: AVIS_PUBLICS_CITY,
    }),
  [roleSourceId(ROLE_MAMH_BEAUHARNOIS)]: () =>
    createRoleEvaluationMamhAdapter({
      codeMamh: ROLE_MAMH_BEAUHARNOIS,
      city: AVIS_PUBLICS_BEAUHARNOIS_CITY,
    }),
};

/** City scope per source id (per-city graphify project, D1). */
const SOURCE_CITY: Record<string, string> = {
  [AVIS_PUBLICS_SOURCE_ID]: AVIS_PUBLICS_CITY,
  [roleSourceId(ROLE_MAMH_VALLEYFIELD)]: AVIS_PUBLICS_CITY,
  [roleSourceId(ROLE_MAMH_BEAUHARNOIS)]: AVIS_PUBLICS_BEAUHARNOIS_CITY,
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

  /**
   * POST /api/sources/collect-and-exploit/:source — end-to-end on REAL data:
   * RECUEIL (collect raw docs to S3) then EXPLOITATION (re-read bytes → modeled
   * mentions → graphify reconciliation → persisted per-city project state). The
   * resulting state is served read-only at GET /api/ontology/:city/*.
   */
  app.post("/api/sources/collect-and-exploit/:source", async (c) => {
    const source = c.req.param("source");
    const factory = ADAPTERS[source];
    const citySlug = SOURCE_CITY[source];
    if (!factory || !citySlug) {
      return c.json(
        {
          ok: false,
          error: "unknown-source",
          detail: `No exploitation pipeline registered for "${source}"`,
          available: Object.keys(ADAPTERS),
        },
        404,
      );
    }

    const outcome = await runRecueil(source, factory(), deps.store);
    if (!outcome.ok) {
      return c.json(outcome, 502);
    }

    const exploit = await runExploitation({
      store: deps.store,
      citySlug,
      rawDocRecords: outcome.records,
    });

    return c.json(
      {
        ok: true,
        source: outcome.source,
        citySlug,
        rawDocIds: outcome.rawDocIds,
        mentionCount: exploit.mentionCount,
        candidateCount: exploit.candidateCount,
        canonicalCount: exploit.canonicalCount,
        stateKey: exploit.stateKey,
        fetchedAt: outcome.fetchedAt,
      },
      200,
    );
  });

  return app;
}
