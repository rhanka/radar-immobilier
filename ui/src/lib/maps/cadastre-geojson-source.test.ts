import { describe, it, expect } from "vitest";
import {
  mapCadastreCityToLayers,
  deriveLotPotentialScore,
  loadCadastreCity,
  type CadastreRawCity,
} from "./cadastre-geojson-source.js";
import delsonSnapshot from "./fixtures/cadastre/delson.snapshot.json";

const DELSON = delsonSnapshot as unknown as CadastreRawCity;

// ── deriveLotPotentialScore ───────────────────────────────────────────────────
describe("deriveLotPotentialScore", () => {
  it("returns 1.0 for priorité (4+ ∩ TOD)", () => {
    expect(deriveLotPotentialScore({ priorite: true, multifamilial_4plus: true, tod: true })).toBe(1);
  });
  it("returns 0.7 for 4+ only", () => {
    expect(deriveLotPotentialScore({ multifamilial_4plus: true })).toBe(0.7);
  });
  it("returns 0.45 for TOD only", () => {
    expect(deriveLotPotentialScore({ tod: true })).toBe(0.45);
  });
  it("returns 0.15 for neither", () => {
    expect(deriveLotPotentialScore({})).toBe(0.15);
  });
  it("returns 0 for street emprises (is_rue)", () => {
    expect(deriveLotPotentialScore({ is_rue: true, priorite: true })).toBe(0);
  });
});

// ── mapCadastreCityToLayers (fixture Delson) ──────────────────────────────────
describe("mapCadastreCityToLayers — Delson snapshot", () => {
  const layers = mapCadastreCityToLayers(DELSON);

  it("maps meta (slug/name/region/reglements)", () => {
    expect(layers.slug).toBe("delson");
    expect(layers.name).toBe("Delson");
    expect(layers.region).toContain("Rive-Sud");
    expect(layers.reglements).toBe("Règlement de zonage 901");
  });

  it("reorders bbox input [latMin,lonMin,latMax,lonMax] → bounds [lonMin,latMin,lonMax,latMax]", () => {
    // input bbox = [45.36, -73.55, 45.39, -73.51]
    expect(layers.bounds).toEqual([-73.55, 45.36, -73.51, 45.39]);
  });

  it("reorders centre input [lat,lon] → center [lon,lat]", () => {
    expect(layers.center).toEqual([-73.53, 45.375]);
  });

  it("excludes is_rue emprises and null-geometry lots by default", () => {
    // 6 features: 4 real lots + 1 is_rue + 1 null-geom → 4 kept
    expect(layers.lots.features.length).toBe(4);
    expect(layers.counts.lots).toBe(4);
    expect(layers.lots.features.some((f) => f.properties.noLot === "RUE-001")).toBe(false);
    expect(layers.lots.features.some((f) => f.properties.noLot === "NO-GEOM-001")).toBe(false);
  });

  it("computes counts (fourPlus / tod / priorite)", () => {
    expect(layers.counts.fourPlus).toBe(2);
    expect(layers.counts.tod).toBe(2);
    expect(layers.counts.priorite).toBe(1);
    expect(layers.counts.zones).toBe(2);
  });

  it("derives potentialScore per lot and flags it as placeholder", () => {
    const prio = layers.lots.features.find((f) => f.properties.noLot === "2181127");
    expect(prio?.properties.potentialScore).toBe(1);
    expect(prio?.properties.scorePlaceholder).toBe(true);
    const todOnly = layers.lots.features.find((f) => f.properties.noLot === "2181333");
    expect(todOnly?.properties.potentialScore).toBe(0.45);
  });

  it("never leaks PII: no `adresse` field on mapped lot props", () => {
    for (const f of layers.lots.features) {
      expect(Object.keys(f.properties)).not.toContain("adresse");
    }
  });

  it("renders >200 lots when source has more (cap lifted) — synthetic", () => {
    const many: CadastreRawCity = {
      meta: { slug: "x", nom: "X" },
      lots: {
        type: "FeatureCollection",
        features: Array.from({ length: 350 }, (_, i) => ({
          type: "Feature" as const,
          properties: { NO_LOT: `lot-${i}`, multifamilial_4plus: i % 2 === 0 },
          geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
        })),
      },
    };
    const out = mapCadastreCityToLayers(many);
    expect(out.lots.features.length).toBe(350);
  });

  it("defaults mode to simulation", () => {
    expect(layers.mode).toBe("simulation");
  });

  it("honours an injected canonical scoreFn (scorePlaceholder=false)", () => {
    const out = mapCadastreCityToLayers(DELSON, { scoreFn: () => 0.5 });
    expect(out.lots.features.every((f) => f.properties.potentialScore === 0.5)).toBe(true);
    expect(out.lots.features.every((f) => f.properties.scorePlaceholder === false)).toBe(true);
  });
});

// ── loadCadastreCity (offline via raw) ────────────────────────────────────────
describe("loadCadastreCity", () => {
  it("uses provided raw fixture without any network", async () => {
    const layers = await loadCadastreCity("delson", { raw: DELSON });
    expect(layers.slug).toBe("delson");
    expect(layers.lots.features.length).toBe(4);
  });

  it("fetches the reference URL when no raw is provided", async () => {
    let calledUrl = "";
    const fakeFetch = (async (url: string) => {
      calledUrl = url;
      return {
        ok: true,
        json: async () => DELSON,
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const layers = await loadCadastreCity("delson", { fetchImpl: fakeFetch });
    expect(calledUrl).toContain("/data/delson.json");
    expect(layers.name).toBe("Delson");
  });

  it("throws on non-ok HTTP", async () => {
    const fakeFetch = (async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch;
    await expect(loadCadastreCity("nope", { fetchImpl: fakeFetch })).rejects.toThrow(/404/);
  });
});
