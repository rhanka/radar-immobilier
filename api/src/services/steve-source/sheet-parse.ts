/**
 * Worksheet part parser: row/cell assembly, validations, autofilter.
 * Cell details live in `cell-parse.ts`.
 */

import { parseCell, parseRowNumber } from "./cell-parse.js";
import { parseA1 } from "./cell-ref.js";
import { SteveCaptureError } from "./types.js";
import type {
  AutoFilterRecord,
  CellRecord,
  DataValidationRule,
} from "./types.js";
import { parseXml } from "./xml.js";
import type { XmlNode } from "./xml.js";
import { childElements, deepText, documentElement, firstChild } from "./xml-query.js";

export interface ParsedSheet {
  cells: CellRecord[];
  validations: DataValidationRule[];
  autoFilter: AutoFilterRecord | null;
}

function attr(node: XmlNode, name: string): string | null {
  const value = node.attrs[name];
  return value === undefined ? null : value;
}

export function parseSheetXml(
  sheetName: string,
  xmlText: string,
  sharedStrings: readonly string[],
  sheetId: number,
): ParsedSheet {
  const ws = documentElement(parseXml(xmlText));
  if (ws === null || ws.name !== "worksheet") {
    throw new SteveCaptureError(`expected a worksheet element in sheet "${sheetName}"`);
  }
  const cells: CellRecord[] = [];
  const seen = new Set<string>();
  const sheetData = firstChild(ws, "sheetData");
  if (sheetData !== null) {
    let rowFallback = 0;
    for (const rowNode of childElements(sheetData, "row")) {
      rowFallback += 1;
      const rowAttr = attr(rowNode, "r");
      const rowNum = rowAttr === null ? rowFallback : parseRowNumber(rowAttr, sheetName);
      rowFallback = rowNum;
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
      sheet: sheetName, ref: autoFilterRef, definition: autoFilter,
    },
  };
}
