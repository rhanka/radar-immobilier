/**
 * In-memory `.xlsx` ZIP assembler for steve-source tests.
 * Entries are deflated with `node:zlib` deflateRaw, except stored entries.
 *
 * ZIP record signatures below are written as the explicit little-endian byte
 * sequences from the APPNOTE specification (`PK\x03\x04`, `PK\x01\x02`,
 * `PK\x05\x06`). They intentionally duplicate the specification bytes instead
 * of importing the reader's constants, so a wrong reader signature cannot be
 * masked by the fixture.
 */

import { deflateRawSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import {
  archiveSheetXml,
  codesSheetXml,
  contentTypesXml,
  lotsSheetXml,
  packageRelsXml,
  sharedStringsXml,
  workbookRelsXml,
  workbookXml,
} from "./workbook-parts.js";

export { ACCENTED_TEXT, EXPECTED_CODES, LONG_TEXT } from "./workbook-parts.js";

/** Local file header signature `PK\x03\x04`, as literal specification bytes. */
const LOCAL_HEADER_BYTES = [0x50, 0x4b, 0x03, 0x04];
/** Central directory header signature `PK\x01\x02`, as literal bytes. */
const CENTRAL_HEADER_BYTES = [0x50, 0x4b, 0x01, 0x02];
/** End-of-central-directory signature `PK\x05\x06`, as literal bytes. */
const EOCD_BYTES = [0x50, 0x4b, 0x05, 0x06];

function u16(value: number): Uint8Array {
  const dv = new DataView(new ArrayBuffer(2));
  dv.setUint16(0, value, true);
  return new Uint8Array(dv.buffer);
}

function u32(value: number): Uint8Array {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setUint32(0, value >>> 0, true);
  return new Uint8Array(dv.buffer);
}

interface ZipPart {
  name: string;
  raw: Uint8Array;
  data: Uint8Array;
  method: number;
  crc: number;
  offset: number;
}

export function buildSyntheticWorkbook(
  overrides: Record<string, string> = {},
  extra: Record<string, string> = {},
  stored: readonly string[] = [],
): Uint8Array {
  const encoder = new TextEncoder();
  const storedNames = new Set(stored);
  const baseInputs: Array<{ name: string; content: string; compress: boolean }> = [
    { name: "[Content_Types].xml", content: contentTypesXml(), compress: false },
    { name: "_rels/.rels", content: packageRelsXml(), compress: true },
    { name: "xl/workbook.xml", content: workbookXml(), compress: true },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(), compress: true },
    { name: "xl/sharedStrings.xml", content: sharedStringsXml(), compress: true },
    { name: "xl/worksheets/sheet1.xml", content: lotsSheetXml(), compress: true },
    { name: "xl/worksheets/sheet2.xml", content: codesSheetXml(), compress: true },
    { name: "xl/worksheets/sheet3.xml", content: archiveSheetXml(), compress: true },
  ];
  const inputs = [
    ...baseInputs,
    ...Object.entries(extra).map(([name, content]) => ({ name, content, compress: true })),
  ];
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let total = 0;
  let offset = 0;
  const push = (part: Uint8Array): void => {
    chunks.push(part);
    total += part.length;
  };
  const pushBytes = (values: number[]): void => {
    push(Uint8Array.from(values));
  };
  const parts: ZipPart[] = inputs.map((input) => {
    const raw = encoder.encode(overrides[input.name] ?? input.content);
    const compress = input.compress && !storedNames.has(input.name);
    const data = compress ? Uint8Array.from(deflateRawSync(raw)) : raw;
    const nameBytes = encoder.encode(input.name);
    const part: ZipPart = {
      name: input.name,
      raw,
      data,
      method: compress ? 8 : 0,
      crc: crc32(raw),
      offset,
    };
    pushBytes(LOCAL_HEADER_BYTES);
    push(u16(20));
    push(u16(0x0800));
    push(u16(part.method));
    push(u16(0));
    push(u16(0));
    push(u32(part.crc));
    push(u32(data.length));
    push(u32(raw.length));
    push(u16(nameBytes.length));
    push(u16(0));
    push(nameBytes);
    push(data);
    offset = total;
    return part;
  });
  let centralSize = 0;
  for (const part of parts) {
    const nameBytes = encoder.encode(part.name);
    const entries: Uint8Array[] = [
      Uint8Array.from(CENTRAL_HEADER_BYTES),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(part.method),
      u16(0),
      u16(0),
      u32(part.crc),
      u32(part.data.length),
      u32(part.raw.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(part.offset),
      nameBytes,
    ];
    for (const entry of entries) {
      central.push(entry);
      centralSize += entry.length;
    }
  }
  const centralOffset = total;
  for (const entry of central) push(entry);
  pushBytes(EOCD_BYTES);
  push(u16(0));
  push(u16(0));
  push(u16(parts.length));
  push(u16(parts.length));
  push(u32(centralSize));
  push(u32(centralOffset));
  push(u16(0));
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
