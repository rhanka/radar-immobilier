/**
 * WP A.3.1 — Graph read routes.
 *
 * GET /api/graph/:city  — sub-graph for a given city slug (all nodes +
 *                         all intra-city edges).
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { subgraphForCity } from "../services/graph/graph-store.js";

export interface GraphDeps {
  db: Database;
}

export function graphRoute(deps: GraphDeps): Hono {
  const app = new Hono();

  /**
   * Sub-graph for a city — all `graph_nodes` with the given `city_slug` plus
   * all `graph_edges` whose both endpoints belong to that node set.
   *
   * Returns `{ ok: true, citySlug, nodes[], edges[] }` or 404 when no nodes
   * are stored for the requested city.
   */
  app.get("/api/graph/:city", async (c) => {
    const city = c.req.param("city");
    const subgraph = await subgraphForCity(deps.db, city);

    if (subgraph.nodes.length === 0) {
      return c.json(
        { ok: false, error: "no-graph-data", city },
        404,
      );
    }

    return c.json({
      ok: true,
      citySlug: subgraph.citySlug,
      nodeCount: subgraph.nodes.length,
      edgeCount: subgraph.edges.length,
      nodes: subgraph.nodes,
      edges: subgraph.edges,
    });
  });

  return app;
}
