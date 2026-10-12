import { canonicalJson, sha256Hex, type CanonicalScope, type DocumentaryAttribution,
  type RevisionBody, type SourceTime } from "@sentropic/comments";
import { snapshotResource } from "./host-ports.js";

/** Source capture metadata owned by immo; canonical content types come from M1. */
export interface SyntheticWorkbookCapture {
  dataClass: "synthetic";
  sourceId: string;
  citySlug: string;
  upstreamRawUtf8?: string;
  coverage: Record<string, "captured" | "proven-absent" | "unavailable">;
  sheets: Array<{
    sheetId: string; title: string; hidden: boolean;
    cells: Array<{ a1: string; row: number; hidden: boolean;
      value: { type: "string" | "number" | "boolean" | "error" | "blank"; lexical: string };
      formula?: string; cachedValue?: { type: string; lexical: string }; note?: string }>;
    contributions: Array<{ id: string; row: number; cells: string[]; body: RevisionBody;
      attribution: DocumentaryAttribution; sourceTime?: SourceTime }>;
  }>;
  attachments: Array<{ sourceId: string; status: "captured" | "absent"; digest?: string }>;
}

const features = ["typed-values", "formulas", "cached-values", "hidden-elements", "notes",
  "comments", "attachments", "other-objects"];

/** Frozen capture only: no network, source mutation, source inference or canonical write. */
export function inventorySyntheticWorkbook(rawUtf8: string, scope: CanonicalScope, expectedSheetIds: readonly string[]) {
  const capture = JSON.parse(rawUtf8) as SyntheticWorkbookCapture;
  if (capture?.dataClass !== "synthetic" || !capture.sourceId || !capture.citySlug ||
      !Array.isArray(capture.sheets) || !Array.isArray(capture.attachments)) {
    throw new Error("An explicitly synthetic complete workbook capture is required");
  }
  const digest = sha256Hex(capture.upstreamRawUtf8 ?? rawUtf8);
  const identity = (kind: string, nativeId: readonly (string | number)[]) => snapshotResource({
    scope, namespace: "immo.sheet", citySlug: capture.citySlug, kind,
    nativeId: canonicalJson(nativeId), sourceVersion: digest,
  });
  const resources = [{ ref: identity("workbook", [capture.sourceId]), sourceVersion: digest,
    frozenDigest: digest, currentDigest: digest, available: true, locator: "workbook" }];
  const issues = features.filter((feature) => !["captured", "proven-absent"].includes(capture.coverage?.[feature] ?? "unavailable"))
    .map((feature) => `coverage-unqualified:${feature}`);
  const sheets = new Set<string>();
  const units = new Set<string>();
  for (const sheet of capture.sheets) {
    if (!sheet.sheetId || sheets.has(sheet.sheetId)) throw new Error("Duplicate or missing native sheet identity");
    sheets.add(sheet.sheetId);
    const rows = new Set<number>();
    const cells = new Set<string>();
    const add = (kind: string, id: readonly (string | number)[], locator: string) => {
      resources.push({ ...resources[0]!, ref: identity(kind, id), locator });
    };
    add("worksheet", [capture.sourceId, sheet.sheetId], `sheet:${sheet.sheetId}`);
    for (const cell of sheet.cells) {
      if (!/^[A-Z]+[1-9]\d*$/.test(cell.a1) || cells.has(cell.a1) ||
          !Number.isSafeInteger(cell.row) || cell.row < 1 || Number(cell.a1.match(/\d+$/)![0]) !== cell.row) {
        throw new Error("Invalid or duplicate version-local cell locator");
      }
      cells.add(cell.a1); rows.add(cell.row);
      add("cell", [capture.sourceId, sheet.sheetId, cell.a1], `sheet:${sheet.sheetId}!${cell.a1}`);
    }
    for (const contribution of sheet.contributions) {
      const unit = canonicalJson([sheet.sheetId, contribution.row, contribution.id]);
      if (!contribution.id || units.has(unit) || !rows.has(contribution.row) || contribution.cells.length === 0 ||
          contribution.cells.some((cell) => !cells.has(cell) || Number(cell.match(/\d+$/)![0]) !== contribution.row)) {
        throw new Error("Contribution identity or source cells are unresolved");
      }
      units.add(unit);
    }
    for (const row of rows) add("row", [capture.sourceId, sheet.sheetId, row], `sheet:${sheet.sheetId}!row:${row}`);
  }
  for (const sheetId of expectedSheetIds) if (!sheets.has(sheetId)) issues.push(`sheet-absent:${sheetId}`);
  for (const attachment of capture.attachments) {
    if (attachment.status === "absent") issues.push(`attachment-absent:${attachment.sourceId}`);
    else if (!/^[0-9a-f]{64}$/.test(attachment.digest ?? "")) throw new Error("Captured attachment requires verified bytes digest");
  }
  return { capture, rawUtf8, digest, captureDigest: sha256Hex(rawUtf8), resources, issues, sourceContributionCount: units.size };
}
