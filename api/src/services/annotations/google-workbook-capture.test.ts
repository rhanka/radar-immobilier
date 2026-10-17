import { describe, expect, it } from "vitest";
import { sha256Hex } from "@sentropic/comments";
import { captureSyntheticGoogleWorkbook } from "./google-workbook-capture.js";
import { inventorySyntheticWorkbook } from "./workbook-inventory.js";
import { SYNTHETIC_BODY, SYNTHETIC_SCOPE } from "./fixtures.js";

const raw = JSON.stringify({ spreadsheetId: "synthetic-google-id", properties: { locale: "fr_CA" },
  sheets: [{ properties: { sheetId: 12, title: "Synthetic sheet", hidden: true },
    data: [{ startRow: 1, startColumn: 1, rowMetadata: [{ hiddenByUser: true }], rowData: [{ values: [
      { userEnteredValue: { formulaValue: "=A2/10" }, effectiveValue: { numberValue: 0.1 }, note: "Exact note\r\n" },
      { userEnteredValue: { stringValue: "Synthetic feedback\r\n😀  " }, effectiveValue: { stringValue: "Synthetic feedback\r\n😀  " } },
    ] }] }] }], unknownExtension: { preserved: true } });
const options = { dataClass: "synthetic" as const, citySlug: "synthetic-city", codec: SYNTHETIC_BODY.codec,
  feedbackCells: [{ sheetId: "12", a1: "C2", attribution: { variant: "unknown" as const, classification: "source-unknown" } }] };

describe("Google workbook response capture", () => {
  it("should preserve all raw API fields and decode offsets, formulas, cached values and hidden cells", () => {
    const capture = captureSyntheticGoogleWorkbook(raw, options);
    expect(capture.upstreamRawUtf8).toBe(raw);
    expect(capture.sheets[0]!.cells[0]).toMatchObject({ a1: "B2", row: 2, hidden: true, formula: "=A2/10",
      cachedValue: { type: "number", lexical: "0.1" }, note: "Exact note\r\n" });
    expect(capture.sheets[0]!.contributions[0]!.body.text).toBe("Synthetic feedback\r\n😀  ");
    const inventory = inventorySyntheticWorkbook(JSON.stringify(capture), SYNTHETIC_SCOPE, ["12"]);
    expect(inventory.digest).toBe(sha256Hex(raw));
    expect(inventory.issues).toContain("coverage-unqualified:comments");
  });
  it("should refuse a missing feedback cell instead of declaring a partial mapping complete", () => {
    expect(() => captureSyntheticGoogleWorkbook(raw, { ...options,
      feedbackCells: [{ ...options.feedbackCells[0]!, a1: "Z50" }] })).toThrow(/missing/);
  });
});
