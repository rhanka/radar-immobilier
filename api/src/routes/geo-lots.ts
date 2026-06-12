/**
 * Route GET /api/geo/:city/lots — WP B slice-1 + CS-L6 simulation (enrichi enrich-zone).
 *
 * Retourne les lots cadastraux pour une ville.
 * Sortie : { ok, citySlug, source, featureCollection } — Loi 25, sans PII.
 *
 * ## Sources
 * - mode "donnees-quebec" : Cadastre_allege MRNF (villes réelles).
 * - mode "simulation" : fixtures Netlify Steve pour les 4 villes Steve
 *   (delson, sainte-catherine, saint-constant, candiac). CS-L6.
 *   Les données simulation portent mode:"simulation" et NE polluent JAMAIS
 *   le store réel (SPEC_EVOL_SOCLE_STATES_SCORING.md §2.7).
 *
 * Query params :
 *   limit   — entier > 0, défaut 200
 *   bbox    — "minX,minY,maxX,maxY" en EPSG:4326
 *
 * ## Champs enrichis par lot (feat/geo-lots-enrich-zone)
 *
 * Chaque feature.properties expose désormais :
 *   - `noLot`         — identifiant cadastral public (NO_LOT)
 *   - `citySlug`      — slug de la ville
 *   - `superficieM2`  — superficie calculée depuis la géométrie GeoJSON (m², arrondi
 *                       à 1 décimale) ; null si la géométrie est absente ou non-polygone.
 *                       Source : cadastre allégé MRNF (polygone). Les superficies du rôle
 *                       (RL0302A) ne sont pas disponibles dans ce flux.
 *   - `usageCode`     — code d'usage (RU/CH/BO/AV/TE). null : non disponible dans ce
 *                       flux (source = rôle MAMH XML, non branché ici). Anti-invention.
 *   - `zone`          — { kind, usages, densiteLogHa } si le ZoneVersionProvider résout
 *                       le lot vers une zone ; null sinon (honnête).
 *   - `potentialScore` — score 0–10 dérivé de zone ∩ usageCode ∩ inTod.
 *                        Échelle DISTINCTE du 0-5 T2 et du 0-100 legacy.
 *                        0 quand zone absente (anti-invention).
 *
 * ## Anti-PII
 * Aucun champ propriétaire ni donnée personnelle dans la sortie.
 */

import { Hono } from "hono";
import { lotsForCity } from "../services/geo/lots.js";
import {
  lotPotentialScore,
  type LotVersionInput,
  type ZoneVersionInput,
  type ZoneKind,
} from "../services/scoring/lot-potential.js";
import {
  isSimulationCity,
  getSimulationLotsFeatureCollection,
} from "../services/geo/simulation/simulation-provider.js";

// ─── Calcul superficie depuis géométrie GeoJSON ───────────────────────────────

/**
 * Calcule l'aire d'un anneau de polygone (coordonnées [lon, lat] en degrés)
 * via la formule de Shoelace dans l'espace géographique projeté en mètres.
 *
 * Approximation locale : Δlon * cos(lat_moy) pour avoir des mètres est suffisante
 * pour des lots < 1 km². Erreur < 0.1 % sur le territoire QC (lat ~45°).
 * Anti-invention : retourne null si l'anneau a moins de 3 points.
 */
function ringAreaM2(
  ring: number[][],
  latMidDeg: number,
): number | null {
  if (ring.length < 3) return null;

  const DEG_TO_RAD = Math.PI / 180;
  // Mètres par degré de latitude (constant à ~111 320 m/°)
  const metersPerDegLat = 111_320;
  // Mètres par degré de longitude (varie avec lat)
  const metersPerDegLon =
    111_320 * Math.cos(latMidDeg * DEG_TO_RAD);

  // Shoelace dans l'espace local (x = lon * metersPerDegLon, y = lat * metersPerDegLat)
  let area = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0]! * metersPerDegLon;
    const yi = ring[i]![1]! * metersPerDegLat;
    const xj = ring[j]![0]! * metersPerDegLon;
    const yj = ring[j]![1]! * metersPerDegLat;
    area += (xj + xi) * (yj - yi);
  }
  return Math.abs(area) / 2;
}

/**
 * Estime la superficie en m² depuis une géométrie GeoJSON Polygon.
 * - Prend l'anneau extérieur (index 0) uniquement (anti-invention : ne soustrait pas
 *   les trous, ce qui est conservateur).
 * - Retourne null si la géométrie est null, non-Polygon, ou invalide.
 */
