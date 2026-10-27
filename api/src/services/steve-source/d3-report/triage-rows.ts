/**
 * Triage row extraction: `Triage` sheet, label-located headers, retained
 * rows below the header with non-empty `Classement`, locator kept, raw
 * and value kept distinct.
 */

import { SteveCaptureError } from "../types.js";
import type { CellRecord, WorkbookInventory } from "../types.js";
import { findTriageHeaders } from "./triage-headers.js";

export const TRIAGE_SHEET_NAME = "Triage";

export const TRIAGE_HEADER_NUMBER = "#";
export const TRIAGE_HEADER_CITY = "Ville";
export const TRIAGE_HEADER_MRC = "MRC / Région";
export const TRIAGE_HEADER_REGLEMENT = "N° règlement";
export const TRIAGE_HEADER_CLASSEMENT = "Classement";

const TRIAGE_HEADERS = [
  TRIAGE_HEADER_NUMBER,
  TRIAGE_HEADER_CITY,
  TRIAGE_HEADER_MRC,
  TRIAGE_HEADER_REGLEMENT,
  TRIAGE_HEADER_CLASSEMENT,
] as const;
export interface TriageLocator {
  sheet: string;
  sheetId: number;
  row: number;
}

export interface TriageCell {
  raw: string | null;
  value: string | null;
}

export interface TriageRow {
  locator: TriageLocator;
  order: number;
  number: TriageCell;
  city: TriageCell;
  mrc: TriageCell;
  reglement: TriageCell;
  classement: TriageCell;
}

function cellPair(
  cellsByKey: Map<string, CellRecord>,
  row: number,
  col: number,
): TriageCell {
  const cell = cellsByKey.get(`${String(row)}:${String(col)}`);
  if (cell === undefined) return { raw: null, value: null };
  return { raw: cell.raw, value: cell.value };
}

export function readTriageRows(inventory: WorkbookInventory): TriageRow[] {
  const sheet = inventory.sheets.find(
    (entry) => entry.name === TRIAGE_SHEET_NAME,
  );
  if (sheet === undefined) {
    throw new SteveCaptureError(
      `sheet not found: "${TRIAGE_SHEET_NAME}"`,
    );
  }
  const cells = inventory.cells.filter(
    (cell) => cell.sheet === TRIAGE_SHEET_NAME,
  );
  const headers = findTriageHeaders(cells, TRIAGE_HEADERS, TRIAGE_SHEET_NAME);
  const headerRow = headers[0]?.row;
  if (headerRow === undefined) {
    throw new SteveCaptureError(
      `triage headers missing in sheet "${TRIAGE_SHEET_NAME}"`,
    );
  }
  const numberCol = headers[0]?.col ?? 0;
  const cityCol = headers[1]?.col ?? 0;
  const mrcCol = headers[2]?.col ?? 0;
  const reglementCol = headers[3]?.col ?? 0;
  const classementCol = headers[4]?.col ?? 0;
  const cellsByKey = new Map<string, CellRecord>();
  for (const cell of cells) {
    cellsByKey.set(`${String(cell.row)}:${String(cell.col)}`, cell);
  }
  const dataRows = new Set<number>();
  for (const cell of cells) {
    if (cell.row > headerRow) dataRows.add(cell.row);
  }
  const ordered = [...dataRows].sort((a, b) => a - b);
  const rows: TriageRow[] = [];
  for (const row of ordered) {
    const classementCell = cellsByKey.get(
      `${String(row)}:${String(classementCol)}`,
    );
    const classementText = (
      classementCell?.value ?? classementCell?.raw ?? ""
    ).trim();
    if (classementText.length === 0) continue;
    const order = rows.length;
    rows.push({
      locator: { sheet: TRIAGE_SHEET_NAME, sheetId: sheet.sheetId, row },
      order,
      number: cellPair(cellsByKey, row, numberCol),
      city: cellPair(cellsByKey, row, cityCol),
      mrc: cellPair(cellsByKey, row, mrcCol),
      reglement: cellPair(cellsByKey, row, reglementCol),
      classement: cellPair(cellsByKey, row, classementCol),
    });
  }
  return rows;
}
