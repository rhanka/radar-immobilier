/**
 * Cell-level parser for worksheet parts.
 *
 * A cell is kept when it carries a stored value (`v`), an inline string
 * (`is`) or a formula (`f`). Shared-formula daughters (empty `f` with `si`)
 * keep their own cached value; the master text is resolved by the caller
 * through the matching `si`.
 */

import { columnIndexToLetters, parseA1 } from "./cell-ref.js";
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

export function parseRowNumber(raw: string, sheetName: string): number {
  const row = Number(raw);
  if (!Number.isInteger(row) || row < 1 || row > 1048576) {
    throw new SteveCaptureError(`invalid row number "${raw}" in sheet "${sheetName}"`);
  }
  return row;
}

function parseFormula(cell: XmlNode, sheetName: string, where: string): CellFormula | null {
  const f = firstChild(cell, "f");
  if (f === null) return null;
  const siAttr = attr(f, "si");
  let si: number | null = null;
  if (siAttr !== null) {
    si = Number(siAttr);
    if (!Number.isInteger(si) || si < 0) {
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
  rowNum: number,
  colFallback: number,
  sharedStrings: readonly string[],
): CellRecord | null {
  const refAttr = attr(cell, "r");
  let row = rowNum;
  let col = colFallback;
  if (refAttr !== null) {
    const pos = parseA1(refAttr);
    row = pos.row;
    col = pos.col;
  }
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
    address: `${columnIndexToLetters(col)}${String(row)}`,
    row,
    col,
    type: typeAttr,
    raw,
    value,
    formula,
    cachedValue: formula === null ? null : vText,
  };
}
