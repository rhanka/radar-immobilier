/**
 * Pattern-code lookup: codes are never hard-coded, they are read from a
 * caller-named sheet. The header row and column are located by label: the
 * first cell (row-major) whose resolved value matches `headerLabel`
 * (NFC, trimmed, case-insensitive) marks the column; every non-empty value
 * below it is returned in row order, verbatim.
 */

import { SteveCaptureError } from "./types.js";
import type { WorkbookInventory } from "./types.js";

export interface PatternCodeLookup {
  sheet: string;
  headerLabel: string;
}

function normalizeLabel(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

export function readPatternCodes(
  inventory: WorkbookInventory,
  lookup: PatternCodeLookup,
): string[] {
  const known = inventory.sheets.some((sheet) => sheet.name === lookup.sheet);
  if (!known) throw new SteveCaptureError(`sheet not found: "${lookup.sheet}"`);
  const cells = inventory.cells.filter((cell) => cell.sheet === lookup.sheet);
  const wanted = normalizeLabel(lookup.headerLabel);
  const header = cells.find(
    (cell) => cell.value !== null && normalizeLabel(cell.value) === wanted,
  );
  if (header === undefined) {
    throw new SteveCaptureError(
      `header label "${lookup.headerLabel}" not found in sheet "${lookup.sheet}"`,
    );
  }
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const cell of cells) {
    if (cell.col !== header.col || cell.row <= header.row) continue;
    if (cell.value === null || cell.value === "") continue;
    if (seen.has(cell.value)) {
      throw new SteveCaptureError(
        `duplicate pattern code "${cell.value}" in sheet "${lookup.sheet}"`,
      );
    }
    seen.add(cell.value);
    codes.push(cell.value);
  }
  return codes;
}
