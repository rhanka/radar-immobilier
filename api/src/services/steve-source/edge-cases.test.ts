import { describe, expect, it } from "vitest";
import { parseRowNumber } from "./cell-parse.js";
import { crc32 } from "./crc32.js";
import { captureWorkbookInventory } from "./inventory.js";
import { parseSheetXml } from "./sheet-parse.js";
import { SteveCaptureError } from "./types.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
import { workbookRelsXml, workbookXml } from "./workbook-parts.fixture.js";

const sheet = (body: string): string => `<worksheet>${body}</worksheet>`;
const captureSheet = (body: string) => captureWorkbookInventory(buildSyntheticWorkbook({
  "xl/worksheets/sheet1.xml": sheet(body),
}));

/** Corrupt the stored shared-strings bytes and repair both CRC fields. */
function invalidUtf8Workbook(): Uint8Array {
  const bytes = buildSyntheticWorkbook({}, {}, ["xl/sharedStrings.xml"]);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let dataStart = 0;
  let dataLen = 0;
  let localOffset = 0;
  for (let guard = 0; guard < 64; guard++) {
    const nameLen = dv.getUint16(offset + 26, true);
    const extraLen = dv.getUint16(offset + 28, true);
    const compSize = dv.getUint32(offset + 18, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    if (name === "xl/sharedStrings.xml") {
      dataStart = start;
      dataLen = compSize;
      localOffset = offset;
      break;
    }
    offset = start + compSize;
  }
  if (dataStart === 0) throw new Error("missing stored shared strings");
  bytes[dataStart] = 0xff;
  const fixed = crc32(bytes.subarray(dataStart, dataStart + dataLen));
  dv.setUint32(localOffset + 14, fixed, true);
  const eocd = bytes.length - 22;
  const count = dv.getUint16(eocd + 10, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  let cursor = centralOffset;
  for (let n = 0; n < count; n++) {
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    if (name === "xl/sharedStrings.xml") {
      dv.setUint32(cursor + 16, fixed, true);
      break;
    }
    cursor = cursor + 46 + nameLen + extraLen + commentLen;
  }
  return bytes;
}

describe("faithful workbook edge cases", () => {
  it("advances omitted coordinates from preceding explicit coordinates, including blank cells", () => {
    const parsed = parseSheetXml("Sparse", sheet(`<sheetData>
      <row r="10"><c r="D10"/><c><v>11</v></c></row>
      <row><c><v>12</v></c></row></sheetData>`), [], 9);
    expect(parsed.cells.map((cell) => cell.address)).toEqual(["E10", "A11"]);
    expect(parsed.cells.every((cell) => cell.sheetId === 9)).toBe(true);
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
    expect(() => captureSheet('<sheetData><row><c t="s"><v> </v></c></row></sheetData>'))
      .toThrow(/out of range/);
  });

  it.each(["0x10", "", " 12", "1.5"])("rejects non-canonical row number %s", (raw) => {
    expect(() => parseRowNumber(raw, "Rows")).toThrow(SteveCaptureError);
    expect(() => parseRowNumber(raw, "Rows")).toThrow(/row number/);
  });

  it.each(["0x10", "", "9007199254740992"])("rejects non-canonical shared formula index %s", (raw) => {
    expect(() => captureSheet(
      `<sheetData><row r="1"><c r="A1"><f t="shared" si="${raw}"/><v>1</v></c></row></sheetData>`,
    )).toThrow(/shared formula index/);
  });

  it("rejects parts that are not valid UTF-8", () => {
    expect(() => captureWorkbookInventory(invalidUtf8Workbook())).toThrow(/invalid UTF-8/);
  });

  const corruptZip: Array<[string, RegExp]> = [
    ["crc", /size or CRC mismatch/],
    ["size", /size or CRC mismatch/],
    ["count", /inconsistent entry count/],
    ["comment", /end-of-central-directory/],
  ];
  it.each(corruptZip)("rejects corrupt ZIP %s with an explicit message", (field, message) => {
    const bytes = buildSyntheticWorkbook();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const end = bytes.length - 22;
    const central = view.getUint32(end + 16, true);
    const localOffset = view.getUint32(central + 42, true);
    if (field === "crc") {
      view.setUint32(central + 16, 0, true);
      view.setUint32(localOffset + 14, 0, true);
    }
    if (field === "size") {
      view.setUint32(central + 24, 0, true);
      view.setUint32(localOffset + 22, 0, true);
    }
    if (field === "count") {
      view.setUint16(end + 8, 1, true);
      view.setUint16(end + 10, 1, true);
    }
    if (field === "comment") view.setUint16(end + 20, 1, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(bytes)).toThrow(message);
  });

  it("rejects a ZIP containing malformed workbook XML", () => {
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/workbook.xml": "<workbook><sheets></workbook>",
    }))).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/workbook.xml": "<workbook><sheets></workbook>",
    }))).toThrow(/mismatched closing tag/);
  });
});

