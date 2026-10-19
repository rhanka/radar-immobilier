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
} from "./workbook-fixture.js";

function cellAt(cells: CellRecord[], address: string): CellRecord {
  const found = cells.filter((cell) => cell.sheet === "Lots").find((cell) => cell.address === address);
  if (found === undefined) throw new Error(`missing test cell ${address}`);
  return found;
}

describe("captureWorkbookInventory sheets", () => {
  it("lists sheets in workbook order with visibility", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.sheets).toEqual([
      { name: "Lots", order: 0, state: "visible" },
      { name: "Codes", order: 1, state: "visible" },
      { name: "Archive", order: 2, state: "hidden" },
    ]);
  });
});

describe("captureWorkbookInventory cells", () => {
  it("resolves shared strings, accents preserved", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    const a1 = cellAt(inventory.cells, "A1");
    expect(a1.type).toBe("s");
    expect(a1.raw).toBe("0");
    expect(a1.value).toBe(ACCENTED_TEXT);
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
      { sheet: "Lots", sqref: "A2:A4", type: "list", formula1: '"Choix A,Choix B"' },
    ]);
    expect(inventory.definedNames).toMatchObject([{ name: "LotsList", value: "Lots!$A:$A" }]);
    expect(inventory.autoFilters).toMatchObject([{ sheet: "Lots", ref: "A1:G10" }]);
  });

  it("exposes resolved shared strings", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(inventory.sharedStrings).toContain(ACCENTED_TEXT);
    expect(inventory.sharedStrings).toEqual(
      expect.arrayContaining([...EXPECTED_CODES, "Motif"]),
    );
  });
});

describe("captureWorkbookInventory determinism", () => {
  it("same bytes give the same sha256 and an identical inventory", () => {
    const bytes = buildSyntheticWorkbook();
    const first = captureWorkbookInventory(bytes);
    const second = captureWorkbookInventory(bytes.slice());
    expect(first.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(bytes).toEqual(buildSyntheticWorkbook());
  });
});

describe("captureWorkbookInventory corrupt input", () => {
  it("rejects non-ZIP bytes with an explicit error", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
  });

  it("rejects a truncated workbook with an explicit error", () => {
    const bytes = buildSyntheticWorkbook().slice(0, 120);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
  });
});
