import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  parseProjectState,
  projectStateKey,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import {
  seedCityOntology,
  SEED_CITY_SLUGS,
} from "../services/sources/seed-ontology.js";

export interface OntologyDeps {
  store: ObjectStore;
}

/**
 * Read-only ontology project-state API (EXPLOITATION output → reconciliation
 * studio). Serves the per-city graphify project state persisted by the
 * exploitation service (D1): canonical entities, reconciliation candidates, and
 * raw mentions — the exact data a reconciliation screen renders. Mutation
 * (accept/reject patches) is deferred to the studio's write-guarded core.
 */
async function loadState(
  store: ObjectStore,
  citySlug: string,
): Promise<OntologyProjectState | null> {
  const key = projectStateKey(citySlug);
  const head = await store.head(key);
  if (!head) return null;
  const bytes = await store.get(key);
  return parseProjectState(bytes);
}

export function ontologyRoute(deps: OntologyDeps): Hono {
  const app = new Hono();

  /** Canonical entities for the reconciliation screen. */
  app.get("/api/ontology/:city/entities", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      entities: state.canonicals,
    });
  });

  /** Reconciliation candidates (entity_match queue). */
  app.get("/api/ontology/:city/candidates", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      candidates: state.candidates,
    });
  });

  /** Raw modeled-entity mentions. */
  app.get("/api/ontology/:city/mentions", async (c) => {
    const city = c.req.param("city");
    const state = await loadState(deps.store, city);
    if (!state) {
      return c.json({ ok: false, error: "no-project-state", city }, 404);
    }
    return c.json({
      ok: true,
      citySlug: state.citySlug,
      profileHash: state.profileHash,
      generatedAt: state.generatedAt,
      rawRefs: state.rawRefs,
      mentions: state.mentions,
    });
  });

  /**
   * POST /api/ontology/:city/exploit-samples — NETWORK-FREE real-data seed
   * (SPEC_ONTOLOGY §0.2). Wraps the city's REAL committed MAMH role sample bytes
   * as a RawDocument in S3 (reusing the RECUEIL substrate), runs EXPLOITATION +
   * the radar validators (D3), and persists the per-city project state so the
   * reconciliation studio is populated with REAL entities on a fresh stack.
   * No fabrication: every entity comes from `parseRoleEvaluation` on real bytes.
   */
  app.post("/api/ontology/:city/exploit-samples", async (c) => {
    const city = c.req.param("city");
    if (!SEED_CITY_SLUGS.includes(city)) {
      return c.json(
        {
          ok: false,
          error: "unknown-city",
          detail: `No committed role sample for "${city}"`,
          available: SEED_CITY_SLUGS,
        },
        404,
      );
    }
    const result = await seedCityOntology(deps.store, city);
    return c.json(
      {
        ok: result.ok,
        citySlug: result.citySlug,
        rawRef: result.rawRef,
        mentionCount: result.mentionCount,
        candidateCount: result.candidateCount,
        canonicalCount: result.canonicalCount,
        signalCount: result.signalCount,
        realEntities: result.realEntities,
        stateKey: result.stateKey,
        validation: result.validation,
      },
      200,
    );
  });

  return app;
}
