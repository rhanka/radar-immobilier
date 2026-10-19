/**
 * Workbook inventory: deterministic capture of a `.xlsx` byte buffer.
 *
 * Output is stable by construction: sheets follow workbook order, cells are
 * sorted by row then column, and no timestamp or random value is introduced.
 */

import { createHash } from "node:crypto";
import { posix } from "node:path";
import { parseStrictInt } from "./cell-parse.js";
import { parseSheetXml } from "./sheet-parse.js";
import { SteveCaptureError } from "./types.js";
import type {
  DefinedNameRecord,
  SheetInfo,
  SheetVisibility,
  WorkbookInventory,
} from "./types.js";
import type { XmlNode } from "./xml.js";
import { parseXml } from "./xml.js";
import { childElements, deepText, documentElement, firstChild, spreadsheetText } from "./xml-query.js";
import { unzip } from "./zip.js";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function sheetState(raw: string | null, sheetName: string): SheetVisibility {
  if (raw === null || raw === "visible") return "visible";
  if (raw === "hidden") return "hidden";
  if (raw === "veryHidden") return "veryHidden";
  throw new SteveCaptureError(`unsupported sheet state "${raw}" on sheet "${sheetName}"`);
}

function decodeUtf8(bytes: Uint8Array, part: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SteveCaptureError(`invalid UTF-8 in part "${part}"`);
  }
}

function readRelationships(files: Map<string, Uint8Array>): Map<string, string> {
  const rels = new Map<string, string>();
  const relsFile = files.get("xl/_rels/workbook.xml.rels");
  if (relsFile === undefined) return rels;
  const root = documentElement(parseXml(decodeUtf8(relsFile, "xl/_rels/workbook.xml.rels")));
  if (root === null) return rels;
  for (const rel of childElements(root, "Relationship")) {
    const id = rel.attrs["Id"];
    const target = rel.attrs["Target"];
    if (id !== undefined && target !== undefined) rels.set(id, target);
  }
  return rels;
}

/** Resolve the relationship namespace in the sheet element's scope. */
function sheetRelationshipId(ancestors: readonly XmlNode[], node: XmlNode, sheetName: string): string {
  const namespaces = new Map<string, string>();
  for (const ancestor of [...ancestors, node]) {
    for (const [key, value] of Object.entries(ancestor.attrs)) {
      if (key.startsWith("xmlns:")) namespaces.set(key.slice(6), value);
    }
  }
  for (const [key, value] of Object.entries(node.attrs)) {
    const separator = key.indexOf(":");
    if (separator > 0 && key.slice(separator + 1) === "id" &&
        namespaces.get(key.slice(0, separator)) === REL_NS) return value;
  }
  throw new SteveCaptureError(`sheet "${sheetName}" has no relationship id`);
}

function readSharedStrings(files: Map<string, Uint8Array>): string[] {
  const file = files.get("xl/sharedStrings.xml");
  if (file === undefined) return [];
  const root = documentElement(parseXml(decodeUtf8(file, "xl/sharedStrings.xml")));
  if (root === null || root.name !== "sst") {
    throw new SteveCaptureError('expected a shared strings element in "xl/sharedStrings.xml"');
  }
  return childElements(root, "si").map((si) => spreadsheetText(si));
}

function readDefinedNames(workbook: NonNullable<ReturnType<typeof documentElement>>): DefinedNameRecord[] {
  const holder = firstChild(workbook, "definedNames");
  if (holder === null) return [];
  return childElements(holder, "definedName").map((node) => ({
    name: node.attrs["name"] ?? "",
    value: deepText(node),
    attributes: { ...node.attrs },
  }));
}

function parseSheetId(raw: string | null, sheetName: string): number {
  if (raw === null) {
    throw new SteveCaptureError(`sheet "${sheetName}" has no sheet id`);
  }
  const sheetId = parseStrictInt(raw, `sheet id of sheet "${sheetName}"`);
  if (sheetId < 1) {
    throw new SteveCaptureError(`invalid sheet id "${raw}" on sheet "${sheetName}"`);
  }
  return sheetId;
}

export function captureWorkbookInventory(input: Uint8Array): WorkbookInventory {
  const sha256 = createHash("sha256").update(input).digest("hex");
  const files = unzip(input);
  const workbookFile = files.get("xl/workbook.xml");
  if (workbookFile === undefined) {
    throw new SteveCaptureError('missing required part "xl/workbook.xml"');
  }
  const workbook = documentElement(parseXml(decodeUtf8(workbookFile, "xl/workbook.xml")));
  if (workbook === null || workbook.name !== "workbook") {
    throw new SteveCaptureError('expected a "workbook" root element in "xl/workbook.xml"');
  }
  const sheetsHolder = firstChild(workbook, "sheets");
  if (sheetsHolder === null) {
    throw new SteveCaptureError('missing "sheets" element in "xl/workbook.xml"');
  }
  const rels = readRelationships(files);
  const sharedStrings = readSharedStrings(files);
  const sheets: SheetInfo[] = [];
  const inventory: WorkbookInventory = {
    sha256,
    sheets,
    cells: [],
    sharedStrings,
    dataValidations: [],
    definedNames: readDefinedNames(workbook),
    autoFilters: [],
  };
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  const seenParts = new Set<string>();
  const sheetNodes = childElements(sheetsHolder, "sheet");
  sheetNodes.forEach((node, index) => {
    const name = node.attrs["name"];
    if (name === undefined) throw new SteveCaptureError(`sheet #${String(index)} has no name`);
    const lowered = name.toLowerCase();
    if (seenNames.has(lowered)) {
      throw new SteveCaptureError(`duplicate sheet name "${name}"`);
    }
    seenNames.add(lowered);
    const sheetId = parseSheetId(node.attrs["sheetId"] ?? null, name);
    if (seenIds.has(sheetId)) {
      throw new SteveCaptureError(`duplicate sheet id ${String(sheetId)} on sheet "${name}"`);
    }
    seenIds.add(sheetId);
    const rid = sheetRelationshipId([workbook, sheetsHolder], node, name);
    const target = rels.get(rid);
    if (target === undefined) {
      throw new SteveCaptureError(`sheet "${name}" points to unknown relationship "${rid}"`);
    }
    const path = posix.resolve("/xl", target).slice(1);
    if (seenParts.has(path)) {
      throw new SteveCaptureError(`duplicate sheet part "${path}" on sheet "${name}"`);
    }
    seenParts.add(path);
    const part = files.get(path);
    if (part === undefined) {
      throw new SteveCaptureError(`sheet "${name}" part "${path}" is missing`);
    }
    sheets.push({ name, order: index, state: sheetState(node.attrs["state"] ?? null, name), sheetId, relationshipId: rid, part: path });
    const parsed = parseSheetXml(name, decodeUtf8(part, path), sharedStrings, sheetId);
    for (const cell of parsed.cells) inventory.cells.push(cell);
    for (const rule of parsed.validations) inventory.dataValidations.push(rule);
    if (parsed.autoFilter !== null) inventory.autoFilters.push(parsed.autoFilter);
  });
  return inventory;
}
