/**
 * WP A.3.x — Graph-signals read routes.
 *
 * Expose Signal and DesignationEvent nodes from graph_nodes as a T1 signal
 * feed — the REAL graphify pipeline (1 141 nodes / ~197 villes), NOT the old
 * ontology project-state (9 pilot cities only).
 *
 * GET /api/graph-signals/by-city
 *   Returns aggregate signal counts per city.
 *   Response: { ok: true, totalCount, cities: [{ citySlug, signalCount, countsByType,
 *               zonageCount, multi4plusCount, countsByStage }] }
 *
 * GET /api/graph-signals/:city
 *   Returns Signal + DesignationEvent nodes for one city.
 *   Response: { ok: true, citySlug, nodes: [{ id, type, label, citySlug, sourceRef, createdAt, props }] }
 *   Returns 404 when no signal nodes exist for the city.
 */

import { Hono } from "hono";
import { getSignalNodesForCity, listCitiesWithSignalNodes } from "../services/graph/graph-store.js";
import type { Database } from "../db/client.js";

export interface GraphSignalsDeps {
  db: Database;
}

export function graphSignalsRoute(deps: GraphSignalsDeps): Hono {
  const app = new Hono();

  // GET /api/graph-signals/by-city
  app.get("/api/graph-signals/by-city", async (c) => {
    const cities = await listCitiesWithSignalNodes(deps.db);
    const totalCount = cities.reduce((sum, city) => sum + city.signalCount, 0);
    return c.json({ ok: true, totalCount, cities });
  });

  // GET /api/graph-signals/:city
  app.get("/api/graph-signals/:city", async (c) => {
    const city = c.req.param("city");
    const nodes = await getSignalNodesForCity(deps.db, city);
    if (nodes.length === 0) {
      return c.json({ ok: false, error: "no_signal_nodes", citySlug: city }, 404);
    }
    const mapped = nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      citySlug: n.citySlug,
      sourceRef: n.sourceRef,
      createdAt: n.createdAt ? n.createdAt.toISOString() : null,
      props: n.props ?? {},
    }));
    return c.json({ ok: true, citySlug: city, nodes: mapped });
  });

  return app;
}
