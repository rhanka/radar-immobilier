import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sha256Hex } from "@sentropic/comments";
import { inventorySyntheticWorkbook, type SyntheticWorkbookCapture } from "./workbook-inventory.js";
import { SYNTHETIC_SCOPE } from "./fixtures.js";
const syntheticWorkbook = JSON.parse(readFileSync(new URL("../../../tests/fixtures/annotations-workbook.json", import.meta.url), "utf8")) as SyntheticWorkbookCapture;

describe("synthetic workbook inventory", () => {
  it("should preserve raw bytes, typed formula/cache/hidden metadata and explicit absences", () => {
    const raw = JSON.stringify(syntheticWorkbook, null, 2);
    const inventory = inventorySyntheticWorkbook(raw, SYNTHETIC_SCOPE, ["native-tab", "missing-tab"]);
    expect(inventory.rawUtf8).toBe(raw);
    expect(inventory.digest).toBe(sha256Hex(raw));
    expect(inventory.capture).toEqual(syntheticWorkbook);
    expect(inventory.sourceContributionCount).toBe(2);
    expect(inventory.resources.map((r) => r.ref.kind)).toEqual(["workbook", "worksheet", "cell", "row"]);
    expect(inventory.issues).toEqual(["sheet-absent:missing-tab", "attachment-absent:missing-synthetic-analysis"]);
  });
  it("should refuse real captures and unresolved locators and report incomplete capture coverage", () => {
    expect(() => inventorySyntheticWorkbook(JSON.stringify({ ...syntheticWorkbook, dataClass: "real" }), SYNTHETIC_SCOPE, [])).toThrow(/synthetic/);
    const incomplete = inventorySyntheticWorkbook(JSON.stringify({ ...syntheticWorkbook, coverage: {} }), SYNTHETIC_SCOPE, []);
    expect(incomplete.issues.filter((issue) => issue.startsWith("coverage")).length).toBe(8);
    expect(() => inventorySyntheticWorkbook(JSON.stringify({ ...syntheticWorkbook,
      sheets: [...syntheticWorkbook.sheets, ...syntheticWorkbook.sheets] }), SYNTHETIC_SCOPE, [])).toThrow(/Duplicate/);
  });
});
