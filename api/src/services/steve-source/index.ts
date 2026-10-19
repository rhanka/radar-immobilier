/**
 * steve-source entry point — faithful, read-only workbook capture.
 */

export { captureWorkbookInventory } from "./inventory.js";
export { readPatternCodes } from "./pattern-codes.js";
export type { PatternCodeLookup } from "./pattern-codes.js";
export { SteveCaptureError } from "./types.js";
export type {
  AutoFilterRecord,
  CellFormula,
  CellRecord,
  CellType,
  DataValidationRule,
  DefinedNameRecord,
  HiddenColumnRecord,
  HiddenRowRecord,
  SheetInfo,
  SheetVisibility,
  UncapturedFeature,
  UncapturedFeatureName,
  WorkbookInventory,
  XmlNode,
} from "./types.js";
export { MAX_XML_DEPTH } from "./xml.js";
