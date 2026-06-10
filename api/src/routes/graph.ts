/**
 * WP A.3.1 — Graph read routes.
 *
 * GET /api/graph/mrcs        — list MRCs with ≥1 ingested node + node counts.
 * GET /api/graph/mrc/:mrc    — merged sub-graph for an MRC (all cities in MRC).
 * GET /api/graph/:city       — sub-graph for a given city slug (all nodes +
 *                              all intra-city edges).
 *
 * Route order matters: /api/graph/mrcs and /api/graph/mrc/:mrc must be
 * registered before /api/graph/:city so that "mrcs" is not captured as a city
 * slug by the wildcard parameter.
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import {
  subgraphForCity,
  subgraphForMrc,
  listMrcs,
} from "../services/graph/graph-store.js";

export interface GraphDeps {
  db: Database;
}

export function graphRoute(deps: GraphDeps): Hono {
  const app = new Hono();

  /**
   * List all MRCs that have at least one ingested graph node.
   *
   * Returns `{ ok: true, mrcs: [{ mrc, nodeCount, citySlugs[] }] }`.
   * Returns an empty array (not 404) when nothing has been ingested yet.
   */
  app.get("/api/graph/mrcs", async (c) => {
    const mrcs = await listMrcs(deps.db);
    return c.json({
      ok: true,
      mrcCount: mrcs.length,
      mrcs,
    });
  });

  /**
   * Merged sub-graph for an MRC — all nodes from every city in the MRC plus
   * all intra-MRC edges (both endpoints within the MRC node set).
   *
   * Returns `{ ok: true, mrc, citySlugs[], nodeCount, edgeCount, nodes[], edges[] }`.
   * Returns 404 when the MRC is unknown (no matching cities in QC_MUNICIPALITIES)
   * or when no graph data has been ingested for any city in that MRC.
   */
  app.get("/api/graph/mrc/:mrc", async (c) => {
    const mrc = c.req.param("mrc");
    const subgraph = await subgraphForMrc(deps.db, mrc);

    if (subgraph.nodes.length === 0) {
      return c.json(
        { ok: false, error: "no-graph-data", mrc },
        404,
      );
    }

    return c.json({
      ok: true,
      mrc: subgraph.mrc,
      citySlugs: subgraph.citySlugs,
      nodeCount: subgraph.nodes.length,
      edgeCount: subgraph.edges.length,
      nodes: subgraph.nodes,
      edges: subgraph.edges,
    });
  });

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
