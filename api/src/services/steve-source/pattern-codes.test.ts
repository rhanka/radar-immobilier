/**
 * Pattern-code reader tests: labels locate the header, codes come from rows.
 */

import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { readPatternCodes } from "./pattern-codes.js";
import { SteveCaptureError } from "./types.js";
import { buildSyntheticWorkbook, EXPECTED_CODES } from "./workbook.fixture.js";

describe("readPatternCodes", () => {
  it("reads different codes under a relocated accented header and preserves values", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/worksheets/sheet2.xml": `<worksheet><sheetData>
        <row r="4"><c r="C4" t="inlineStr"><is><t> Motif é </t></is></c></row>
        <row r="5"><c r="A5"><v>999</v></c><c r="C5" t="inlineStr"><is><t> NEW-É </t></is></c></row>
        <row r="7"><c r="C7" t="inlineStr"><is><t>OTHER</t></is></c></row>
      </sheetData></worksheet>`,
    }));
    expect(readPatternCodes(inventory, { sheet: "Codes", headerLabel: "MOTIF E\u0301" }))
      .toEqual([" NEW-É ", "OTHER"]);
  });

  it("reads codes below the label-detected header", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(readPatternCodes(inventory, { sheet: "Codes", headerLabel: "Motif" })).toEqual(
      EXPECTED_CODES,
    );
  });

  it("matches the header label case-insensitively", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(readPatternCodes(inventory, { sheet: "Codes", headerLabel: "motif" })).toEqual(
      EXPECTED_CODES,
    );
  });

  it("rejects an unknown sheet with an explicit error", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(() => readPatternCodes(inventory, { sheet: "Missing", headerLabel: "Motif" })).toThrow(
      SteveCaptureError,
    );
  });

  it("rejects an unknown header label with an explicit error", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(() => readPatternCodes(inventory, { sheet: "Codes", headerLabel: "Absent" })).toThrow(
      SteveCaptureError,
    );
  });
});
