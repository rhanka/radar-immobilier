import { describe, expect, it } from "vitest";
import { makeKey } from "./selection-bucket.js";
import {
  buildSignauxMapEntities,
  getEntityChildren,
} from "./signaux-map-entities.js";
import type { CityMapEntry } from "./maps-data.js";
import type { GraphSignalNode } from "$lib/signals/graph-signal-detail-client.js";
import type {
  CadastreCityLayers,
  GeoJsonGeometry,
} from "./cadastre-geojson-source.js";

const CITY_SLUG = "salaberry-de-valleyfield";

function city(slug = CITY_SLUG, signalCount6m = 1): CityMapEntry {
  return {
    municipality: {
      slug,
      name: "Salaberry-de-Valleyfield",
      mrc: "Beauharnois-Salaberry",
      lat: 45.25,
      lon: -74.13,
      excluded: false,
      priorityRank: 1,
    } as CityMapEntry["municipality"],
    signalCount6m,
    subsetCounts: { "": signalCount6m },
  };
}

function signal(id: string, zoneRef?: string): GraphSignalNode {
  return {
    id,
    type: "DesignationEvent",
    label: `Signal ${id}`,
    citySlug: CITY_SLUG,
    sourceRef: "raw://pv.pdf",
    createdAt: "2026-06-01T00:00:00.000Z",
    props: zoneRef ? { zone_ref: zoneRef } : {},
  };
}

function polygon(): GeoJsonGeometry {
  return {
    type: "Polygon",
    coordinates: [
      [
        [-74.1, 45.25],
        [-74.09, 45.25],
        [-74.09, 45.26],
        [-74.1, 45.26],
        [-74.1, 45.25],
      ],
    ],
  };
}

function cadastreLayers(): CadastreCityLayers {
  const geometry = polygon();
  return {
    slug: CITY_SLUG,
    name: "Salaberry-de-Valleyfield",
    region: "Monteregie",
    bounds: [-74.2, 45.2, -74, 45.3],
    center: [-74.13, 45.25],
    zoom: 13,
    reglements: "Reglement de zonage",
    mode: "real",
    counts: {
      lots: 1,
      fourPlus: 1,
      tod: 0,
      priorite: 0,
      zones: 1,
    },
    zones: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry,
          properties: { zone: "H-609", nom: "Zone H-609" },
        },
      ],
    },
    lots: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry,
          properties: {
            noLot: "4 516 943",
            zone: "H-609",
            categorie: "residentiel",
            fourPlus: true,
            tod: false,
            priorite: false,
            zoneDesc: "Habitation",
            superficieM2: 1200,
            nbLogementsRole: 2,
            potentialScore: 0.7,
            scorePlaceholder: true,
          },
        },
      ],
    },
    tod: { type: "FeatureCollection", features: [] },
    boundary: { type: "FeatureCollection", features: [] },
  };
}

describe("buildSignauxMapEntities", () => {
  it("composes city children as signals and zones, then zone children as lots", () => {
    const result = buildSignauxMapEntities({
      municipalities: [city()],
      signalNodesByCity: new Map([[CITY_SLUG, [signal("sig-1", "H-609")]]]),
      cadastreLayersByCity: new Map([[CITY_SLUG, cadastreLayers()]]),
    });

    const cityKey = makeKey("municipality", CITY_SLUG);
    const signalKey = makeKey("signal", "sig-1");
    const zoneKey = makeKey("zone", `${CITY_SLUG}/H-609`);
    const lotKey = makeKey("lot", `${CITY_SLUG}/4 516 943`);

    expect(result.rootKeys).toEqual([cityKey]);
    expect(getEntityChildren(result, cityKey, "signal")).toEqual([signalKey]);
    expect(getEntityChildren(result, cityKey, "zone")).toEqual([zoneKey]);
    expect(getEntityChildren(result, zoneKey, "lot")).toEqual([lotKey]);
    expect(result.byKey.get(zoneKey)?.geometryState).toBe("present");
    expect(result.byKey.get(lotKey)?.geometryState).toBe("present");
  });

  it("keeps the hierarchy non-linear: signals do not own zones", () => {
    const result = buildSignauxMapEntities({
      municipalities: [city()],
      signalNodesByCity: { [CITY_SLUG]: [signal("sig-1", "H-609")] },
      cadastreLayersByCity: { [CITY_SLUG]: cadastreLayers() },
    });

    const signalKey = makeKey("signal", "sig-1");

    expect(getEntityChildren(result, signalKey, "zone")).toEqual([]);
    expect(result.byKey.get(signalKey)?.childKeys).toEqual([]);
  });

  it("does not mutate input Maps and returns fresh output Maps", () => {
    const signalNodesByCity = new Map([[CITY_SLUG, [signal("sig-1", "H-609")]]]);
    const cadastreLayersByCity = new Map([[CITY_SLUG, cadastreLayers()]]);

    const first = buildSignauxMapEntities({
      municipalities: [city()],
      signalNodesByCity,
      cadastreLayersByCity,
    });
    const second = buildSignauxMapEntities({
      municipalities: [city()],
      signalNodesByCity,
      cadastreLayersByCity,
    });

    expect(signalNodesByCity.size).toBe(1);
    expect(cadastreLayersByCity.size).toBe(1);
    expect(first.byKey).not.toBe(second.byKey);
    expect(first.childrenByKey).not.toBe(second.childrenByKey);
  });

  it("creates text-only zones from signal refs when zone geometry is absent", () => {
    const result = buildSignauxMapEntities({
      municipalities: [city()],
      signalNodesByCity: { [CITY_SLUG]: [signal("sig-1", "H-777")] },
    });

    const cityKey = makeKey("municipality", CITY_SLUG);
    const zoneKey = makeKey("zone", `${CITY_SLUG}/H-777`);

    expect(getEntityChildren(result, cityKey, "zone")).toEqual([zoneKey]);
    expect(result.byKey.get(zoneKey)).toMatchObject({
      kind: "zone",
      label: "H-777",
      geometryState: "text-only",
    });
    expect(result.availabilityByMunicipality.get(cityKey)).toEqual({
      zones: "text-only",
      lots: "missing",
    });
    expect(result.byKind.lot).toEqual([]);
  });

  it("marks zone and lot availability as missing instead of inventing entities", () => {
    const result = buildSignauxMapEntities({
      municipalities: [city(CITY_SLUG, 0)],
      signalNodesByCity: { [CITY_SLUG]: [signal("sig-1")] },
    });

    const cityKey = makeKey("municipality", CITY_SLUG);

    expect(getEntityChildren(result, cityKey, "zone")).toEqual([]);
    expect(getEntityChildren(result, cityKey, "lot")).toEqual([]);
    expect(result.byKind.zone).toEqual([]);
    expect(result.byKind.lot).toEqual([]);
    expect(result.availabilityByMunicipality.get(cityKey)).toEqual({
      zones: "missing",
      lots: "missing",
    });
  });
});
