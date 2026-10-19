import { describe, expect, it } from "vitest";
import { parseSheetXml } from "./sheet-parse.js";
const sheet = (body: string): string => `<worksheet>${body}</worksheet>`;
describe("worksheet coordinate integrity", () => {
  it("rejects duplicate cells at the same address", () => {
    expect(() => parseSheetXml("Dup", sheet(
      `<sheetData><row r="1"><c r="A1"><v>1</v></c><c r="A1"><v>2</v></c></row></sheetData>`,
    ), [])).toThrow(/duplicate cell/);
  });

  it("rejects cells whose reference sits outside their row", () => {
    expect(() => parseSheetXml("Skew", sheet(
      `<sheetData><row r="3"><c r="A7"><v>1</v></c></row></sheetData>`,
    ), [])).toThrow(/outside row 3/);
  });


});
