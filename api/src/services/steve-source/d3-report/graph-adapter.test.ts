/**
 * Real-graph adapter tests: lot 6E synthetic qualification, report-only.
 *
 * Fixtures reproduce real stored-graph shapes (camelCase, nested
 * `properties`, arrays, absent values) with synthetic values only.
 * No client data, no persistence, no network.
 */

import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import {
  buildTestGraphSet,
  buildTriageWorkbook,
  syntheticMunicipalities,
} from "./fixtures.js";
import {
  REAL_GRAPH_ADAPTER_VERSION,
  extractGraphNodeTokens,
} from "./graph-adapter.js";
import { buildD3Report } from "./report.js";
import { resolveTriageRow } from "./resolve.js";
import type { TriageRow } from "./triage-rows.js";

const municipalities = syntheticMunicipalities();

function makeRow(reglement: string | null, city = "Ville Synth A"): TriageRow {
  const cell = (text: string | null) =>
    text === null ? { raw: null, value: null } : { raw: text, value: text };
  return {
    locator: { sheet: "Triage", sheetId: 1, row: 2 },
    order: 0,
    number: cell("1"),
    city: cell(city),
    mrc: cell(null),
    reglement: cell(reglement),
    classement: { raw: "Synthetic", value: "Synthetic" },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe("extractGraphNodeTokens", () => {
  for (const key of ["reglement_number", "cible_reglement_numero", "cibleReglementNumero"]) {
    it.each(["props", "properties"])("reads scalar, numeric and array %s." + key, (location) => {
      for (const value of [" SYN-801 ", ["syn-801", "SYN-802"], 801]) {
        const props = location === "props" ? { [key]: value } : { properties: { [key]: value } };
        expect(extractGraphNodeTokens(props)).toEqual({
          tokens: typeof value === "number" ? ["801"] : Array.isArray(value) ? ["syn-801", "syn-802"] : ["syn-801"],
          unsupported: [],
        });
      }
    });
  }

  it.each([null, undefined, {}, { reglement_number: [null, undefined, " ", []] }])(
    "keeps absent and empty values silent: %j", (props) => {
      expect(extractGraphNodeTokens(props)).toEqual({ tokens: [], unsupported: [] });
    },
  );

  it("preserves valid tokens while diagnosing every unsupported array value", () => {
    expect(extractGraphNodeTokens({
      cibleReglementNumero: ["SYN-803", false, {}, Infinity, -Infinity, Number.NaN],
    })).toEqual({
      tokens: ["syn-803"],
      unsupported: [
        "cibleReglementNumero[1]:boolean", "cibleReglementNumero[2]:object",
        "cibleReglementNumero[3]:non-finite-number",
        "cibleReglementNumero[4]:non-finite-number",
        "cibleReglementNumero[5]:non-finite-number",
      ],
    });
  });

  it.each([true, 801, "SYN-801", [], new Date(0)])("diagnoses malformed props: %j", (props) => {
    expect(extractGraphNodeTokens(props).tokens).toEqual([]);
    expect(extractGraphNodeTokens(props).unsupported).toHaveLength(1);
  });

  it("diagnoses malformed nested properties without losing top-level tokens", () => {
    expect(extractGraphNodeTokens({ reglement_number: "SYN-804", properties: [] })).toEqual({
      tokens: ["syn-804"], unsupported: ["properties:array"],
    });
  });

  it("reads camelCase, nested and array values with lot 5 normalization", () => {
    const result = extractGraphNodeTokens({
      cibleReglementNumero: "SYN-101",
      properties: { reglement_number: ["syn-102", " SYN-103 "] },
    });
    expect(result.tokens).toEqual(["syn-101", "syn-102", "syn-103"]);
    expect(result.unsupported).toEqual([]);
  });

  it("dedupes repeated aliases on one node into a single token", () => {
    const result = extractGraphNodeTokens({
      reglement_number: "SYN-201",
      cible_reglement_numero: "syn-201",
      properties: { cibleReglementNumero: ["SYN-201"] },
    });
    expect(result.tokens).toEqual(["syn-201"]);
  });

  it("keeps absent values silent and reports unsupported values", () => {
    const result = extractGraphNodeTokens({
      reglement_number: [true, Number.NaN],
      cibleReglementNumero: "   ",
      properties: "oops",
    });
    expect(result.tokens).toEqual([]);
    expect(result.unsupported).toContain("properties:string");
    expect(result.unsupported.some((entry) => entry.includes("reglement_number[0]"))).toBe(true);
    expect(result.unsupported.some((entry) => entry.includes("non-finite-number"))).toBe(true);
  });

  it("leaves frozen props unmutated and stays deterministic", () => {
    const props = Object.freeze({
      reglement_number: Object.freeze(["SYN-301"]),
      properties: Object.freeze({ cibleReglementNumero: "SYN-302" }),
    });
    const before = JSON.stringify(props);
    const first = extractGraphNodeTokens(props);
    expect(extractGraphNodeTokens(structuredClone(props))).toEqual(first);
    expect(JSON.stringify(props)).toBe(before);
  });
});

describe("resolver on real graph shapes", () => {
  it.each([
    ["camelCase nested", { properties: { cibleReglementNumero: "SYN-401" } }, "SYN-401", "fully_resolved", 1],
    ["array multi-value", { reglement_number: ["SYN-402", "SYN-403"] }, "SYN-402, SYN-403", "fully_resolved", 1],
    ["repeated aliases", { reglement_number: "SYN-404", properties: { cibleReglementNumero: "syn-404" } }, "SYN-404", "fully_resolved", 1],
    ["malformed value", { reglement_number: true }, "SYN-405", "unresolved", 0],
    ["absent values", {}, "SYN-406", "unresolved", 0],
  ] as const)("resolves %s without inventing candidates", (_label, props, reglement, status, count) => {
    const graphSet = buildTestGraphSet([
      { slug: "ville-synth-a", nodes: [{ id: "gn-1", type: "Signal", props }] },
    ]);
    const resolution = resolveTriageRow(makeRow(reglement), graphSet, municipalities);
    expect(resolution.status).toBe(status);
    expect(resolution.resolved).toHaveLength(count);
    if (count === 1) expect(resolution.resolved).toEqual([
      { slug: "ville-synth-a", type: "Signal", id: "gn-1" },
    ]);
  });

  it("keeps distinct native nodes distinct: shared camelCase and nested tokens conflict", () => {
    const graphSet = buildTestGraphSet([{
      slug: "ville-synth-a",
      nodes: [
        { id: "gn-1", type: "Signal", props: { cibleReglementNumero: "SYN-501" } },
        { id: "gn-2", type: "DesignationEvent", props: { properties: { reglement_number: "SYN-501" } } },
      ],
    }]);
    const resolution = resolveTriageRow(makeRow("SYN-501"), graphSet, municipalities);
    expect(resolution.status).toBe("ambiguous");
  });

  it("keeps municipality and MRC disambiguation unchanged on adapted graphs", () => {
    const graphSet = buildTestGraphSet([{
      slug: "bourg-homonyme-nord",
      nodes: [{ id: "gn-1", type: "Signal", props: { cibleReglementNumero: "SYN-601" } }],
    }]);
    const ambiguous = resolveTriageRow(makeRow("SYN-601", "Bourg Homonyme"), graphSet, municipalities);
    expect(ambiguous.status).toBe("ambiguous");
    expect(ambiguous.resolved).toHaveLength(0);
    const row = makeRow("SYN-601", "Bourg Homonyme");
    row.mrc = { raw: " MRC Nord ", value: " MRC Nord " };
    expect(resolveTriageRow(row, graphSet, municipalities)).toMatchObject({
      status: "fully_resolved",
      resolved: [{ slug: "bourg-homonyme-nord", type: "Signal", id: "gn-1" }],
    });
  });

  it("ignores matching tokens on unsupported node types and other municipalities", () => {
    const graphSet = buildTestGraphSet([
      { slug: "ville-synth-a", nodes: [{ id: "gn-1", type: "Document", props: { cibleReglementNumero: "SYN-901" } }] },
      { slug: "ville-synth-b", nodes: [{ id: "gn-2", type: "Signal", props: { cibleReglementNumero: "SYN-901" } }] },
    ]);
    expect(resolveTriageRow(makeRow("SYN-901"), graphSet, municipalities)).toMatchObject({
      status: "unresolved", resolved: [],
    });
  });
});

describe("report on adapted graphs", () => {
  it("keeps five-bucket accounting and records adapter and snapshot versions", () => {
    const inventory = deepFreeze(captureWorkbookInventory(buildTriageWorkbook([
      { city: "Ville Synth A", reglement: "SYN-701", classement: "Synthetic" },
      { city: "Ville Synth A", reglement: "SYN-701, SYN-999", classement: "Synthetic" },
      { city: "Ville Synth A", reglement: "SYN-999", classement: "Synthetic" },
      { city: "Bourg Homonyme", reglement: "SYN-701", classement: "Synthetic" },
      { city: "Ville Synth B", reglement: "SYN-701", classement: "Synthetic" },
    ])));
    const graphSet = deepFreeze(buildTestGraphSet([{
      slug: "ville-synth-a",
      nodes: [{ id: "gn-1", type: "Signal", props: { properties: { cibleReglementNumero: "SYN-701" } } }],
    }]));
    const before = JSON.stringify({ inventory, graphSet });
    const report = buildD3Report(inventory, graphSet, municipalities);
    expect(report.ruleVersion).toBe("d3-report-v1");
    expect(report.adapterVersion).toBe(REAL_GRAPH_ADAPTER_VERSION);
    expect(report.snapshotId).toBe(graphSet.snapshotId);
    expect(report.graphSha256).toBe(graphSet.sha256);
    expect(
      report.statuses.unavailable +
        report.statuses.ambiguous +
        report.statuses.fully_resolved +
        report.statuses.partially_resolved +
        report.statuses.unresolved,
    ).toBe(report.lines);
    expect(report.statuses).toEqual({
      unavailable: 1, ambiguous: 1, fully_resolved: 1, partially_resolved: 1, unresolved: 1,
    });
    expect(report.lines).toBe(5);
    expect(report.targetedReferences).toBe(6);
    expect(report.resolvedTriplets).toBe(1);
    expect(buildD3Report(inventory, graphSet, municipalities)).toEqual(report);
    expect(report).not.toHaveProperty("signals");
    expect(JSON.stringify({ inventory, graphSet })).toBe(before);
  });
});
