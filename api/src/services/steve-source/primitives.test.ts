import { describe, expect, it } from "vitest";
import { parseCell } from "./cell-parse.js";
import { columnIndexToLetters, parseA1 } from "./cell-ref.js";
import { crc32 } from "./crc32.js";
import { captureWorkbookInventory } from "./inventory.js";
import { parseSheetXml } from "./sheet-parse.js";
import { SteveCaptureError } from "./types.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
import { parseXml } from "./xml.js";
import { documentElement, spreadsheetText } from "./xml-query.js";
import { decodeEntities } from "./xml-token.js";

describe("workbook coordinates", () => {
  it("round-trips the final Excel column", () => {
    expect(parseA1("XFD1048576")).toEqual({ row: 1048576, col: 16384 });
    expect(columnIndexToLetters(16384)).toBe("XFD");
  });

  it.each(["A0", "A1048577", "XFE1", "A9007199254740992"])("rejects %s", (ref) => {
    expect(() => parseA1(ref)).toThrow(SteveCaptureError);
  });
});

describe("XML text", () => {
  it("decodes accents, escaped markup and numeric references once", () => {
    expect(decodeEntities("&#xCE;le &amp; fa&#231;ade &amp;lt;"))
      .toBe("Île & façade &lt;");
  });

  it.each(["&unknown;", "&amp", "&#0;", "&#x110000;", "&#X41;"])("rejects %s", (text) => {
    expect(() => decodeEntities(text)).toThrow(SteveCaptureError);
  });
});

describe("XML attributes", () => {
  it("keeps a literal __proto__ attribute as an own property", () => {
    const node = documentElement(parseXml('<a __proto__="polluted"/>'));
    expect(node === null ? null : Object.hasOwn(node.attrs, "__proto__")).toBe(true);
    expect(node?.attrs["__proto__"]).toBe("polluted");
    expect(({} as Record<string, string>)["polluted"]).toBeUndefined();
  });
});

describe("OOXML parsing", () => {
  it("reads namespaces, comments, CDATA, escaped attributes and rich runs", () => {
    const node = documentElement(parseXml(`<?xml version="1.0"?><!--test-->
      <s:si xmlns:s="urn:test" label="A &gt; B"><r><t><![CDATA[Île & façade]]></t></r></s:si>`));
    expect(node?.attrs["label"]).toBe("A > B");
    expect(node === null ? null : spreadsheetText(node)).toBe("Île & façade");
  });

  it.each(["<a/><b/>", "<a></b>", "<a>", '<a x="1" x="2"/>', "<a x=no/>", "<!DOCTYPE a><a/>"])(
    "rejects malformed or unsupported XML %s", (xml) => {
      expect(() => parseXml(xml)).toThrow(SteveCaptureError);
    },
  );
});

describe("ZIP CRC-32", () => {
  it("matches the standard reference vector", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("stored cell values", () => {
  it("keeps a shared formula and its own cached value without evaluating it", () => {
    const node = documentElement(parseXml('<c r="C3"><f t="shared" si="2"/><v>0</v></c>'));
    if (node === null) throw new Error("missing cell");
    expect(parseCell("Sheet", node, 3, 3, [], 7)).toMatchObject({
      address: "C3", type: "n", raw: "0", cachedValue: "0", sheetId: 7, style: null,
      formula: { text: "", kind: "shared", si: 2 },
    });
  });

  it("ignores style-only cells", () => {
    const node = documentElement(parseXml('<c r="A1" s="1"/>'));
    if (node === null) throw new Error("missing cell");
    expect(parseCell("Sheet", node, 1, 1, [], 7)).toBeNull();
  });

  it("captures the style index without interpreting it", () => {
    const node = documentElement(parseXml('<c r="B2" s="3"><v>1</v></c>'));
    if (node === null) throw new Error("missing cell");
    expect(parseCell("Sheet", node, 2, 2, [], 7)?.style).toBe(3);
  });

  it.each(['<c r="B2" s="0x10"><v>1</v></c>', '<c r="B2" s=""><v>1</v></c>'])(
    "rejects non-canonical style index %s", (xml) => {
      const node = documentElement(parseXml(xml));
      if (node === null) throw new Error("missing cell");
      expect(() => parseCell("Sheet", node, 2, 2, [], 7)).toThrow(SteveCaptureError);
    },
  );
});

describe("worksheet assembly", () => {
  it("keeps numeric sorting across sparse worksheet rows and columns", () => {
    const parsed = parseSheetXml("Sheet", `<worksheet><sheetData>
      <row r="10"><c r="AA10"><v>2</v></c><c r="B10"><v>1</v></c></row>
      <row r="2"><c r="A2"><v>0</v></c></row></sheetData></worksheet>`, [], 7);
    expect(parsed.cells.map((cell) => cell.address)).toEqual(["A2", "B10", "AA10"]);
    expect(parsed.cells.every((cell) => cell.sheetId === 7)).toBe(true);
  });
});

describe("generated workbook", () => {
  it("captures the generated workbook without changing its bytes", () => {
    const bytes = buildSyntheticWorkbook();
    const before = bytes.slice();
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.sheets).toHaveLength(3);
    expect(inventory.sheets.map((sheet) => sheet.sheetId)).toEqual([1, 2, 3]);
    expect(bytes).toEqual(before);
  });
});
