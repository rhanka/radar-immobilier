/**
 * A1 cell-reference helpers (column letters <-> 1-based indices).
 */

import { SteveCaptureError } from "./types.js";

export interface CellPosition {
  row: number;
  col: number;
}

export function parseA1(ref: string): CellPosition {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) {
    throw new SteveCaptureError(`invalid cell reference: "${ref}"`);
  }
  let col = 0;
  for (const ch of letters.toUpperCase()) {
    col = col * 26 + (ch.charCodeAt(0) - 64);
  }
  const row = Number(digits);
  if (col < 1 || col > 16384 || !Number.isInteger(row) || row < 1 || row > 1048576) {
    throw new SteveCaptureError(`invalid cell reference: "${ref}"`);
  }
  return { row, col };
}

export function columnIndexToLetters(col: number): string {
  if (!Number.isInteger(col) || col < 1 || col > 16384) {
    throw new SteveCaptureError(`invalid column index: ${String(col)}`);
  }
  let n = col;
  let out = "";
  while (n > 0) {
    out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}
