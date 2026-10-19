/**
 * In-memory `.xlsx` ZIP assembler for steve-source tests.
 * Entries are deflated with `node:zlib` deflateRaw, except one stored entry.
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

export function buildSyntheticWorkbook(overrides: Record<string, string> = {}): Uint8Array {
  const encoder = new TextEncoder();
  const inputs: Array<{ name: string; content: string; compress: boolean }> = [
    { name: "[Content_Types].xml", content: contentTypesXml(), compress: false },
    { name: "_rels/.rels", content: packageRelsXml(), compress: true },
    { name: "xl/workbook.xml", content: workbookXml(), compress: true },
    { name: "xl/_rels/workbook.xml.rels", content: workbookRelsXml(), compress: true },
    { name: "xl/sharedStrings.xml", content: sharedStringsXml(), compress: true },
    { name: "xl/worksheets/sheet1.xml", content: lotsSheetXml(), compress: true },
    { name: "xl/worksheets/sheet2.xml", content: codesSheetXml(), compress: true },
    { name: "xl/worksheets/sheet3.xml", content: archiveSheetXml(), compress: true },
  ];
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let total = 0;
  let offset = 0;
  const push = (part: Uint8Array): void => {
    chunks.push(part);
    total += part.length;
  };
  const parts: ZipPart[] = inputs.map((input) => {
    const raw = encoder.encode(overrides[input.name] ?? input.content);
    const data = input.compress ? Uint8Array.from(deflateRawSync(raw)) : raw;
    const nameBytes = encoder.encode(input.name);
    const part: ZipPart = {
      name: input.name,
      raw,
      data,
      method: input.compress ? 8 : 0,
      crc: crc32(raw),
      offset,
    };
    push(u32(0x04034b50));
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
      u32(0x02014b50),
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
  push(u32(0x06050b50));
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
