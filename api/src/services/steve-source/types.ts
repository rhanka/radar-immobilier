/**
 * Shared types for the steve-source workbook capture module.
 *
 * The inventory is a deterministic, read-only projection of a workbook's
 * bytes: no network, no database, no timestamps.
 */

export class SteveCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SteveCaptureError";
  }
}

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export type SheetVisibility = "visible" | "hidden" | "veryHidden";

export interface SheetInfo {
  name: string;
  order: number;
  state: SheetVisibility;
}

export type CellType = "s" | "str" | "n" | "b" | "e" | "inlineStr" | "d";

export interface CellFormula {
  text: string;
  kind: string | null;
  ref: string | null;
  si: number | null;
}

export interface CellRecord {
  sheet: string;
  address: string;
  row: number;
  col: number;
  type: CellType;
  raw: string | null;
  value: string | null;
  formula: CellFormula | null;
  cachedValue: string | null;
}

export interface DataValidationRule {
  sheet: string;
  sqref: string | null;
  type: string | null;
  formula1: string | null;
  formula2: string | null;
  attributes: Record<string, string>;
}

export interface DefinedNameRecord {
  name: string;
  value: string;
  attributes: Record<string, string>;
}

export interface AutoFilterRecord {
  sheet: string;
  ref: string;
  definition: XmlNode;
}

export interface WorkbookInventory {
  sha256: string;
  sheets: SheetInfo[];
  cells: CellRecord[];
  sharedStrings: string[];
  dataValidations: DataValidationRule[];
  definedNames: DefinedNameRecord[];
  autoFilters: AutoFilterRecord[];
}
