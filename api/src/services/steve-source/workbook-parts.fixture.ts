/**
 * Synthetic workbook XML parts for steve-source tests.
 *
 * Every string is a synthetic placeholder with French accents; no real
 * workbook content is embedded.
 */

export const LONG_TEXT = "Texte de synthèse — àâçéèêîôû ".repeat(400);

export const ACCENTED_TEXT = "Désignation — lot nº 1 (façade « Île », l'arpent)";

export const EXPECTED_CODES = ["SYN-ALPHA", "SYN-BÊTA", "SYN-GAMMA"];

const SHARED_STRINGS = [ACCENTED_TEXT, "Motif", ...EXPECTED_CODES];

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sharedStringsXml(): string {
  const items = SHARED_STRINGS.map(
    (text) => `<si><t xml:space="preserve">${esc(text)}</t></si>`,
  ).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sst xmlns="${NS_MAIN}" count="${String(SHARED_STRINGS.length)}" ` +
    `uniqueCount="${String(SHARED_STRINGS.length)}">${items}</sst>`
  );
}

export function lotsSheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><v>7</v></c>` +
    `<c r="E1"><f t="shared" ref="E1:E3" si="0">SUM(B1:B2)</f><v>13.5</v></c></row>` +
    `<row r="2"><c r="B2"><v>6.5</v></c>` +
    `<c r="E2"><f t="shared" si="0"/><v>13.5</v></c></row>` +
    `<row r="3"><c r="E3"><f t="shared" si="0"/><v>13.5</v></c></row>` +
    `<row r="4"><c r="D4" t="inlineStr"><is><t xml:space="preserve">${esc(LONG_TEXT)}</t></is></c></row>` +
    `<row r="5"><c r="F5" t="b"><v>1</v></c></row>` +
    `<row r="6"><c r="G6" t="e"><v>#DIV/0!</v></c></row>` +
    `<row r="7"><c r="C7" t="str"><f>CONCAT("a","b")</f><v>ab</v></c></row>` +
    `</sheetData>` +
    `<dataValidations count="1"><dataValidation type="list" allowBlank="1" ` +
    `showDropDown="1" sqref="A2:A4"><formula1>"Choix A,Choix B"</formula1>` +
    `</dataValidation></dataValidations>` +
    `<autoFilter ref="A1:G10"/></worksheet>`
  );
}

export function codesSheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>1</v></c></row>` +
    `<row r="2"><c r="A2" t="s"><v>2</v></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>3</v></c></row>` +
    `<row r="4"><c r="A4" t="s"><v>4</v></c></row>` +
    `</sheetData></worksheet>`
  );
}

export function archiveSheetXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="${NS_MAIN}"><sheetData>` +
    `<row r="1"><c r="A1"><v>42</v></c></row>` +
    `</sheetData></worksheet>`
  );
}

export function workbookXml(): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
    `<sheet name="Lots" sheetId="1" r:id="rId1"/>` +
    `<sheet name="Codes" sheetId="2" r:id="rId2"/>` +
    `<sheet name="Archive" sheetId="3" r:id="rId3" state="hidden"/>` +
    `</sheets><definedNames>` +
    `<definedName name="LotsList">Lots!$A:$A</definedName>` +
    `</definedNames></workbook>`
  );
}

export function workbookRelsXml(): string {
  const rel = (id: string, sheet: string): string =>
    `<Relationship Id="${id}" Type="${NS_REL}/worksheet" Target="worksheets/${sheet}"/>`;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Relationships xmlns="${NS_PKG}">` +
    `${rel("rId1", "sheet1.xml")}${rel("rId2", "sheet2.xml")}${rel("rId3", "sheet3.xml")}` +
    `<Relationship Id="rId4" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`
  );
}

export function contentTypesXml(): string {
  const type = "application/vnd.openxmlformats-officedocument.spreadsheetml";
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${type}.sheet.main+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${type}.sharedStrings+xml"/>` +
    [1, 2, 3].map((n) => `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="${type}.worksheet+xml"/>`).join("") +
    `</Types>`
  );
}

export function packageRelsXml(): string {
  return `<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" ` +
    `Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}
