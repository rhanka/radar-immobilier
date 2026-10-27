import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import { buildTestGraphSet, buildTriageWorkbook, syntheticMunicipalities } from "./fixtures.js";
import { resolveTriageRow } from "./resolve.js";
import { readTriageRows } from "./triage-rows.js";

const graphs = buildTestGraphSet([{
  slug: "ville-synth-a", nodes: [
    { id: "s1", type: "Signal", props: { reglement_number: "SYN-1" } },
    { id: "s2", type: "Signal", props: { reglement_number: "SYN-2" } },
    { id: "s3", type: "DesignationEvent", props: { cible_reglement_numero: "SYN-2" } },
    { id: "s4", type: "DesignationEvent", props: { cible_reglement_numero: "SYN-4" } },
    { id: "s5", type: "Bylaw", props: { reglement_number: "SYN-5" } },
  ],
}, { slug: "bourg-homonyme-nord", nodes: [] }]);

describe("exclusive D3 status priorities", () => {
  it.each([
    ["Ville Synth B", "", "unavailable", 0],
    ["Ville Synth B", "synthetic text", "unavailable", 0],
    ["Bourg Homonyme", "", "ambiguous", 0],
    ["Bourg Homonyme", "SYN-1", "ambiguous", 0],
    ["Ville Synth A", "SYN-1;SYN-2;SYN-9", "ambiguous", 1],
    ["Ville Synth A", "SYN-1;SYN-9", "partially_resolved", 1],
    ["Ville Synth A", "SYN-1;synthetic text", "fully_resolved", 1],
    ["Ville Synth A", "SYN-4", "fully_resolved", 1],
    ["Ville Synth A", "SYN-5", "unresolved", 0],
    ["Ville Synth A", "synthetic text", "unresolved", 0],
    ["Unknown Synthetic", "SYN-1", "unresolved", 0],
  ] as const)("resolves %s / %s with status %s", (city, reglement, status, count) => {
    const row = readTriageRows(captureWorkbookInventory(buildTriageWorkbook([
      { city, reglement, classement: "Synthetic" },
    ])))[0];
    expect(row).toBeDefined();
    if (!row) throw new Error("synthetic row missing");
    const result = resolveTriageRow(row, graphs, syntheticMunicipalities());
    expect(result.status).toBe(status);
    expect(result.resolved).toHaveLength(count);
  });
});
