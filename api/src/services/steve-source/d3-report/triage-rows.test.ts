/**
 * Triage row extraction tests on synthetic workbooks only.
 */

import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "../inventory.js";
import { SteveCaptureError } from "../types.js";
import { buildSyntheticWorkbook } from "../workbook.fixture.js";
import {
  buildTriageWorkbook,
  triageSheetXml,
} from "./fixtures.js";
import { readTriageRows } from "./triage-rows.js";

describe("readTriageRows", () => {
  it("retains rows with a non-empty classement whatever the visibility", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([
        { city: "Ville Synth A", classement: "Pertinent" },
        { city: "Ville Synth B", classement: "  " },
        { city: "Ville Synth B", classement: "Non pertinent" },
      ]),
    );
    const rows = readTriageRows(inventory);
    expect(rows.map((row) => row.locator.row)).toEqual([2, 4]);
    expect(rows[0]?.classement.value).toBe("Pertinent");
  });

  it("keeps hidden rows and the sheet locator", () => {
    const hiddenSheet =
      `<worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>#</t></is></c>` +
      `<c r="B1" t="inlineStr"><is><t>Ville</t></is></c>` +
      `<c r="C1" t="inlineStr"><is><t>MRC / Région</t></is></c>` +
      `<c r="D1" t="inlineStr"><is><t>N° règlement</t></is></c>` +
      `<c r="E1" t="inlineStr"><is><t>Classement</t></is></c></row>` +
      `<row r="2" hidden="1"><c r="B2" t="inlineStr"><is><t>Ville Synth A</t></is></c>` +
      `<c r="E2" t="inlineStr"><is><t>Pertinent</t></is></c></row>` +
      `</sheetData></worksheet>`;
    const inventory = captureWorkbookInventory(
      buildSyntheticWorkbook({
        "xl/workbook.xml":
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Triage" sheetId="1" r:id="rId1"/>` +
          `<sheet name="Codes" sheetId="2" r:id="rId2"/>` +
          `<sheet name="Archive" sheetId="3" r:id="rId3"/></sheets></workbook>`,
        "xl/worksheets/sheet1.xml": hiddenSheet,
      }),
    );
    const rows = readTriageRows(inventory);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.locator).toEqual({
      sheet: "Triage",
      sheetId: 1,
      row: 2,
    });
  });

  it("keeps empty, raw and unrecognized values distinct", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([
        { classement: "SYN-UNKNOWN" },
      ]),
    );
    const rows = readTriageRows(inventory);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.city).toEqual({ raw: null, value: null });
    expect(rows[0]?.classement.value).toBe("SYN-UNKNOWN");
    expect(rows[0]?.classement.raw).toBe("SYN-UNKNOWN");
  });

  it("rejects a missing Triage sheet", () => {
    const inventory = captureWorkbookInventory(buildSyntheticWorkbook());
    expect(() => readTriageRows(inventory)).toThrow(SteveCaptureError);
  });

  it("rejects a missing header label", () => {
    const inventory = captureWorkbookInventory(
      buildSyntheticWorkbook({
        "xl/workbook.xml":
          `<?xml version="1.0" encoding="UTF-8"?>` +
          `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="Triage" sheetId="1" r:id="rId1"/>` +
          `<sheet name="Codes" sheetId="2" r:id="rId2"/>` +
          `<sheet name="Archive" sheetId="3" r:id="rId3"/></sheets></workbook>`,
        "xl/worksheets/sheet1.xml": triageSheetXml([], [
          "#",
          "Ville",
          "MRC / Région",
          "N° règlement",
        ]),
      }),
    );
    expect(() => readTriageRows(inventory)).toThrow(/Classement/);
  });

  it("rejects a duplicated header label", () => {
    const inventory = captureWorkbookInventory(
      buildTriageWorkbook([], ["#", "Ville", "Ville", "N° règlement", "Classement"]),
    );
    expect(() => readTriageRows(inventory)).toThrow(/duplicate triage header/);
  });

  it("is deterministic on the same bytes", () => {
    const bytes = buildTriageWorkbook([
      { city: "Ville Synth A", classement: "Pertinent" },
    ]);
    const first = readTriageRows(captureWorkbookInventory(bytes));
    const second = readTriageRows(captureWorkbookInventory(bytes.slice()));
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("rejects repeated complete header rows", () => {
    const inventory = captureWorkbookInventory(buildTriageWorkbook([]));
    const repeated = inventory.cells.filter((cell) => cell.sheet === "Triage" && cell.row === 1)
      .map((cell) => ({ ...cell, row: 99, address: cell.address.replace(/1$/, "99") }));
    inventory.cells.push(...repeated);
    expect(() => readTriageRows(inventory)).toThrow(/duplicate triage header row/);
  });
});
