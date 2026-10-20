import { concat, testCrc32, u16le, u32le } from "./zip-records.fixture.js";

/**
 * Archive where the local record of `b.txt` is embedded inside the data of
 * `a.txt`: both central entries are individually consistent, but their byte
 * ranges overlap, which the reader must reject.
 */
export function buildOverlappingArchive(): Uint8Array {
  const encoder = new TextEncoder();
  const bName = encoder.encode("b.txt");
  const bData = encoder.encode("BBDAT");
  const bRecord = concat([
    Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(testCrc32(bData)), u32le(bData.length), u32le(bData.length),
    u16le(bName.length), u16le(0), bName, bData,
  ]);
  const aName = encoder.encode("a.txt");
  const aData = new Uint8Array(100);
  aData.set(bRecord, 40);
  const aRecord = concat([
    Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
    u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(testCrc32(aData)), u32le(aData.length), u32le(aData.length),
    u16le(aName.length), u16le(0), aName, aData,
  ]);
  const bOffset = 30 + aName.length + 40;
  const centralA = concat([
    Uint8Array.from([0x50, 0x4b, 0x01, 0x02]),
    u16le(20), u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(testCrc32(aData)), u32le(aData.length), u32le(aData.length),
    u16le(aName.length), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(0), u32le(0), aName,
  ]);
  const centralB = concat([
    Uint8Array.from([0x50, 0x4b, 0x01, 0x02]),
    u16le(20), u16le(20), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(testCrc32(bData)), u32le(bData.length), u32le(bData.length),
    u16le(bName.length), u16le(0), u16le(0), u16le(0), u16le(0),
    u32le(0), u32le(bOffset), bName,
  ]);
  const centralSize = centralA.length + centralB.length;
  return concat([
    aRecord, centralA, centralB,
    Uint8Array.from([0x50, 0x4b, 0x05, 0x06]),
    u16le(0), u16le(0), u16le(2), u16le(2),
    u32le(centralSize), u32le(aRecord.length), u16le(0),
  ]);
}
