/**
 * Scale test: the inventory accumulates large sheets without hitting the
 * argument-count limit of spread pushes.
 */

import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";

describe("capture at 200000 cells", () => {
  it("accumulates a 200000-cell sheet without throwing", { timeout: 120000 }, () => {
    const rows: string[] = [];
    let value = 0;
    for (let row = 1; row <= 2000; row++) {
      let cells = "";
      for (let col = 1; col <= 100; col++) {
        cells += `<c><v>${String(value % 10)}</v></c>`;
        value += 1;
      }
      rows.push(`<row r="${String(row)}">${cells}</row>`);
    }
    const bytes = buildSyntheticWorkbook({
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${rows.join("")}</sheetData></worksheet>`,
    });
    const inventory = captureWorkbookInventory(bytes);
    expect(inventory.cells.filter((cell) => cell.sheet === "Lots")).toHaveLength(200000);
  });
});
