import type { DocumentaryAttribution, RevisionBody } from "@sentropic/comments";
import type { SyntheticWorkbookCapture } from "./workbook-inventory.js";

interface GoogleCell {
  userEnteredValue?: Record<string, string | number | boolean>;
  effectiveValue?: Record<string, unknown>;
  note?: string;
}
interface GoogleSheet {
  properties: { sheetId: number; title: string; hidden?: boolean };
  data?: Array<{ startRow?: number; startColumn?: number;
    rowMetadata?: Array<{ hiddenByUser?: boolean; hiddenByFilter?: boolean }>;
    columnMetadata?: Array<{ hiddenByUser?: boolean; hiddenByFilter?: boolean }>;
    rowData?: Array<{ values?: GoogleCell[] }> }>;
}
function columnName(index: number): string {
  let result = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
function value(fields: Record<string, unknown> = {}) {
  const type = ["string", "number", "bool", "error"].find((key) => fields[key + "Value"] !== undefined);
  const raw = type ? fields[type + "Value"] : "";
  return { type: (type === "bool" ? "boolean" : type ?? "blank") as "string" | "number" | "boolean" | "error" | "blank",
    lexical: typeof raw === "object" ? JSON.stringify(raw) : String(raw) };
}

/** Google API response reader on explicit fixtures; no HTTP or Drive authority is presumed. */
export function captureSyntheticGoogleWorkbook(rawUtf8: string, options: {
  dataClass: "synthetic"; citySlug: string; codec: RevisionBody["codec"];
  feedbackCells: readonly { sheetId: string; a1: string; attribution: DocumentaryAttribution }[];
}): SyntheticWorkbookCapture {
  if (options.dataClass !== "synthetic") throw new Error("Only synthetic Google workbook responses are allowed");
  const response = JSON.parse(rawUtf8) as { spreadsheetId: string; sheets: GoogleSheet[] };
  if (!response.spreadsheetId || !Array.isArray(response.sheets)) throw new Error("Invalid workbook response");
  const capture: SyntheticWorkbookCapture = { dataClass: "synthetic", sourceId: response.spreadsheetId,
    citySlug: options.citySlug, upstreamRawUtf8: rawUtf8,
    coverage: { "typed-values": "captured", formulas: "captured", "cached-values": "captured",
      "hidden-elements": "captured", notes: "captured", comments: "unavailable",
      attachments: "unavailable", "other-objects": "unavailable" }, sheets: [], attachments: [] };
  for (const sheet of response.sheets) {
    const captured: SyntheticWorkbookCapture["sheets"][number] = { sheetId: String(sheet.properties.sheetId),
      title: sheet.properties.title, hidden: sheet.properties.hidden ?? false, cells: [], contributions: [] };
    for (const grid of sheet.data ?? []) {
      for (const [offset, row] of (grid.rowData ?? []).entries()) {
        const rowNumber = (grid.startRow ?? 0) + offset + 1;
        for (const [column, cell] of (row.values ?? []).entries()) {
          const a1 = columnName((grid.startColumn ?? 0) + column) + rowNumber;
          const cached = value(cell.effectiveValue);
          captured.cells.push({ a1, row: rowNumber,
            hidden: !!(grid.rowMetadata?.[offset]?.hiddenByUser || grid.rowMetadata?.[offset]?.hiddenByFilter ||
              grid.columnMetadata?.[column]?.hiddenByUser || grid.columnMetadata?.[column]?.hiddenByFilter),
            value: value(cell.userEnteredValue), cachedValue: cached,
            ...(typeof cell.userEnteredValue?.formulaValue === "string" ? { formula: cell.userEnteredValue.formulaValue } : {}),
            ...(cell.note !== undefined ? { note: cell.note } : {}) });
          const feedback = options.feedbackCells.find((entry) => entry.sheetId === captured.sheetId && entry.a1 === a1);
          if (feedback) {
            if (cached.type !== "string") throw new Error("A feedback mapping must name an exact source text cell");
            captured.contributions.push({ id: `feedback:${a1}`, row: rowNumber, cells: [a1],
              body: { text: cached.lexical, codec: options.codec }, attribution: feedback.attribution });
          }
        }
      }
    }
    capture.sheets.push(captured);
  }
  for (const feedback of options.feedbackCells) {
    if (!capture.sheets.some((sheet) => sheet.sheetId === feedback.sheetId && sheet.contributions.some((entry) => entry.id === `feedback:${feedback.a1}`))) {
      throw new Error("A mapped feedback cell is missing from the capture");
    }
  }
  return capture;
}
