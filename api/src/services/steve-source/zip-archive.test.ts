import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { SteveCaptureError } from "./types.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
import { buildOverlappingArchive } from "./zip-overlap.fixture.js";
interface CentralEntryView {
  start: number;
  name: string;
  nameStart: number;
  localOffset: number;
}

function centralEntries(bytes: Uint8Array): CentralEntryView[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.length - 22;
  const count = dv.getUint16(eocd + 10, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  const found: CentralEntryView[] = [];
  let cursor = centralOffset;
  for (let n = 0; n < count; n++) {
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const localOffset = dv.getUint32(cursor + 42, true);
    const nameStart = cursor + 46;
    const name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen));
    found.push({ start: cursor, name, nameStart, localOffset });
    cursor = nameStart + nameLen + extraLen + commentLen;
  }
  return found;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("ZIP protection limits", () => {
  it("rejects a declared size above the 64 MiB per-entry limit", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    const centralOffset = dv.getUint32(bytes.length - 22 + 16, true);
    dv.setUint32(centralOffset + 24, 80 * 1024 * 1024, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/per-entry limit/);
  });

  it("rejects a cumulative declared size above the 256 MiB archive limit", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    for (const entry of centralEntries(bytes).slice(0, 7)) {
      dv.setUint32(entry.start + 24, 40 * 1024 * 1024, true);
    }
    expect(() => captureWorkbookInventory(bytes)).toThrow(/cumulative declared size/);
  });

  it("rejects a compressed size above the 50 MiB entry limit", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    const centralOffset = dv.getUint32(bytes.length - 22 + 16, true);
    dv.setUint32(centralOffset + 20, 60 * 1024 * 1024, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/50 MiB entry limit/);
  });

  it("rejects inflated output that exceeds the declared size", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    const target = centralEntries(bytes).find((entry) => entry.name === "xl/worksheets/sheet1.xml");
    if (target === undefined) throw new Error("missing sheet entry");
    dv.setUint32(target.start + 24, 1, true);
    dv.setUint32(target.localOffset + 22, 1, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(SteveCaptureError);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/cannot inflate entry/);
  });

  it("rejects entries whose local record overlaps another entry", () => {
    expect(() => captureWorkbookInventory(buildOverlappingArchive()))
      .toThrow(/overlapping entry data/);
  });

  it("rejects duplicate entry names", () => {
    const bytes = buildSyntheticWorkbook();
    const target = centralEntries(bytes).find((entry) => entry.name === "xl/worksheets/sheet2.xml");
    if (target === undefined) throw new Error("missing sheet entry");
    bytes[target.nameStart + "xl/worksheets/sheet".length] = 0x31;
    expect(() => captureWorkbookInventory(bytes)).toThrow(/duplicate or truncated directory entry/);
  });
});

describe("ZIP header agreement", () => {
  it.each([[6, 0], [8, 8]])("rejects a mismatching local field at %s", (offset, value) => {
    const bytes = buildSyntheticWorkbook();
    dataView(bytes).setUint16(offset, value, true);
    expect(() => captureWorkbookInventory(bytes)).toThrow(/local header does not match/);
  });

  it("rejects a local name that differs from the central name", () => {
    const bytes = buildSyntheticWorkbook();
    bytes[30] = 0x78;
    expect(() => captureWorkbookInventory(bytes)).toThrow(/local header does not match/);
  });

  it("rejects an archive input larger than 50 MiB", () => {
    expect(() => captureWorkbookInventory(new Uint8Array(50 * 1024 * 1024 + 1)))
      .toThrow(/50 MiB archive limit/);
  });
});
