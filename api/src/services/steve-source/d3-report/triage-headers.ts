import { SteveCaptureError } from "../types.js";
import type { CellRecord } from "../types.js";

function labelOf(cell: CellRecord): string {
  return (cell.value ?? cell.raw ?? "").normalize("NFC").trim().toLowerCase();
}

/** Locate the table header before validating its labels; other rows are data. */
export function findTriageHeaders(
  cells: CellRecord[], labels: readonly string[], sheet: string,
): CellRecord[] {
  const wanted = labels.map((label) => label.normalize("NFC").trim().toLowerCase());
  const byRow = new Map<number, CellRecord[]>();
  for (const cell of cells) {
    const row = byRow.get(cell.row) ?? [];
    row.push(cell);
    byRow.set(cell.row, row);
  }
  const ranked = [...byRow.values()].map((row) => ({
    row, labels: new Set(row.map(labelOf).filter((label) => wanted.includes(label))).size,
  })).sort((a, b) => b.labels - a.labels || (a.row[0]?.row ?? 0) - (b.row[0]?.row ?? 0));
  if (ranked.filter((entry) => entry.labels === labels.length).length > 1) {
    throw new SteveCaptureError("duplicate triage header row");
  }
  const headerCells = ranked[0]?.row ?? [];
  return labels.map((label, index) => {
    const matches = headerCells.filter((cell) => labelOf(cell) === wanted[index]);
    const first = matches[0];
    if (first === undefined) {
      throw new SteveCaptureError(`triage header "${label}" not found in sheet "${sheet}"`);
    }
    if (matches.length > 1) {
      throw new SteveCaptureError(`duplicate triage header "${label}" in sheet "${sheet}"`);
    }
    return first;
  });
}
