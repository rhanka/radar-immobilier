/**
 * Report aggregation tests: invariants and determinism, synthetic only.
 */

import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import {
  buildTestGraphSet,
  buildTriageWorkbook,
  syntheticMunicipalities,
} from "./fixtures.js";
import { buildD3Report } from "./report.js";

const municipalities = syntheticMunicipalities();

function twoCitySet() {
  return buildTestGraphSet([
    {
      slug: "ville-synth-a",
      nodes: [
        { id: "gn-1", type: "Signal", props: { reglement_number: "SYN-101" } },
      ],
    },
    { slug: "ville-synth-b", nodes: [] },
  ]);
}

describe("buildD3Report", () => {
  it("aggregates the five statuses and asserts their sum", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([
        { city: "Ville Synth A", reglement: "SYN-101", classement: "Pertinent" },
        { city: "Ville Synth A", reglement: "SYN-999", classement: "Non pertinent" },
        { city: "Ville Inexistante Synth", reglement: "SYN-101", classement: "Pertinent" },
        { city: "Bourg Homonyme", reglement: "SYN-101", classement: "À surveiller" },
      ]),
    );
    const report = buildD3Report(inventory, twoCitySet(), municipalities);
    expect(report.lines).toBe(4);
    expect(
      report.statuses.unavailable +
        report.statuses.ambiguous +
        report.statuses.fully_resolved +
        report.statuses.partially_resolved +
        report.statuses.unresolved,
    ).toBe(report.lines);
    expect(report.statuses.fully_resolved).toBe(1);
    expect(report.statuses.ambiguous).toBe(1);
  });

  it("counts targeted references, ignored tokens and distinct triplets", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([
        { city: "Ville Synth A", reglement: "SYN-101, sans objet", classement: "Pertinent" },
        { city: "Ville Synth A", reglement: "SYN-101", classement: "Pertinent" },
      ]),
    );
    const report = buildD3Report(inventory, twoCitySet(), municipalities);
    expect(report.targetedReferences).toBe(2);
    expect(report.ignoredTokens).toBe(1);
    expect(report.resolvedTriplets).toBe(1);
  });

  it("breaks rows down by classement without deriving signal counts", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([
        { city: "Ville Synth A", reglement: "SYN-101", classement: "Pertinent" },
        { city: "Ville Synth B", classement: "Non pertinent" },
      ]),
    );
    const report = buildD3Report(inventory, twoCitySet(), municipalities);
    expect(report.byClassement).toEqual({
      "Non pertinent": 1,
      Pertinent: 1,
    });
    expect(report).not.toHaveProperty("signals");
    expect(report).not.toHaveProperty("rows");
  });

  it("leaves frozen inputs unmutated and stays deterministic", () => {
    const bytes = buildTriageWorkbook([
      { city: "Ville Synth A", reglement: "SYN-101", classement: "Pertinent" },
    ]);
    const inventory = captureWorkbookInventory(bytes);
    const graphSet = twoCitySet();
    const frozenInventory = Object.freeze(structuredClone(inventory));
    const first = buildD3Report(inventory, graphSet, municipalities);
    const second = buildD3Report(frozenInventory, graphSet, municipalities);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
