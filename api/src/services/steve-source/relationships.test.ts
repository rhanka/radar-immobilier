import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
import { workbookXml } from "./workbook-parts.fixture.js";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

describe("sheet relationship namespaces", () => {
  it.each(["sheets", "sheet"])("reads namespace declarations on %s", (scope) => {
    let xml = workbookXml().replace(` xmlns:r="${REL_NS}"`, "");
    if (scope === "sheets") xml = xml.replace("<sheets>", `<sheets xmlns:x="${REL_NS}">`);
    else xml = xml.replaceAll("<sheet ", `<sheet xmlns:x="${REL_NS}" `);
    xml = xml.replaceAll("r:id=", "x:id=");
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({ "xl/workbook.xml": xml }));
    expect(inventory.sheets.map((sheet) => sheet.relationshipId)).toEqual(["rId1", "rId2", "rId3"]);
  });

  it.each([
    ['r:id="rId1"', 'id="rId1"'],
    ['r:id="rId1"', 'xmlns:r="urn:other" r:id="rId1"'],
    ['r:id="rId1"', 'xmlns:x="urn:other" x:id="rId1"'],
  ])("rejects an id outside the relationship namespace (%s)", (before, after) => {
    const xml = workbookXml().replace(before, after);
    expect(() => captureWorkbookInventory(buildSyntheticWorkbook({ "xl/workbook.xml": xml })))
      .toThrow(/has no relationship id/);
  });

  it("accepts a valid alias when another prefix is shadowed", () => {
    const xml = workbookXml().replace('r:id="rId1"',
      `xmlns:r="urn:other" xmlns:x="${REL_NS}" r:id="ignored" x:id="rId1"`);
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook({ "xl/workbook.xml": xml }));
    expect(inventory.sheets[0]?.relationshipId).toBe("rId1");
  });
});
