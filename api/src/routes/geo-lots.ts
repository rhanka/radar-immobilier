/**
 * Route GET /api/geo/:city/lots — WP B slice-1.
 *
 * Retourne les lots cadastraux (Cadastre_allege MRNF) pour une ville.
 * Sortie : { ok, citySlug, source, featureCollection } — Loi 25, sans PII.
 *
 * Query params :
 *   limit   — entier > 0, défaut 200
 *   bbox    — "minX,minY,maxX,maxY" en EPSG:4326
 */

import { Hono } from "hono";
import { lotsForCity } from "../services/geo/lots.js";

/** Pas de dépendances injectées pour cette route (le service est autonome). */
export interface GeoLotsDeps {
  /** fetchImpl injectable pour les tests (défaut = global fetch). */
  fetchImpl?: typeof fetch;
}

export function geoLotsRoute(deps: GeoLotsDeps = {}): Hono {
  const app = new Hono();

  app.get("/api/geo/:city/lots", async (c) => {
    const citySlug = c.req.param("city");

    // Parse limit
    const rawLimit = c.req.query("limit");
    const limit = rawLimit ? parseInt(rawLimit, 10) : 200;
    if (isNaN(limit) || limit <= 0) {
      return c.json(
        { ok: false, error: "invalid-param", detail: "limit doit être un entier > 0" },
        400,
      );
    }

    // Parse bbox
    let bbox: [number, number, number, number] | undefined;
    const rawBbox = c.req.query("bbox");
    if (rawBbox) {
      const parts = rawBbox.split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => isNaN(n))) {
        return c.json(
          {
            ok: false,
            error: "invalid-param",
            detail: "bbox doit être 'minX,minY,maxX,maxY' (EPSG:4326)",
          },
          400,
        );
      }
      bbox = parts as [number, number, number, number];
    }

    const serviceOpts = {
      limit,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(bbox !== undefined ? { bbox } : {}),
    };
    const result = await lotsForCity(citySlug, serviceOpts);

    if (!result.ok) {
      const status =
        result.reason?.includes("inconnue") || result.reason?.includes("Ville") ? 404 : 502;
      return c.json(
        {
          ok: false,
          citySlug: result.citySlug,
          source: result.source,
          reason: result.reason,
          featureCollection: result.featureCollection,
        },
        status,
      );
    }

    return c.json({
      ok: true,
      citySlug: result.citySlug,
      source: result.source,
      featureCollection: result.featureCollection,
    });
  });

  return app;
}
