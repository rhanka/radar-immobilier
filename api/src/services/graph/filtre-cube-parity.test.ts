/**
 * Filtre cube of the by-city aggregate: the cube served per city must give,
 * for every Filtre state, the same displayed count as the B counters the rail
 * already reads (`vivierV2Counts`, gated by the `excludePiia` /
 * `excludeDerogations` flags), and must not depend on those flags.
 *
 * Pure: real graph rows (Sutton, Coaticook, legacy golden corpus) plus the
 * PIIA / dérogation rows of the display-exclusion case. No DB.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { displayedVivierFiltreCount, type VivierFiltreAxes, type VivierV2Counts } from "@radar/domain";
import { aggregateGraphSignalProjectionRows, type GraphSignalProjectionRow } from "./graph-store.js";
import { BPRIME_RECETTE_ROWS } from "./bprime-recette.fixture.js";
import { computeVivierV2, type VivierSignalInput } from "./vivier-v2.js";

const goldenRows = JSON.parse(readFileSync(fileURLToPath(new URL(
  "../../../tests/fixtures/graphify/legacy-filter-a/rows.json", import.meta.url)), "utf8")) as GraphSignalProjectionRow[];

const refs = [{ publishedAt: "2026-09-29" }];
const base = {
  citySlug: "exclusions", type: "Signal", sourceRef: null, description: null,
  etapeAnnote: null, nbUnitesMax: null, intensite: null,
};
const exclusionRows: GraphSignalProjectionRow[] = [
  { ...base, id: "piia-no-project", category: "piia", label: "PIIA — secteur résidentiel",
    props: { refs, properties: { category: "piia", etape: "adoption" } } },
  { ...base, id: "piia-project", category: "piia", label: "PIIA — secteur résidentiel",
    props: { refs: [{ ...refs[0], excerpt: "Projet de quatre logements" }], properties: { category: "piia", etape: "adoption" } } },
  { ...base, id: "derogation", category: "derogation", label: "Dérogation mineure — quatre logements",
    props: { refs, properties: { category: "derogation" } } },
];

const rows: GraphSignalProjectionRow[] = [...BPRIME_RECETTE_ROWS, ...goldenRows, ...exclusionRows];

/** The rail's B count from `vivierV2Counts` (ui countForVivierCity, B mode). */
function railCount(v: VivierV2Counts, axes: VivierFiltreAxes): number {
  const sum = (s: VivierV2Counts["stageCounts"]) => axes.p
    ? s.avis_motion + s.projet_reglement
    : Object.values(s).reduce((total, n) => total + n, 0);
  const inZ = axes.r ? v.stageCountsResEligible : v.stageCounts;
  const outZ = axes.r ? v.stageCountsResEligibleHorsZonage : v.stageCountsHorsZonage;
  return axes.z ? sum(inZ) : sum(inZ) + sum(outZ);
}

const AXES: VivierFiltreAxes[] = [false, true].flatMap((z) => [false, true].flatMap((r) =>
  [false, true].map((p) => ({ z, r, p }))));
const EXCLUSIONS = [false, true].flatMap((piia) => [false, true].map((derog) => ({ piia, derog })));

describe("by-city Filtre cube", () => {
  it("should not depend on the excludePiia / excludeDerogations flags", () => {
    const reference = aggregateGraphSignalProjectionRows(rows).map((c) => [c.citySlug, c.filtreCube]);
    for (const { piia, derog } of EXCLUSIONS) {
      const cubes = aggregateGraphSignalProjectionRows(rows, { excludePiia: piia, excludeDerogations: derog })
        .map((c) => [c.citySlug, c.filtreCube]);
      expect(cubes).toEqual(reference);
    }
  });

  it("should give the rail B count for every Filtre state and city", () => {
    let checked = 0;
    for (const { piia, derog } of EXCLUSIONS) {
      const cities = aggregateGraphSignalProjectionRows(rows, { excludePiia: piia, excludeDerogations: derog });
      for (const city of cities) {
        for (const axes of AXES) {
          const exclusions = { piiaSansProjetResidentiel: piia, derogationsMineures: derog };
          expect(displayedVivierFiltreCount(city.filtreCube, axes, exclusions), `${city.citySlug} ${JSON.stringify({ axes, piia, derog })}`)
            .toBe(railCount(city.vivierV2Counts, axes));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(32);
  });

  it("should see the exclusion rows in the cube cells their exclusion hides", () => {
    const city = aggregateGraphSignalProjectionRows(exclusionRows)[0]!;
    const cells = Object.entries(city.filtreCube);
    expect(cells.filter(([key]) => key[3] === "1").reduce((n, [, c]) => n + c, 0)).toBe(1);
    expect(cells.filter(([key]) => key[4] === "1").reduce((n, [, c]) => n + c, 0)).toBe(1);
  });

  it("should keep the vivier counters equal to computeVivierV2 over the kept rows", () => {
    for (const city of aggregateGraphSignalProjectionRows(rows)) {
      const signals: VivierSignalInput[] = rows.filter((r) => r.citySlug === city.citySlug).map((r) => ({
        id: r.id, type: r.type, category: r.category ?? null, label: r.label,
        description: r.description ?? null, etape: r.etapeAnnote ?? null,
        nbUnitesMax: r.nbUnitesMax ?? null, intensite: r.intensite ?? null,
        props: r.props, sourceRef: r.sourceRef,
      }));
      expect(city.vivierV2Counts).toEqual(computeVivierV2(signals).counts);
    }
  });
});
