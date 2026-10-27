/**
 * Workbook inventory: deterministic capture of a `.xlsx` byte buffer.
 *
 * Output is stable by construction: sheets follow workbook order, cells are
 * sorted by row then column, and no timestamp or random value is introduced.
 *
 * Part locations are resolved through the package and workbook relationships
 * (`_rels/.rels`, `xl/_rels/workbook.xml.rels`), never hard-coded, and sheet
 * identity comes from `sheetId` plus the relationship target — never from a
 * label or a position.
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
  UncapturedFeature,
  WorkbookInventory,
} from "./types.js";
import { parseXml } from "./xml.js";
import type { XmlNode } from "./xml.js";
import { childElements, deepText, documentElement, firstChild, spreadsheetText } from "./xml-query.js";
import { localName } from "./xml-token.js";
import { unzip } from "./zip.js";
import { createXmlBudget } from "./xml-budget.js";
import type { XmlBudget } from "./xml-budget.js";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const OFFICE_DOCUMENT_TYPE = `${REL_NS}/officeDocument`;
const WORKSHEET_TYPE = `${REL_NS}/worksheet`;
const SHARED_STRINGS_TYPE = `${REL_NS}/sharedStrings`;

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

/** Read an attribute by local name, whatever prefix the writer used. */
function attrLocal(node: XmlNode, local: string): string | null {
  for (const [key, value] of Object.entries(node.attrs)) {
    if (localName(key) === local) return value;
  }
  return null;
}

interface PackageRel {
  id: string;
  target: string;
  type: string;
}

function readRels(bytes: Uint8Array, part: string, budget: XmlBudget): PackageRel[] {
  const root = documentElement(parseXml(decodeUtf8(bytes, part), budget));
  if (root === null || root.name !== "Relationships") {
    throw new SteveCaptureError(`expected a Relationships element in "${part}"`);
  }
  return childElements(root, "Relationship").map((rel) => ({
    id: attrLocal(rel, "Id") ?? "",
    target: attrLocal(rel, "Target") ?? "",
    type: attrLocal(rel, "Type") ?? "",
  }));
}

function resolvePart(baseDirAbs: string, target: string, what: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    throw new SteveCaptureError(`external relationship target "${target}" for ${what} is not supported`);
  }
  const resolved = posix.resolve(baseDirAbs, target).slice(1);
  if (resolved === "") {
    throw new SteveCaptureError(`invalid relationship target "${target}" for ${what}`);
  }
  return resolved;
}

function inheritedNamespaces(ancestors: readonly XmlNode[]): Map<string, string> {
  const namespaces = new Map<string, string>();
  for (const ancestor of ancestors) {
    for (const [key, value] of Object.entries(ancestor.attrs)) {
      if (key.startsWith("xmlns:")) namespaces.set(key.slice(6), value);
    }
  }
  return namespaces;
}

/** Local declarations shadow the inherited bindings without copying their table. */
function sheetRelationshipId(namespaces: ReadonlyMap<string, string>, node: XmlNode, sheetName: string): string {
  for (const [key, value] of Object.entries(node.attrs)) {
    const separator = key.indexOf(":");
    const prefix = key.slice(0, separator);
    const namespace = node.attrs[`xmlns:${prefix}`] ?? namespaces.get(prefix);
    if (separator > 0 && key.slice(separator + 1) === "id" &&
        namespace === REL_NS) return value;
  }
  throw new SteveCaptureError(`sheet "${sheetName}" has no relationship id`);
}

