/**
 * Worksheet part parser: row/cell assembly, validations, autofilter.
 * Cell details live in `cell-parse.ts`.
 */

import { parseCell, parseRowNumber, parseStrictInt } from "./cell-parse.js";
import { parseA1 } from "./cell-ref.js";
import { SteveCaptureError } from "./types.js";
import type {
  AutoFilterRecord,
  CellRecord,
  DataValidationRule,
  UncapturedFeatureName,
} from "./types.js";
import { parseXml } from "./xml.js";
import type { XmlNode } from "./xml.js";
import { childElements, deepText, documentElement, firstChild } from "./xml-query.js";
import type { XmlBudget } from "./xml-budget.js";

export interface ParsedSheet {
  cells: CellRecord[];
  validations: DataValidationRule[];
  autoFilter: AutoFilterRecord | null;
  hiddenRows: number[];
  hiddenColumns: number[];
  uncaptured: Array<{ feature: UncapturedFeatureName; detail: string | null }>;
}

function attr(node: XmlNode, name: string): string | null {
  const value = node.attrs[name];
  return value === undefined ? null : value;
}

function hasDescendantNamed(node: XmlNode, name: string): boolean {
  for (const child of node.children) {
    if (child.name === name || hasDescendantNamed(child, name)) return true;
  }
  return false;
}

function isHidden(raw: string | null): boolean {
  return raw === "1" || (raw !== null && raw.toLowerCase() === "true");
}

export function readHiddenColumns(ws: XmlNode, sheetName: string): number[] {
  const intervals: Array<{ min: number; max: number }> = [];
  for (const col of childElements(ws, "cols").flatMap((cols) => childElements(cols, "col"))) {
    const minRaw = attr(col, "min");
    const maxRaw = attr(col, "max");
    if (minRaw === null || maxRaw === null) continue;
    const min = parseStrictInt(minRaw, `column min in sheet "${sheetName}"`);
    const max = parseStrictInt(maxRaw, `column max in sheet "${sheetName}"`);
    if (min < 1 || max > 16384 || min > max) {
      throw new SteveCaptureError(`invalid column span "${minRaw}:${maxRaw}" in sheet "${sheetName}"`);
    }
    if (isHidden(attr(col, "hidden"))) {
      intervals.push({ min, max });
    }
  }
  intervals.sort((a, b) => a.min - b.min || a.max - b.max);
  const merged: Array<{ min: number; max: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && interval.min <= previous.max + 1) {
      previous.max = Math.max(previous.max, interval.max);
    } else {
      merged.push({ ...interval });
    }
  }
  const hidden: number[] = [];
  for (const { min, max } of merged) {
    for (let col = min; col <= max; col++) hidden.push(col);
  }
  return hidden;
}

function readUncaptured(ws: XmlNode): Array<{ feature: UncapturedFeatureName; detail: string | null }> {
  const found: Array<{ feature: UncapturedFeatureName; detail: string | null }> = [];
  const merges = firstChild(ws, "mergeCells");
  if (merges !== null) {
    const count = childElements(merges, "mergeCell").length;
    found.push({
      feature: "mergeCells",
      detail: `${String(count)} merged range(s) present; ranges not captured`,
    });
  }
  const links = firstChild(ws, "hyperlinks");
  if (links !== null) {
    found.push({
      feature: "hyperlinks",
      detail: `${String(childElements(links, "hyperlink").length)} hyperlink(s) present; targets not captured`,
    });
  }
  const tables = firstChild(ws, "tableParts");
  if (tables !== null) {
    found.push({
      feature: "tables",
      detail: `${String(childElements(tables, "tablePart").length)} table part(s) present; tables not captured`,
    });
  }
  const ext = firstChild(ws, "extLst");
  if (ext !== null) {
    found.push({ feature: "extensionList", detail: "worksheet extension list present; contents not captured" });
    if (hasDescendantNamed(ext, "dataValidation")) {
      found.push({
        feature: "dataValidationExtensions",
        detail: "data validations carried by the extension list (x14) are not captured",
      });
    }
  }
  if (firstChild(ws, "legacyDrawing") !== null || firstChild(ws, "drawing") !== null) {
    found.push({ feature: "drawings", detail: "drawing reference present; drawings and comments not captured" });
  }
  const conditional = childElements(ws, "conditionalFormatting");
  if (conditional.length > 0) {
    found.push({
      feature: "conditionalFormatting",
      detail: `${String(conditional.length)} conditional formatting block(s) present; rules not captured`,
    });
  }
  const pivots = firstChild(ws, "pivotTableParts");
  if (pivots !== null) {
    found.push({ feature: "pivotTables", detail: "pivot table parts present; pivot tables not captured" });
  }
  return found;
}

