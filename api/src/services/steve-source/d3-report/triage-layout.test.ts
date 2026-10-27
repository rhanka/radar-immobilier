import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import { buildTriageWorkbook } from "./fixtures.js";
import { readTriageRows } from "./triage-rows.js";

describe("Triage header layout and raw values", () => {
  it("ignores header-like text outside a shifted header row", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([
      { city: "Ville Synth A", classement: "Synthetic" },
    ]));
    const cityHeader = inventory.cells.find((cell) => cell.address === "B1");
    if (!cityHeader) throw new Error("synthetic header missing");
    for (const cell of inventory.cells) {
      cell.row += 4;
      cell.address = cell.address.replace(/\d+$/, String(cell.row));
    }
    inventory.cells.push({ ...cityHeader, row: 1, address: "B1" });
    expect(readTriageRows(inventory).map((row) => row.locator.row)).toEqual([6]);
  });

  it("locates reordered columns by labels", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([{
      number: "MRC Synth", city: "Ville Synth A", mrc: "Synthetic",
      reglement: "99", classement: "SYN-1",
    }], ["MRC / Région", "Ville", "Classement", "#", "N° règlement"]));
    const row = readTriageRows(inventory)[0];
    expect(row?.number.value).toBe("99");
    expect(row?.reglement.value).toBe("SYN-1");
    expect(row?.mrc.value).toBe("MRC Synth");
    expect(row?.classement.value).toBe("Synthetic");
  });

  it("preserves a raw shared-string index separately from its decoded value", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([
      { city: "Ville Synth A", classement: "Unrecognized Synthetic" },
    ]));
    const cell = inventory.cells.find((entry) => entry.address === "B2");
    if (!cell) throw new Error("synthetic cell missing");
    cell.raw = "12";
    cell.type = "s";
    expect(readTriageRows(inventory)[0]?.city).toEqual({ raw: "12", value: "Ville Synth A" });
  });
});
