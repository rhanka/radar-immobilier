/**
 * Cell-level parser for worksheet parts.
 *
 * A cell is kept when it carries a stored value (`v`), an inline string
 * (`is`) or a formula (`f`). Shared-formula daughters (empty `f` with `si`)
 * keep their own cached value; the master text is resolved by the caller
 * through the matching `si`.
 *
 * Coordinates are resolved once by the sheet parser and passed in: this
 * module never re-parses the `r` reference.
 */

import { columnIndexToLetters } from "./cell-ref.js";
import { SteveCaptureError } from "./types.js";
import type { CellFormula, CellRecord, CellType } from "./types.js";
import { firstChild, spreadsheetText } from "./xml-query.js";
import type { XmlNode } from "./xml.js";

function attr(node: XmlNode, name: string): string | null {
  const value = node.attrs[name];
  return value === undefined ? null : value;
}

function isCellType(value: string): value is CellType {
  return (
    value === "s" ||
    value === "str" ||
    value === "n" ||
    value === "b" ||
    value === "e" ||
    value === "inlineStr" ||
    value === "d"
  );
}

/** Strict non-negative integer: `Number()` would accept `""` or `"0x10"`. */
export function parseStrictInt(raw: string, what: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new SteveCaptureError(`invalid ${what} "${raw}"`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new SteveCaptureError(`invalid ${what} "${raw}"`);
  return value;
}

export function parseRowNumber(raw: string, sheetName: string): number {
  const row = parseStrictInt(raw, `row number in sheet "${sheetName}"`);
  if (row < 1 || row > 1048576) {
    throw new SteveCaptureError(`invalid row number "${raw}" in sheet "${sheetName}"`);
  }
  return row;
}

export function parseStyleIndex(raw: string | null, sheetName: string, where: string): number | null {
  if (raw === null) return null;
  const style = parseStrictInt(raw, `style index at ${where} in sheet "${sheetName}"`);
  if (style < 0) {
    throw new SteveCaptureError(`invalid style index "${raw}" at ${where} in sheet "${sheetName}"`);
  }
  return style;
}

function parseFormula(cell: XmlNode, sheetName: string, where: string): CellFormula | null {
  const f = firstChild(cell, "f");
  if (f === null) return null;
  const siAttr = attr(f, "si");
  let si: number | null = null;
  if (siAttr !== null) {
    si = parseStrictInt(siAttr, `shared formula index at ${where} in sheet "${sheetName}"`);
    if (si < 0) {
      throw new SteveCaptureError(
        `invalid shared formula index "${siAttr}" at ${where} in sheet "${sheetName}"`,
      );
    }
  }
  return { text: f.text, kind: attr(f, "t"), ref: attr(f, "ref"), si };
}

export function parseCell(
  sheetName: string,
  cell: XmlNode,
  row: number,
  col: number,
  sharedStrings: readonly string[],
  sheetId: number,
): CellRecord | null {
  const refAttr = attr(cell, "r");
  const where = refAttr ?? `R${String(row)}C${String(col)}`;
  const typeAttr = attr(cell, "t") ?? "n";
  if (!isCellType(typeAttr)) {
    throw new SteveCaptureError(
      `unsupported cell type "${typeAttr}" at ${where} in sheet "${sheetName}"`,
    );
  }
  const vNode = firstChild(cell, "v");
  const vText = vNode === null ? null : vNode.text;
  const isNode = firstChild(cell, "is");
  const inlineText = isNode === null ? null : spreadsheetText(isNode);
  const formula = parseFormula(cell, sheetName, where);
  if (vNode === null && isNode === null && formula === null) return null;
  const raw = vText ?? inlineText;
  if ((raw === null || raw === "") && formula === null) return null;
  let value = raw;
  if (typeAttr === "s") {
    if (raw === null) {
      throw new SteveCaptureError(
        `missing shared string value at ${where} in sheet "${sheetName}"`,
      );
    }
    const index = /^\d+$/.test(raw) ? Number(raw) : -1;
    const resolved = sharedStrings[index];
    if (resolved === undefined) {
      throw new SteveCaptureError(
        `shared string index ${raw} out of range at ${where} in sheet "${sheetName}"`,
      );
    }
    value = resolved;
  } else if (typeAttr === "inlineStr") {
    value = inlineText;
  }
  return {
    sheet: sheetName,
    sheetId,
    address: `${columnIndexToLetters(col)}${String(row)}`,
    row,
    col,
    type: typeAttr,
    raw,
    value,
    formula,
    cachedValue: formula === null ? null : vText,
    style: parseStyleIndex(attr(cell, "s"), sheetName, where),
  };
}