function readSharedStrings(files: Map<string, Uint8Array>, path: string, budget: XmlBudget): string[] {
  const file = files.get(path);
  if (file === undefined) return [];
  const root = documentElement(parseXml(decodeUtf8(file, path), budget));
  if (root === null || root.name !== "sst") {
    throw new SteveCaptureError(`expected a shared strings element in "${path}"`);
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

function workbookLevelUncaptured(parts: string[]): UncapturedFeature[] {
  const found: UncapturedFeature[] = [];
  const none = (feature: UncapturedFeature["feature"], detail: string): void => {
    found.push({ sheet: null, sheetId: null, feature, detail });
  };
  if (parts.some((part) => part === "xl/styles.xml" || part.endsWith("/styles.xml"))) {
    none(
      "styleDefinitions",
      "styles part present; per-cell style indexes are captured, definitions are not",
    );
  }
  if (parts.some((part) => part.startsWith("xl/comments"))) {
    none("comments", "comment parts present; comments are not captured");
  }
  if (parts.some((part) => part.startsWith("xl/drawings/"))) {
    none("drawings", "drawing parts present; drawings are not captured");
  }
  if (parts.some((part) => part.startsWith("xl/tables/"))) {
    none("tables", "table parts present; tables are not captured");
  }
  return found;
}

export function captureWorkbookInventory(input: Uint8Array): WorkbookInventory {
  const budget = createXmlBudget();
  const sha256 = createHash("sha256").update(input).digest("hex");
  const files = unzip(input);
  const packageRelsFile = files.get("_rels/.rels");
  const packageRels = packageRelsFile === undefined ? [] : readRels(packageRelsFile, "_rels/.rels", budget);
  const officeDoc = packageRels.find((rel) => rel.type === OFFICE_DOCUMENT_TYPE);
  const workbookPath = officeDoc === undefined
    ? "xl/workbook.xml"
    : resolvePart("/", officeDoc.target, "the workbook");
  const workbookFile = files.get(workbookPath);
  if (workbookFile === undefined) {
    throw new SteveCaptureError(`missing required part "${workbookPath}"`);
  }
  const workbook = documentElement(parseXml(decodeUtf8(workbookFile, workbookPath), budget));
  if (workbook === null || workbook.name !== "workbook") {
    throw new SteveCaptureError(`expected a "workbook" root element in "${workbookPath}"`);
  }
  const sheetsHolder = firstChild(workbook, "sheets");
  if (sheetsHolder === null) {
    throw new SteveCaptureError(`missing "sheets" element in "${workbookPath}"`);
  }
  const workbookDir = posix.dirname(`/${workbookPath}`);
  const relsPath = posix.resolve(workbookDir, "_rels", `${posix.basename(workbookPath)}.rels`).slice(1);
  const relsFile = files.get(relsPath);
  const rels = relsFile === undefined ? [] : readRels(relsFile, relsPath, budget);
  const relsById = new Map(rels.map((rel) => [rel.id, rel]));
  const sharedStringsRel = rels.find((rel) => rel.type === SHARED_STRINGS_TYPE);
  const sharedStringsPath = sharedStringsRel === undefined
    ? posix.resolve(workbookDir, "sharedStrings.xml").slice(1)
    : resolvePart(workbookDir, sharedStringsRel.target, "shared strings");
  const sharedStrings = readSharedStrings(files, sharedStringsPath, budget);
  const sheets: SheetInfo[] = [];
  const inventory: WorkbookInventory = {
    sha256,
    sheets,
    cells: [],
    sharedStrings,
    dataValidations: [],
    definedNames: readDefinedNames(workbook),
    autoFilters: [],
    parts: [...files.keys()].sort(),
    hiddenRows: [],
    hiddenColumns: [],
    uncaptured: [],
  };
  const seenNames = new Set<string>();
  const seenIds = new Set<number>();
  const seenParts = new Set<string>();
  const sheetNodes = childElements(sheetsHolder, "sheet");
  const namespaces = inheritedNamespaces([workbook, sheetsHolder]);
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
    const rid = sheetRelationshipId(namespaces, node, name);
    const rel = relsById.get(rid);
    if (rel === undefined) {
      throw new SteveCaptureError(`sheet "${name}" points to unknown relationship "${rid}"`);
    }
    if (rel.type !== "" && rel.type !== WORKSHEET_TYPE) {
      throw new SteveCaptureError(`sheet "${name}" points to relationship "${rid}" of type "${rel.type}"`);
    }
    const path = resolvePart(workbookDir, rel.target, `sheet "${name}"`);
    if (seenParts.has(path)) {
      throw new SteveCaptureError(`duplicate sheet part "${path}" on sheet "${name}"`);
    }
    seenParts.add(path);
    const part = files.get(path);
    if (part === undefined) {
      throw new SteveCaptureError(`sheet "${name}" part "${path}" is missing`);
    }
    sheets.push({ name, order: index, state: sheetState(node.attrs["state"] ?? null, name), sheetId, relationshipId: rid, part: path });
    const parsed = parseSheetXml(name, decodeUtf8(part, path), sharedStrings, sheetId, budget);
    for (const cell of parsed.cells) inventory.cells.push(cell);
    for (const rule of parsed.validations) inventory.dataValidations.push(rule);
    if (parsed.autoFilter !== null) inventory.autoFilters.push(parsed.autoFilter);
    for (const row of parsed.hiddenRows) {
      inventory.hiddenRows.push({ sheet: name, sheetId, row });
    }
    for (const range of parsed.hiddenColumns) {
      inventory.hiddenColumns.push({ sheet: name, sheetId, min: range.min, max: range.max });
    }
    for (const item of parsed.uncaptured) {
      inventory.uncaptured.push({ sheet: name, sheetId, feature: item.feature, detail: item.detail });
    }
  });
  for (const item of workbookLevelUncaptured(inventory.parts)) inventory.uncaptured.push(item);
  return inventory;
}
