import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { parseSheetXml } from "./sheet-parse.js";
import { SteveCaptureError } from "./types.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
import { workbookRelsXml, workbookXml } from "./workbook-parts.fixture.js";

const sheet = (body: string): string => `<worksheet>${body}</worksheet>`;
const captureSheet = (body: string) => captureWorkbookInventory(buildSyntheticWorkbook({
  "xl/worksheets/sheet1.xml": sheet(body),
}));

describe("faithful workbook edge cases", () => {
  it("advances omitted coordinates from preceding explicit coordinates, including blank cells", () => {
    const parsed = parseSheetXml("Sparse", sheet(`<sheetData>
      <row r="10"><c r="D10"/><c><v>11</v></c></row>
      <row><c><v>12</v></c></row></sheetData>`), [], 9);
    expect(parsed.cells.map((cell) => cell.address)).toEqual(["E10", "A11"]);
  });

  it("excludes empty values and keeps formulas without cached results", () => {
    const inventory = captureSheet(`<sheetData><row r="1"><c r="A1"><v/></c>
      <c r="B1" t="inlineStr"><is><t/></is></c><c r="C1"><f>1+2</f></c>
      <c r="D1" t="d"><v>2026-01-01</v></c></row></sheetData>`);
    expect(inventory.cells.filter((cell) => cell.sheet === "Lots")).toMatchObject([
      { address: "C1", formula: { text: "1+2" }, raw: null, cachedValue: null },
      { address: "D1", type: "d", raw: "2026-01-01" },
    ]);
  });

  it("reads rich shared and inline strings without phonetic guides or indentation", () => {
    const rich = `\n <r><rPr><b/></rPr><t>Île </t></r>\n <r><t>&amp; façade</t></r>
      <rPh sb="0" eb="1"><t>phonetic</t></rPh>\n`;
    const bytes = buildSyntheticWorkbook({
      "xl/sharedStrings.xml": `<sst><si>${rich}</si></sst>`,
      "xl/worksheets/sheet1.xml": sheet(`<sheetData><row><c t="s"><v>0</v></c>
        <c t="inlineStr"><is>${rich}</is></c></row></sheetData>`),
      "xl/worksheets/sheet2.xml": sheet("<sheetData/>"),
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.sharedStrings).toEqual(["Île & façade"]);
    expect(inventory.cells.slice(0, 2).map((cell) => cell.value)).toEqual([
      "Île & façade", "Île & façade",
    ]);
  });

  it.each(["/xl/worksheets/sheet1.xml", "./worksheets/sheet1.xml"])(
    "resolves workbook relationship target %s",
    (target) => {
      const bytes = buildSyntheticWorkbook({
        "xl/_rels/workbook.xml.rels": workbookRelsXml().replace("worksheets/sheet1.xml", target),
      });
      expect(captureWorkbookInventory(bytes).sheets).toHaveLength(3);
    },
  );

  it("preserves scoped-name attributes, dropdown options and active filter predicates", () => {
    const bytes = buildSyntheticWorkbook({
      "xl/workbook.xml": workbookXml().replace('name="LotsList"', 'name="LotsList" localSheetId="0" hidden="1"'),
      "xl/worksheets/sheet1.xml": sheet(`<sheetData/>
        <dataValidations><dataValidation type="list" sqref="A1" allowBlank="1">
        <formula1>LotsList</formula1></dataValidation></dataValidations>
        <autoFilter ref="A1:B2"><filterColumn colId="0"><filters>
        <filter val="Île"/></filters></filterColumn></autoFilter>`),
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.definedNames[0]?.attributes).toMatchObject({ localSheetId: "0", hidden: "1" });
    expect(inventory.dataValidations[0]).toMatchObject({
      formula1: "LotsList", formula2: null, attributes: { allowBlank: "1" },
    });
    expect(inventory.autoFilters[0]?.definition.children[0]?.children[0]?.children[0]?.attrs).toEqual({ val: "Île" });
  });

  it("rejects invalid shared-string indices instead of coercing them to zero", () => {
    expect(() => captureSheet('<sheetData><row><c t="s"><v> </v></c></row></sheetData>'))
      .toThrow(SteveCaptureError);
  });

  it.each(["crc", "size", "count", "comment"])("rejects corrupt ZIP %s", (field) => {
    const bytes = buildSyntheticWorkbook();
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    const central = view.getUint32(end + 16, true);
    if (field === "crc") view.setUint32(central + 16, 0, true);
    if (field === "size") view.setUint32(central + 24, 0, true);
    if (field === "count") view.setUint16(end + 10, 1, true);
    if (field === "comment") view.setUint16(end + 20, 1, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
  });

  it("rejects a ZIP containing malformed workbook XML", () => {
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/workbook.xml": "<workbook><sheets></workbook>",
    }))).toThrow(SteveCaptureError);
  });
});