export function parseSheetXml(
  sheetName: string,
  xmlText: string,
  sharedStrings: readonly string[],
  sheetId: number,
  budget?: XmlBudget,
): ParsedSheet {
  const ws = documentElement(parseXml(xmlText, budget));
  if (ws === null || ws.name !== "worksheet") {
    throw new SteveCaptureError(`expected a worksheet element in sheet "${sheetName}"`);
  }
  const cells: CellRecord[] = [];
  const seen = new Set<string>();
  const hiddenRows: number[] = [];
  const sheetData = firstChild(ws, "sheetData");
  if (sheetData !== null) {
    let rowFallback = 0;
    for (const rowNode of childElements(sheetData, "row")) {
      rowFallback += 1;
      const rowAttr = attr(rowNode, "r");
      const rowNum = rowAttr === null ? rowFallback : parseRowNumber(rowAttr, sheetName);
      rowFallback = rowNum;
      if (isHidden(attr(rowNode, "hidden"))) hiddenRows.push(rowNum);
      let colFallback = 0;
      for (const cell of childElements(rowNode, "c")) {
        const refAttr = cell.attrs["r"];
        let row = rowNum;
        let col = colFallback + 1;
        if (refAttr !== undefined) {
          const pos = parseA1(refAttr);
          if (pos.row !== rowNum) {
            throw new SteveCaptureError(
              `cell "${refAttr}" outside row ${String(rowNum)} in sheet "${sheetName}"`,
            );
          }
          row = pos.row;
          col = pos.col;
        }
        colFallback = col;
        const key = `${String(row)}:${String(col)}`;
        if (seen.has(key)) {
          throw new SteveCaptureError(
            `duplicate cell at R${String(row)}C${String(col)} in sheet "${sheetName}"`,
          );
        }
        seen.add(key);
        const record = parseCell(sheetName, cell, row, col, sharedStrings, sheetId);
        if (record !== null) cells.push(record);
      }
    }
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  const validations: DataValidationRule[] = [];
  const validationsRoot = firstChild(ws, "dataValidations");
  if (validationsRoot !== null) {
    for (const rule of childElements(validationsRoot, "dataValidation")) {
      const formula1 = firstChild(rule, "formula1");
      const formula2 = firstChild(rule, "formula2");
      validations.push({
        sheet: sheetName,
        sheetId,
        sqref: attr(rule, "sqref"),
        type: attr(rule, "type"),
        formula1: formula1 === null ? null : deepText(formula1),
        formula2: formula2 === null ? null : deepText(formula2),
        attributes: { ...rule.attrs },
      });
    }
  }
  const autoFilter = firstChild(ws, "autoFilter");
  const autoFilterRef = autoFilter === null ? null : attr(autoFilter, "ref");
  return {
    cells,
    validations,
    autoFilter: autoFilterRef === null || autoFilter === null ? null : {
      sheet: sheetName, sheetId, ref: autoFilterRef, definition: autoFilter,
    },
    hiddenRows,
    hiddenColumns: readHiddenColumns(ws, sheetName),
    uncaptured: readUncaptured(ws),
  };
}