describe("OOXML control escape decoding", () => {
  it("decodes shared strings once", () => {
    const bytes = buildSyntheticWorkbook({
      "xl/sharedStrings.xml": "<sst><si><t>_x000D_</t></si><si><t>_x005F_x0041_</t></si></sst>",
      "xl/worksheets/sheet1.xml": sheet(
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData>',
      ),
      "xl/worksheets/sheet2.xml": sheet("<sheetData/>"),
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.sharedStrings.slice(0, 2)).toEqual(["\r", "_x0041_"]);
    const values = inventory.cells.filter((cell) => cell.sheet === "Lots").map((cell) => cell.value);
    expect(values).toEqual(["\r", "_x0041_"]);
  });

  it("decodes inline strings once and preserves the raw text", () => {
    const inventory = captureSheet(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>_x000D_</t></is></c>' +
      '<c r="B1" t="inlineStr"><is><t>_x005F_x0041_</t></is></c></row></sheetData>',
    );
    const cells = inventory.cells.filter((cell) => cell.sheet === "Lots");
    expect(cells.map((cell) => cell.value)).toEqual(["\r", "_x0041_"]);
    expect(cells.map((cell) => cell.raw)).toEqual(["_x000D_", "_x005F_x0041_"]);
  });

  it("decodes rich text runs once", () => {
    const bytes = buildSyntheticWorkbook({
      "xl/sharedStrings.xml": "<sst><si><r><t>_x000D_</t></r><r><t>_x005F_x0041_</t></r></si></sst>",
      "xl/worksheets/sheet1.xml": sheet(
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c>' +
        '<c r="B1" t="inlineStr"><is><r><t>A_x000D_</t></r><r><t>B_x005F_x0041_</t></r></is></c>' +
        "</row></sheetData>",
      ),
      "xl/worksheets/sheet2.xml": sheet("<sheetData/>"),
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.sharedStrings[0]).toBe("\r_x0041_");
    const byAddress = new Map(inventory.cells.filter((cell) => cell.sheet === "Lots").map((cell) => [cell.address, cell]));
    expect(byAddress.get("A1")?.value).toBe("\r_x0041_");
    expect(byAddress.get("B1")?.value).toBe("A\rB_x0041_");
    expect(byAddress.get("B1")?.raw).toBe("A_x000D_B_x005F_x0041_");
  });

  it("keeps an escape split across shared rich text runs literal", () => {
    const bytes = buildSyntheticWorkbook({
      "xl/sharedStrings.xml": "<sst><si><r><t>_x00</t></r><r><t>41_</t></r></si><si><t>_x005F_x0041_</t></si></sst>",
      "xl/worksheets/sheet1.xml": sheet(
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row></sheetData>',
      ),
      "xl/worksheets/sheet2.xml": sheet("<sheetData/>"),
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.sharedStrings.slice(0, 2)).toEqual(["_x0041_", "_x0041_"]);
    const cells = inventory.cells.filter((cell) => cell.sheet === "Lots");
    expect(cells.map((cell) => cell.value)).toEqual(["_x0041_", "_x0041_"]);
  });

  it("keeps an escape split across inline rich text runs literal", () => {
    const inventory = captureSheet(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>_x00</t></r><r><t>41_</t></r></is></c></row></sheetData>',
    );
    const cell = inventory.cells.find((cell) => cell.sheet === "Lots");
    expect(cell?.value).toBe("_x0041_");
    expect(cell?.raw).toBe("_x0041_");
  });

  it("decodes formula string results and preserves the raw text", () => {
    const inventory = captureSheet(
      '<sheetData><row r="1"><c r="A1" t="str"><f>CHAR(13)</f><v>_x000D_</v></c>' +
      '<c r="B1" t="str"><f>CONCAT("_",CHAR(65))</f><v>_x005F_x0041_</v></c></row></sheetData>',
    );
    const cells = inventory.cells.filter((cell) => cell.sheet === "Lots");
    expect(cells.map((cell) => cell.value)).toEqual(["\r", "_x0041_"]);
    expect(cells.map((cell) => cell.raw)).toEqual(["_x000D_", "_x005F_x0041_"]);
    expect(cells.map((cell) => cell.cachedValue)).toEqual(["_x000D_", "_x005F_x0041_"]);
  });
});
