import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import { buildGraphSet } from "./graph-set.js";
import { buildTriageWorkbook, syntheticMunicipalities } from "./fixtures.js";
import { buildD3Report } from "./report.js";
import { tripletKey } from "./resolve.js";

describe("D3 contract edge cases", () => {
  it("canonicalizes nested props, nodes and graphs independently of order", () => {
    const first = buildGraphSet("synthetic", [{ slug: "a", nodes: [
      { id: "2", type: "Signal", props: { nested: { z: 2, a: 1 } } },
      { id: "1", type: "Signal", props: { sequence: [2, 1] } },
    ] }, { slug: "b", nodes: [] }]);
    const second = buildGraphSet("synthetic", [{ slug: "b", nodes: [] }, {
      slug: "a", nodes: [
        { id: "1", type: "Signal", props: { sequence: [2, 1] } },
        { id: "2", type: "Signal", props: { nested: { a: 1, z: 2 } } },
      ],
    }]);
    expect(second.sha256).toBe(first.sha256);
    second.graphs[0]?.nodes.push({ id: "3", type: "Signal", props: {} });
    expect(buildGraphSet("synthetic", second.graphs).sha256).not.toBe(first.sha256);
  });

  it("retains unique targets even when another target makes the row ambiguous", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([
      { city: "Ville Synth A", reglement: "SYN-1; SYN-2", classement: "Synthetic" },
    ]));
    const graphSet = buildGraphSet("synthetic", [{ slug: "ville-synth-a", nodes: [
      { id: "1", type: "Signal", props: { reglement_number: "SYN-1" } },
      { id: "2", type: "Signal", props: { reglement_number: "SYN-2" } },
      { id: "3", type: "DesignationEvent", props: { cible_reglement_numero: "SYN-2" } },
    ] }]);
    const report = buildD3Report(inventory, graphSet, syntheticMunicipalities());
    expect(report.statuses.ambiguous).toBe(1);
    expect(report.resolvedTriplets).toBe(1);
  });

  it("counts every unrecognized classement, including object property names", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([
      { classement: "__proto__" }, { classement: "constructor" },
    ]));
    const report = buildD3Report(inventory, buildGraphSet("synthetic", []));
    expect(Object.values(report.byClassement).reduce((sum, n) => sum + n, 0)).toBe(2);
    expect(Object.hasOwn(report.byClassement, "__proto__")).toBe(true);
  });

  it("keeps native triplet identity unambiguous when components contain pipes", () => {
    expect(tripletKey({ slug: "a|Signal|b", type: "Signal", id: "c" }))
      .not.toBe(tripletKey({ slug: "a", type: "Signal", id: "b|Signal|c" }));
  });
});
