import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  parseProjectState,
  projectStateKey,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";

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

  return app;
}