function superficieFromGeometry(
  geom: { type: string; coordinates: unknown } | null,
): number | null {
  if (!geom) return null;
  if (geom.type !== "Polygon") return null;

  const coords = geom.coordinates as number[][][];
  const outerRing = coords[0];
  if (!outerRing || outerRing.length < 3) return null;

  // Latitude médiane pour la projection
  const lats = outerRing.map((pt) => pt[1]!);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;

  const area = ringAreaM2(outerRing, latMid);
  if (area === null) return null;

  // Arrondi à 1 décimale (précision suffisante pour la fiche lot)
  return Math.round(area * 10) / 10;
}

// ─── Types exportés ──────────────────────────────────────────────────────────

/**
 * Fournisseur de contexte de zone pour le scoring.
 * Reçoit noLot et citySlug, retourne un ZoneVersionInput ou null
 * (null = zone non résolue → score 0).
 *
 * En production sans `lot_zone_resolution` : retourne null → score 0 honnête.
 * Injectable via deps pour les tests ou la couche DB (`makeDbZoneVersionProvider`).
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
   * Si absent ou si le provider retourne null : zone=null, potentialScore=0.
   */
  zoneVersionProvider?: ZoneVersionProvider;
}

// ─── Helpers internes ────────────────────────────────────────────────────────

/** ZoneVersion neutre : toutes valeurs null/vides (pas de zone résolue). */
const NULL_ZONE_VERSION: ZoneVersionInput = {
  densiteLogHa: null,
  usages: [],
  kind: "AUTRE",
};

/**
 * Sérialise un ZoneVersionInput en objet `zone` exposé dans les properties.
 * null si le ZoneVersionInput est la version nulle.
 */
function serializeZone(
  zv: ZoneVersionInput | null,
): { kind: ZoneKind; usages: string[]; densiteLogHa: number | null } | null {
  if (!zv) return null;
  // Si le provider a retourné null, on ne fabrique rien
  // Toujours exposé si le provider a fourni une vraie valeur
  return {
    kind: zv.kind,
    usages: zv.usages,
    densiteLogHa: zv.densiteLogHa,
  };
}

// ─── Route ───────────────────────────────────────────────────────────────────

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

    // ── CS-L6 : mode simulation pour les 4 villes Steve ────────────────────
    if (isSimulationCity(citySlug)) {
      const fc = getSimulationLotsFeatureCollection(citySlug, {
        limit,
        ...(bbox !== undefined ? { bbox } : {}),
      });
      return c.json({
        ok: true,
        citySlug,
        source: "simulation" as const,
        mode: "simulation" as const,
        featureCollection: fc,
      });
    }

    // ── Mode réel : Cadastre_allege MRNF ────────────────────────────────────
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

    // ── Enrichissement par lot ─────────────────────────────────────────────
    const featuresWithScore = result.featureCollection.features.map((f) => {
      const noLot = f.properties.noLot;

      // 1. Superficie depuis la géométrie (Shoelace, approximation locale <0.1 %)
      //    Source : cadastre allégé MRNF (polygone GeoJSON).
      //    Le rôle MAMH (RL0302A) n'est pas branché dans ce flux → anti-invention.
      const superficieM2 = superficieFromGeometry(
        f.geometry as { type: string; coordinates: unknown } | null,
      );

      // 2. usageCode : non disponible dans le cadastre allégé.
      //    Source = rôle XML MAMH (RL0101Ex), non branché ici.
      //    Anti-invention : null honnête.
      const usageCode: null = null;

      // 3. ZoneVersion via le provider injecté
      //    null si pas de provider ou si zone non résolue → score 0 honnête.
      const resolvedZone = deps.zoneVersionProvider
        ? deps.zoneVersionProvider(noLot, citySlug)
        : null;

      const zoneVersion: ZoneVersionInput = resolvedZone ?? NULL_ZONE_VERSION;

      // 4. Score de potentiel
      const lotInput: LotVersionInput = { superficieM2, usageCode };
      const { score } = lotPotentialScore(lotInput, zoneVersion);

      // 5. Champ `zone` : null si pas de zone résolue (anti-invention)
      const zone = serializeZone(resolvedZone);

      return {
        ...f,
        properties: {
          ...f.properties,
          superficieM2,
          usageCode,
          zone,
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
