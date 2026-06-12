/**
 * Route GET /api/geo/:city/lots — WP B slice-1.
 *
 * Retourne les lots cadastraux (Cadastre_allege MRNF) pour une ville.
 * Sortie : { ok, citySlug, source, featureCollection } — Loi 25, sans PII.
 *
 * Query params :
 *   limit   — entier > 0, défaut 200
 *   bbox    — "minX,minY,maxX,maxY" en EPSG:4326
 *
 * Chaque feature porte `potentialScore` (0–10) dans ses properties.
 * Échelle DISTINCTE du 0-5 T2 et du 0-100 legacy.
 * Quand le contexte de zone n'est pas injecté, le score est calculé avec
 * densiteLogHa=null (score base = 0 sauf bonus si zoneVersion fournie).
 */

import { Hono } from "hono";
import { lotsForCity } from "../services/geo/lots.js";
import {
  lotPotentialScore,
  type LotVersionInput,
  type ZoneVersionInput,
} from "../services/scoring/lot-potential.js";

/**
 * Fournisseur de contexte de zone pour le scoring.
 * Reçoit noLot et citySlug, retourne un ZoneVersionInput ou null
 * (null = score calculé avec toutes valeurs null).
 *
 * En production (sans DB live) : retourne null → score = 0 par défaut.
 * Injecteable via deps pour les tests ou une future couche DB.
 */
export type ZoneVersionProvider = (
  noLot: string,
  citySlug: string,
) => ZoneVersionInput | null;

/** Dépendances injectées pour la route. */
export interface GeoLotsDeps {
  /** fetchImpl injectable pour les tests (défaut = global fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Fournisseur optionnel de ZoneVersion par lot.
   * Si absent, les scores sont calculés sans contexte de zone (densiteLogHa=null).
   */
  zoneVersionProvider?: ZoneVersionProvider;
}

/** ZoneVersion neutre : toutes valeurs null/vides. */
const NULL_ZONE_VERSION: ZoneVersionInput = {
  densiteLogHa: null,
  usages: [],
  kind: "AUTRE",
};

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

    // Enrichissement du score de potentiel par lot.
    // lotInput : LotVersionInput avec seulement superficieM2 et usageCode.
    // Ces champs ne sont pas dans le cadastre allégé (MRNF) → null pour l'instant.
    // Le score est calculable (retourne 0 si tout null) — aucune valeur inventée.
    const featuresWithScore = result.featureCollection.features.map((f) => {
      const noLot = f.properties.noLot;
      const zoneVersion: ZoneVersionInput =
        deps.zoneVersionProvider?.(noLot, citySlug) ?? NULL_ZONE_VERSION;

      const lotInput: LotVersionInput = {
        superficieM2: null,
        usageCode: null,
      };

      const { score } = lotPotentialScore(lotInput, zoneVersion);

      return {
        ...f,
        properties: {
          ...f.properties,
          potentialScore: score,
        },
      };
    });

    return c.json({
      ok: true,
      citySlug: result.citySlug,
      source: result.source,
      featureCollection: {
        ...result.featureCollection,
        features: featuresWithScore,
      },
    });
  });

  return app;
}
