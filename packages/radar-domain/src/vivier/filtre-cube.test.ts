import { describe, expect, it } from "vitest";
import {
  addToVivierFiltreCube,
  displayedVivierFiltreCount,
  facetedVivierFiltreCounts,
  mergeVivierFiltreCubes,
  vivierFiltreCubeKey,
  vivierFiltreCubeSchema,
  type VivierFiltreCube,
  type VivierFiltreRecord,
} from "./filtre-cube.js";
import { vivierV2Schema, type VivierV2 } from "./vivier-v2.js";

const ALL_AXES = { z: true, r: true, p: true };
const BOTH = { piiaSansProjetResidentiel: true, derogationsMineures: true };
const NONE = { piiaSansProjetResidentiel: false, derogationsMineures: false };

function record(overrides: Partial<VivierV2> = {}, label = "Règlement de zonage"): VivierFiltreRecord {
  return {
    label,
    description: null,
    props: {},
    classification: vivierV2Schema.parse({
      zonage: { valeur: "oui", source: "test", confiance: 1 },
      residentiel: { valeur: "oui", source: "test", confiance: 1 },
      instrument: "ppcmoi",
      etape: "avis_motion",
      confiance: 1,
      ...overrides,
    }),
  };
}

function cubeOf(records: VivierFiltreRecord[]): VivierFiltreCube {
  const cube: VivierFiltreCube = {};
  for (const r of records) addToVivierFiltreCube(cube, r);
  return cube;
}

describe("vivier filtre cube", () => {
  it("should key a record by its zonage, residential, early-stage, PIIA and derogation flags", () => {
    expect(vivierFiltreCubeKey(record())).toBe("11100");
    expect(vivierFiltreCubeKey(record({ etape: "adoption" }))).toBe("11000");
    expect(vivierFiltreCubeKey(record({ instrument: "derogation", etape: "adoption" }))).toBe("11001");
    expect(vivierFiltreCubeKey(record({ instrument: "piia", etape: "adoption" }, "PIIA façade"))).toBe("11010");
  });

  it("should leave a record outside B out of the cube", () => {
    const outside = record({ exclusion_reason: "hors_zonage", zonage: { valeur: "non", source: "test", confiance: 1 } });
    expect(vivierFiltreCubeKey(outside)).toBeNull();
    expect(cubeOf([outside])).toEqual({});
  });

  it("should give each axis the displayed total when every axis is checked", () => {
    const cube = cubeOf([
      record(),
      record(),
      record({ etape: "adoption" }),
      record({ instrument: "derogation" }),
      record({ instrument: "piia" }, "PIIA façade"),
    ]);
    const counts = facetedVivierFiltreCounts(cube, ALL_AXES, BOTH);
    expect(displayedVivierFiltreCount(cube, ALL_AXES, BOTH)).toBe(2);
    expect(counts.z).toBe(2);
    expect(counts.r).toBe(2);
    expect(counts.p).toBe(2);
    // Each exclusion counts what it hides among the signals every other criterion keeps.
    expect(counts.piia).toBe(1);
    expect(counts.derog).toBe(1);
  });

  it("should count an unchecked axis as what the view would show once it is checked", () => {
    const cube = cubeOf([record(), record({ etape: "adoption" }), record({ etape: "adoption" })]);
    const axes = { z: true, r: true, p: false };
    expect(displayedVivierFiltreCount(cube, axes, BOTH)).toBe(3);
    expect(facetedVivierFiltreCounts(cube, axes, BOTH)).toMatchObject({ z: 3, r: 3, p: 1 });
  });

  it("should depend on the other active filters, not on the criterion itself", () => {
    const cube = cubeOf([
      record({ instrument: "derogation" }),
      record({ instrument: "derogation", etape: "adoption" }),
    ]);
    // Précoce checked: only the early derogation is in scope of the derogation count.
    expect(facetedVivierFiltreCounts(cube, ALL_AXES, BOTH).derog).toBe(1);
    expect(facetedVivierFiltreCounts(cube, { z: true, r: true, p: false }, BOTH).derog).toBe(2);
    // Unchecking the exclusion does not change its own count.
    expect(facetedVivierFiltreCounts(cube, ALL_AXES, NONE).derog).toBe(1);
  });

  it("should sum city cubes cell by cell", () => {
    const merged = mergeVivierFiltreCubes([{ "11100": 2 }, { "11100": 1, "01000": 4 }]);
    expect(merged).toEqual({ "11100": 3, "01000": 4 });
    expect(vivierFiltreCubeSchema.parse(merged)).toEqual(merged);
    expect(() => vivierFiltreCubeSchema.parse({ "1110": 1 })).toThrow();
  });
});
