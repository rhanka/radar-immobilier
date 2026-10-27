import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { independentWorkbook } from "./independent-workbook.fixture.js";
describe("independent OOXML interoperability", () => {
  it("reads an OOXML archive produced by Info-ZIP with relocated parts", () => {
    const inventory = captureWorkbookInventory(independentWorkbook());
    expect(inventory.sheets).toEqual([
      {
        name: "Solo", order: 0, state: "visible",
        sheetId: 7, relationshipId: "sheet", part: "book/worksheets/solo.xml",
      },
    ]);
    expect(inventory.cells).toEqual([
      expect.objectContaining({ sheet: "Solo", sheetId: 7, address: "A1", value: "5" }),
      expect.objectContaining({ sheet: "Solo", sheetId: 7, address: "B1", value: "Synthetic" }),
    ]);
  });
});
