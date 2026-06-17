/**
 * Routes GET /api/geo/features/:citySlug et GET /api/geo/cities — G3 WP géo-intégration.
 *
 * GET /api/geo/features/:citySlug
 *   Retourne la FeatureCollection GeoJSON fusionnée : zones + lots + opportunités.
 *   Réponse : { ok, citySlug, zoneCount, lotCount, opportuniteCount, zones, lots, opportunites }
 *
 * GET /api/geo/cities
 *   Retourne la liste des villes ayant des zones/lots/résolutions.
 *   Réponse : { ok, cities: [{ citySlug, zoneCount, lotCount, signalCount }] }
 *
 * Loi 25 : zonage public, aucune PII propriétaire.
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { getGeoFeatures, listGeoCities } from "../services/geo/geo-features.js";

export interface GeoFeaturesDeps {
  db: Database;
}

export function geoFeaturesRoute(deps: GeoFeaturesDeps): Hono {
  const app = new Hono();

  /**
   * GET /api/geo/cities
   * Villes ayant des zones géoréférencées, des lots ou des résolutions.
   */
  app.get("/api/geo/cities", async (c) => {
    try {
      const cities = await listGeoCities(deps.db);
      return c.json({ ok: true, cities });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: "geo_cities_error", detail: msg }, 500);
    }
  });

  /**
   * GET /api/geo/features/:citySlug
   * FeatureCollection fusionnée : zones (choroplèthe) + lots + opportunités (points).
   */
  app.get("/api/geo/features/:citySlug", async (c) => {
    const citySlug = c.req.param("citySlug");
    if (!citySlug || citySlug.trim() === "") {
      return c.json({ ok: false, error: "missing_city_slug" }, 400);
    }

    try {
      const result = await getGeoFeatures(deps.db, citySlug.trim().toLowerCase());
      return c.json({
        ok: true,
        citySlug: result.citySlug,
        zoneCount: result.zoneCount,
        lotCount: result.lotCount,
        opportuniteCount: result.opportuniteCount,
        zones: result.zones,
        lots: result.lots,
        opportunites: result.opportunites,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: "geo_features_error", detail: msg }, 500);
    }
  });

  return app;
}
