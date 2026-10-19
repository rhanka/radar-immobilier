import { describe, expect, it } from "vitest";
import { captureWorkbookInventory } from "./inventory.js";
import { buildSyntheticWorkbook } from "./workbook.fixture.js";

function descriptorWorkbook(signed: boolean, corrupt = false, missing = false): Uint8Array {
  const source = buildSyntheticWorkbook();
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const end = source.length - 22;
  let cursor = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const length = 46 + view.getUint16(cursor + 28, true) +
      view.getUint16(cursor + 30, true) + view.getUint16(cursor + 32, true);
    const central = Buffer.from(source.subarray(cursor, cursor + length));
    const localOffset = view.getUint32(cursor + 42, true);
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) +
      view.getUint16(localOffset + 28, true);
    const compressed = view.getUint32(cursor + 20, true);
    const local = Buffer.from(source.subarray(localOffset, dataStart + compressed));
    central.writeUInt32LE(offset, 42);
    locals.push(local);
    offset += local.length;
    if (index === 0) {
      central.writeUInt16LE(central.readUInt16LE(8) | 8, 8);
      local.writeUInt16LE(local.readUInt16LE(6) | 8, 6);
      local.fill(0, 14, 26);
      if (!missing) {
        const descriptor = Buffer.alloc(signed ? 16 : 12);
        const at = signed ? 4 : 0;
        if (signed) descriptor.writeUInt32LE(0x08074b50, 0);
        descriptor.writeUInt32LE(corrupt ? 0 : central.readUInt32LE(16), at);
        descriptor.writeUInt32LE(compressed, at + 4);
        descriptor.writeUInt32LE(central.readUInt32LE(24), at + 8);
        locals.push(descriptor);
        offset += descriptor.length;
      }
    }
    directory.push(central);
    cursor += length;
  }
  const eocd = Buffer.from(source.subarray(end));
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...directory, eocd]);
}

describe("ZIP data descriptors", () => {
  it.each([true, false])("reads a valid descriptor (signature=%s)", (signed) => {
    const inventory = captureWorkbookInventory(descriptorWorkbook(signed));
    expect(inventory.cells).toHaveLength(15);
  });

  it("rejects a descriptor with a mismatching CRC", () => {
    expect(() => captureWorkbookInventory(descriptorWorkbook(true, true)))
      .toThrow(/data descriptor mismatch/);
  });

  it("rejects a missing descriptor", () => {
    expect(() => captureWorkbookInventory(descriptorWorkbook(false, false, true)))
      .toThrow(/data descriptor mismatch/);
  });
});
