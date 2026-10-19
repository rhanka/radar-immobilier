import { describe, expect, it } from "vitest";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";
function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe("ZIP specification signatures", () => {
  it("writes the PK\\x05\\x06 end-of-central-directory bytes", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    const eocd = bytes.length - 22;
    expect([bytes[eocd], bytes[eocd + 1], bytes[eocd + 2], bytes[eocd + 3]])
      .toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
  });

  it("writes the PK\\x03\\x04 local and PK\\x01\\x02 central bytes", () => {
    const bytes = buildSyntheticWorkbook();
    const dv = dataView(bytes);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const centralOffset = dv.getUint32(bytes.length - 22 + 16, true);
    expect(dv.getUint32(centralOffset, true)).toBe(0x02014b50);
  });


});
