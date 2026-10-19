/**
 * Synthetic fixtures for d3-report tests.
 *
 * Workbooks are built in memory with `buildSyntheticWorkbook` plus part
 * overrides; every string is synthetic. Graph fixtures are plain synthetic
 * objects with no workbook value.
 */

import { buildSyntheticWorkbook } from "../workbook.fixture.js";
import type { MunicipalityRef } from "./municipality.js";

export interface TriageFixtureRow {
  number?: string;
  city?: string;
  mrc?: string;
  reglement?: string;
  classement?: string;
}

const NS_MAIN =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineCell(ref: string, text: string): string {
  return (
    `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">` +
    `${esc(text)}</t></is></c>`
  );
}

export const TRIAGE_TEST_HEADERS = [
  "#",
  "Ville",
  "MRC / Région",
  "N° règlement",
  "Classement",
] as const;

export function triageSheetXml(
  rows: TriageFixtureRow[],
  headers: readonly string[] = TRIAGE_TEST_HEADERS,
): string {
  const columns = ["A", "B", "C", "D", "E"] as const;
  let xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>`;
  xml += `<row r="1">`;
  headers.forEach((header, index) => {
    const col = columns[index];
    if (col !== undefined) xml += inlineCell(`${col}1`, header);
  });
  xml += `</row>`;
  rows.forEach((row, rowIndex) => {
    const number = String(rowIndex + 2);
    const values = [
      row.number,
      row.city,
      row.mrc,
      row.reglement,
      row.classement,
    ] as const;
    xml += `<row r="${number}">`;
    values.forEach((value, index) => {
      if (value === undefined) return;
      const col = columns[index];
      if (col !== undefined) xml += inlineCell(`${col}${number}`, value);
    });
    xml += `</row>`;
  });
  xml += `</sheetData></worksheet>`;
  return xml;
}

function triageWorkbookXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
    `<sheet name="Triage" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Codes" sheetId="2" r:id="rId2"/>` +
    `<sheet name="Archive" sheetId="3" r:id="rId3"/>` +
    `</sheets></workbook>`
  );
}

export function buildTriageWorkbook(
  rows: TriageFixtureRow[],
  headers: readonly string[] = TRIAGE_TEST_HEADERS,
): Uint8Array {
  return buildSyntheticWorkbook({
    "xl/workbook.xml": triageWorkbookXml(),
    "xl/worksheets/sheet1.xml": triageSheetXml(rows, headers),
  });
}

export function syntheticMunicipalities(): MunicipalityRef[] {
  return [
    { slug: "ville-synth-a", name: "Ville Synth A", mrc: "MRC Synth Nord" },
    { slug: "ville-synth-b", name: "Ville Synth B", mrc: null },
    { slug: "bourg-homonyme-nord", name: "Bourg Homonyme", mrc: "MRC Nord" },
    { slug: "bourg-homonyme-sud", name: "Bourg Homonyme", mrc: "MRC Sud" },
  ];
}
