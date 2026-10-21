/**
 * Real-graph adapter tests: lot 6E synthetic qualification, report-only.
 *
 * Fixtures reproduce real stored-graph shapes (camelCase, nested
 * `properties`, arrays, absent values) with synthetic values only.
 * No client data, no persistence, no network.
 */

import { describe, expect, it } from "vitest";
import {
  REAL_GRAPH_ADAPTER_VERSION,
  extractGraphNodeTokens,
} from "./graph-adapter.js";
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

