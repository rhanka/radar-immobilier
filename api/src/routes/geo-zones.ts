/**
 * Route GET /api/geo/:city/zones.
 *
 * Official zone polygons win. `fallback=lots` groups already-served lot data by
 * zone code only when no official zones exist, with lower confidence and an
 * explicit visual-only warning.
 */

import { Hono } from "hono";
import type { Database } from "../db/client.js";
import { lotsForCity } from "../services/geo/lots.js";
import {
  getSimulationLotsFeatureCollection,
  getSimulationZones,
  isSimulationCity,
} from "../services/geo/simulation/simulation-provider.js";
import { officialZonesForCityFromDb } from "../services/geo/zone-provider-db.js";
import {
  normalizeZonesAndLots,
  type GeoJsonGeometry,
  type OfficialZoneInput,
  type ZoneLotInput,
  type NormalizeZonesResult,
} from "../services/geo/zones.js";

type MaybePromise<T> = T | Promise<T>;

interface ZoneRouteOpts {
  limit: number;
  bbox?: [number, number, number, number];
}

export type OfficialZoneProvider = (
  citySlug: string,
  opts: ZoneRouteOpts,
) => MaybePromise<OfficialZoneInput[]>;

export type ZoneLotProvider = (
  citySlug: string,
  opts: ZoneRouteOpts,
) => MaybePromise<ZoneLotInput[]>;

export interface GeoZonesDeps {
  db?: Database;
  fetchImpl?: typeof fetch;
  officialZoneProvider?: OfficialZoneProvider;
  lotProvider?: ZoneLotProvider;
}

function parseLimit(rawLimit: string | undefined): number | Response {
  if (!rawLimit) return 200;
  const limit = parseInt(rawLimit, 10);
  if (isNaN(limit) || limit <= 0) {
    return Response.json(
      { ok: false, error: "invalid-param", detail: "limit must be an integer > 0" },
      { status: 400 },
    );
  }
  return limit;
}

function parseBbox(rawBbox: string | undefined): [number, number, number, number] | Response | undefined {
  if (!rawBbox) return undefined;
  const parts = rawBbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => isNaN(n))) {
    return Response.json(
      {
        ok: false,
        error: "invalid-param",
        detail: "bbox must be 'minX,minY,maxX,maxY' (EPSG:4326)",
      },
      { status: 400 },
    );
  }
  return parts as [number, number, number, number];
}

function simulationOfficialZones(citySlug: string): OfficialZoneInput[] {
  if (!isSimulationCity(citySlug)) return [];
  return getSimulationZones(citySlug).map((zone) => ({
    code: zone.codeAffiche,
    citySlug,
    label: zone.nom || zone.kind,
    geometry: zone.geom as GeoJsonGeometry | null,
    source: "carte-steve",
  }));
}

async function officialZonesForCity(
  citySlug: string,
  opts: ZoneRouteOpts,
  deps: GeoZonesDeps,
): Promise<OfficialZoneInput[]> {
  if (deps.officialZoneProvider) {
    return deps.officialZoneProvider(citySlug, opts);
  }
  const simulationZones = simulationOfficialZones(citySlug);
  if (simulationZones.length > 0) return simulationZones;
  if (deps.db) return officialZonesForCityFromDb(deps.db, citySlug);
  return [];
}

async function lotsForZoneFallback(
  citySlug: string,
  opts: ZoneRouteOpts,
  deps: GeoZonesDeps,
): Promise<ZoneLotInput[]> {
  if (deps.lotProvider) {
    return deps.lotProvider(citySlug, opts);
  }

  if (isSimulationCity(citySlug)) {
    const fc = getSimulationLotsFeatureCollection(citySlug, {
      limit: opts.limit,
      ...(opts.bbox ? { bbox: opts.bbox } : {}),
    });
    return fc.features.map((feature) => ({
      noLot: feature.properties.noLot,
      citySlug,
      zoneCode: feature.properties.zone,
      geometry: feature.geometry as GeoJsonGeometry | null,
    }));
  }

  const result = await lotsForCity(citySlug, {
    limit: opts.limit,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(opts.bbox ? { bbox: opts.bbox } : {}),
  });
  if (!result.ok) return [];
  return result.featureCollection.features.map((feature) => ({
    noLot: feature.properties.noLot,
    citySlug,
    zoneCode: null,
    geometry: feature.geometry as GeoJsonGeometry | null,
  }));
}

function responseSource(result: NormalizeZonesResult): "official" | "lot-union-fallback" | "none" {
  if (result.resolutionStatus === "official") return "official";
  if (result.resolutionStatus === "fallback") return "lot-union-fallback";
  return "none";
}

export function geoZonesRoute(deps: GeoZonesDeps = {}): Hono {
  const app = new Hono();

  app.get("/api/geo/:city/zones", async (c) => {
    const citySlug = c.req.param("city");
    const fallback = c.req.query("fallback");
    if (fallback !== undefined && fallback !== "lots") {
      return c.json(
        { ok: false, error: "invalid-param", detail: "fallback must be 'lots' when provided" },
        400,
      );
    }

    const limit = parseLimit(c.req.query("limit"));
    if (limit instanceof Response) return limit;

    const bbox = parseBbox(c.req.query("bbox"));
    if (bbox instanceof Response) return bbox;

    const opts: ZoneRouteOpts = {
      limit,
      ...(bbox ? { bbox } : {}),
    };

    const officialZones = await officialZonesForCity(citySlug, opts, deps);
    const shouldLoadLots = fallback === "lots" || isSimulationCity(citySlug);
    const lots = shouldLoadLots
      ? await lotsForZoneFallback(citySlug, opts, deps)
      : [];

    const result = normalizeZonesAndLots({
      citySlug,
      officialZones,
      lots,
      opts: { includeLotFallback: fallback === "lots" },
    });

    return c.json({
      ok: true,
      citySlug: result.citySlug,
      source: responseSource(result),
      resolutionStatus: result.resolutionStatus,
      geometryStatus: result.geometryStatus,
      zoneCount: result.featureCollection.features.length,
      warnings: result.warnings,
      featureCollection: result.featureCollection,
    });
  });

  return app;
}
