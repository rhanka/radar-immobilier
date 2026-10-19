/**
 * Inventory capture tests on a synthetic in-memory workbook.
 * No real workbook data, no network, no database.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { SteveCaptureError } from "./types.js";
import type { CellRecord } from "./types.js";
import {
  ACCENTED_TEXT,
  EXPECTED_CODES,
  LONG_TEXT,
  buildSyntheticWorkbook,
} from "./workbook.fixture.js";
import { workbookRelsXml, workbookXml } from "./workbook-parts.fixture.js";

function cellAt(cells: CellRecord[], address: string): CellRecord {
  const found = cells.filter((cell) => cell.sheet === "Lots").find((cell) => cell.address === address);
  if (found === undefined) throw new Error(`missing test cell ${address}`);
  return found;
}

describe("captureWorkbookInventory sheets", () => {
  it("lists sheets in workbook order with stable identity", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.sheets).toEqual([
      {
        name: "Lots", order: 0, state: "visible",
        sheetId: 1, relationshipId: "rId1", part: "xl/worksheets/sheet1.xml",
      },
      {
        name: "Codes", order: 1, state: "visible",
        sheetId: 2, relationshipId: "rId2", part: "xl/worksheets/sheet2.xml",
      },
      {
        name: "Archive", order: 2, state: "hidden",
        sheetId: 3, relationshipId: "rId3", part: "xl/worksheets/sheet3.xml",
      },
    ]);
  });

  it("reads the relationship id whatever namespace prefix the writer used", () => {
    const relNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const renamed = workbookXml()
      .replace('xmlns:r="', 'xmlns:x="')
      .replaceAll("r:id=", "x:id=");
    expect(renamed).toContain(`xmlns:x="${relNs}"`);
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({ "xl/workbook.xml": renamed }));
    expect(inventory.sheets.map((sheet) => sheet.relationshipId)).toEqual(["rId1", "rId2", "rId3"]);
  });

  const invalidSheets: Array<[string, Record<string, string>, RegExp]> = [
    ["duplicate name", { "xl/workbook.xml": workbookXml().replace('name="Codes"', 'name="LOTS"') }, /duplicate sheet name/],
    ["duplicate sheet id", { "xl/workbook.xml": workbookXml().replace('sheetId="2"', 'sheetId="1"') }, /duplicate sheet id/],
    ["duplicate part", { "xl/_rels/workbook.xml.rels": workbookRelsXml().replace("sheet2.xml", "sheet1.xml") }, /duplicate sheet part/],
    ["missing sheet id", { "xl/workbook.xml": workbookXml().replace(' sheetId="2"', "") }, /has no sheet id/],
    ["zero sheet id", { "xl/workbook.xml": workbookXml().replace('sheetId="2"', 'sheetId="0"') }, /invalid sheet id/],
    ["unsafe sheet id", { "xl/workbook.xml": workbookXml().replace('sheetId="2"', 'sheetId="9007199254740992"') }, /invalid sheet id/],
    ["hex sheet id", { "xl/workbook.xml": workbookXml().replace('sheetId="2"', 'sheetId="0x2"') }, /invalid sheet id/],
    ["missing relationship id", { "xl/workbook.xml": workbookXml().replace(' r:id="rId2"', "") }, /has no relationship id/],
    ["unknown relationship", { "xl/workbook.xml": workbookXml().replace('r:id="rId2"', 'r:id="rId9"') }, /unknown relationship/],
  ];
  it.each(invalidSheets)("rejects sheets with %s", (_label, overrides, message) => {
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook(overrides))).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook(overrides))).toThrow(message);
  });
});

describe("captureWorkbookInventory cells", () => {
  it("resolves shared strings, accents preserved", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    const a1 = cellAt(inventory.cells, "A1");
    expect(a1.type).toBe("s");
    expect(a1.raw).toBe("0");
    expect(a1.value).toBe(ACCENTED_TEXT);
    expect(a1.sheetId).toBe(1);
    expect(a1.style).toBeNull();
  });

  it("captures numbers, booleans, errors and formula strings with cached values", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(cellAt(inventory.cells, "B1").value).toBe("7");
    expect(cellAt(inventory.cells, "F5").type).toBe("b");
    expect(cellAt(inventory.cells, "F5").value).toBe("1");
    expect(cellAt(inventory.cells, "G6").type).toBe("e");
    expect(cellAt(inventory.cells, "G6").value).toBe("#DIV/0!");
    const str = cellAt(inventory.cells, "C7");
    expect(str.type).toBe("str");
    expect(str.formula?.text).toBe('CONCAT("a","b")');
    expect(str.cachedValue).toBe("ab");
  });

  it("preserves cells longer than 10000 characters verbatim", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    const d4 = cellAt(inventory.cells, "D4");
    expect(d4.type).toBe("inlineStr");
    expect(d4.value?.length).toBeGreaterThan(10000);
    expect(d4.value).toBe(LONG_TEXT);
  });

  it("captures shared formulas: master text plus daughter refs", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    const master = cellAt(inventory.cells, "E1");
    expect(master.formula).toEqual({ text: "SUM(B1:B2)", kind: "shared", ref: "E1:E3", si: 0 });
    expect(master.cachedValue).toBe("13.5");
    for (const address of ["E2", "E3"]) {
      const daughter = cellAt(inventory.cells, address);
      expect(daughter.formula?.text).toBe("");
      expect(daughter.formula?.si).toBe(0);
      expect(daughter.cachedValue).toBe("13.5");
    }
  });

  it("keeps a stable order: workbook sheet blocks, then row, then column", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    const orderOf = (name: string): number =>
      inventory.sheets.find((sheet) => sheet.name === name)?.order ?? -1;
    const keys = inventory.cells.map(
      (cell) =>
        `${String(orderOf(cell.sheet))}:${String(cell.row).padStart(6, "0")}:${String(cell.col).padStart(6, "0")}`,
    );
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe("captureWorkbookInventory workbook features", () => {
  it("captures dropdown validations, defined names and autofilters", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.dataValidations).toMatchObject([
      { sheet: "Lots", sheetId: 1, sqref: "A2:A4", type: "list", formula1: '"Choix A,Choix B"' },
    ]);
    expect(inventory.definedNames).toMatchObject([{ name: "LotsList", value: "Lots!$A:$A" }]);
    expect(inventory.autoFilters).toMatchObject([{ sheet: "Lots", sheetId: 1, ref: "A1:G10" }]);
  });

  it("exposes resolved shared strings", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.sharedStrings).toContain(ACCENTED_TEXT);
    expect(inventory.sharedStrings).toEqual(
      expect.arrayContaining([...EXPECTED_CODES, "Motif"]),
    );
  });

  it("preserves a non-sequential sheet id on renamed-sheet validations and filters", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/workbook.xml": workbookXml().replace('sheetId="1"', 'sheetId="71"')
        .replace('name="Lots"', 'name="Renamed"'),
    }));
    expect(inventory.dataValidations).toMatchObject([{ sheet: "Renamed", sheetId: 71 }]);
    expect(inventory.autoFilters).toMatchObject([{ sheet: "Renamed", sheetId: 71 }]);
  });
});

describe("captureWorkbookInventory coverage proof", () => {
  it("exposes the sorted list of ZIP parts", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.parts).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/_rels/workbook.xml.rels",
      "xl/sharedStrings.xml",
      "xl/workbook.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]);
  });

  it("captures hidden rows, hidden columns and the cell style index", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({
      "xl/worksheets/sheet1.xml":
        `<worksheet><cols><col min="2" max="3" hidden="1"/><col min="5" max="5"/></cols>` +
        `<cols><col min="3" max="4" hidden="true"/></cols><sheetData>` +
        `<row r="1" hidden="1"><c r="A1" s="3"><v>7</v></c><c r="B1"><v>8</v></c></row>` +
        `</sheetData></worksheet>`,
    }));
    expect(inventory.hiddenRows).toEqual([{ sheet: "Lots", sheetId: 1, row: 1 }]);
    expect(inventory.hiddenColumns).toEqual([
      { sheet: "Lots", sheetId: 1, col: 2 },
      { sheet: "Lots", sheetId: 1, col: 3 },
      { sheet: "Lots", sheetId: 1, col: 4 },
    ]);
    expect(inventory.cells.filter((cell) => cell.sheet === "Lots").map((cell) => cell.style))
      .toEqual([3, null]);
  });

  it("lists detected features that are not captured", () => {
    const inventory = captureWorkbookInventory(
      buildSyntheticWorkbook(
        {
          "xl/worksheets/sheet1.xml":
            `<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row></sheetData>` +
            `<mergeCells><mergeCell ref="A1:B1"/></mergeCells>` +
            `<hyperlinks><hyperlink ref="A1" r:id="rIdH1"/></hyperlinks>` +
            `<tableParts><tablePart r:id="rIdT1"/></tableParts>` +
            `<extLst><ext><x14><dataValidation/></x14></ext></extLst>` +
            `</worksheet>`,
        },
        { "xl/styles.xml": `<styleSheet><fonts><font><b/></font></fonts></styleSheet>` },
      ),
    );
    const features = inventory.uncaptured.map((item) => `${String(item.sheet)}:${item.feature}`);
    expect(features).toEqual(
      expect.arrayContaining([
        "Lots:mergeCells",
        "Lots:hyperlinks",
        "Lots:tables",
        "Lots:extensionList",
        "Lots:dataValidationExtensions",
        "null:styleDefinitions",
      ]),
    );
  });
});

describe("captureWorkbookInventory determinism", () => {
  it("same bytes give the same sha256 and an identical inventory", () => {
    const bytes = buildSyntheticWorkbook();
    const first = captureWorkbookInventory(bytes);
    const second = captureWorkbookInventory(bytes.slice());
    expect(first.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(bytes).toEqual(buildSyntheticWorkbook());
  });

  it.each([false, true])("matches the frozen semantic fingerprint (stored=%s)", (stored) => {
    // Archive bytes may differ between zlib versions; freeze the semantic inventory.
    const parts = stored ? captureWorkbookInventory(buildSyntheticWorkbook()).parts : [];
    const { sha256: _sha256, ...inventory } = captureWorkbookInventory(buildSyntheticWorkbook({}, {}, parts));
    expect(createHash("sha256").update(JSON.stringify(inventory)).digest("hex"))
      .toBe("ec9dcf2c46697b4703ea6de73610c3fa9a3a8777e03fc71c7f6b122f4cf643f3");
    expect(inventory.sharedStrings).toEqual([ACCENTED_TEXT, "Motif", ...EXPECTED_CODES]);
    expect(inventory.hiddenRows).toEqual([]);
    expect(inventory.hiddenColumns).toEqual([]);
    expect(inventory.uncaptured).toEqual([]);
    expect(inventory.cells.map((cell) => [
      cell.sheet, cell.sheetId, cell.address, cell.type, cell.raw, cell.value,
      cell.style, cell.formula, cell.cachedValue,
    ])).toEqual([
      ["Lots", 1, "A1", "s", "0", ACCENTED_TEXT, null, null, null],
      ["Lots", 1, "B1", "n", "7", "7", null, null, null],
      ["Lots", 1, "E1", "n", "13.5", "13.5", null, { text: "SUM(B1:B2)", kind: "shared", ref: "E1:E3", si: 0 }, "13.5"],
      ["Lots", 1, "B2", "n", "6.5", "6.5", null, null, null],
      ["Lots", 1, "E2", "n", "13.5", "13.5", null, { text: "", kind: "shared", ref: null, si: 0 }, "13.5"],
      ["Lots", 1, "E3", "n", "13.5", "13.5", null, { text: "", kind: "shared", ref: null, si: 0 }, "13.5"],
      ["Lots", 1, "D4", "inlineStr", LONG_TEXT, LONG_TEXT, null, null, null],
      ["Lots", 1, "F5", "b", "1", "1", null, null, null],
      ["Lots", 1, "G6", "e", "#DIV/0!", "#DIV/0!", null, null, null],
      ["Lots", 1, "C7", "str", "ab", "ab", null, { text: 'CONCAT("a","b")', kind: null, ref: null, si: null }, "ab"],
      ["Codes", 2, "A1", "s", "1", "Motif", null, null, null],
      ["Codes", 2, "A2", "s", "2", "SYN-ALPHA", null, null, null],
      ["Codes", 2, "A3", "s", "3", "SYN-BÊTA", null, null, null],
      ["Codes", 2, "A4", "s", "4", "SYN-GAMMA", null, null, null],
      ["Archive", 3, "A1", "n", "42", "42", null, null, null],
    ]);
  });
});

describe("captureWorkbookInventory corrupt input", () => {
  it("rejects non-ZIP bytes with an explicit error", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/file too small/);
  });

  it("rejects a truncated workbook with an explicit error", () => {
    const bytes = buildSyntheticWorkbook().slice(0, 120);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/end-of-central-directory/);
  });
});
