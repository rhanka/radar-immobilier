import { concat, testCrc32, u16le, u32le } from "./zip-records.fixture.js";

/** Synthetic stored entries; central order deliberately opposes physical order. */
export function buildManyEntryArchive(count: number): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const name = encoder.encode(`m${String(index)}`);
    const data = Uint8Array.of(index % 256);
    const local = concat([
      Uint8Array.from([0x50, 0x4b, 0x03, 0x04]),
      u16le(20), u16le(0x0800), u16le(0), u16le(0), u16le(0),
      u32le(testCrc32(data)), u32le(data.length), u32le(data.length),
      u16le(name.length), u16le(0), name, data,
    ]);
    locals.push(local);
    centrals.push(concat([
      Uint8Array.from([0x50, 0x4b, 0x01, 0x02]),
      u16le(20), u16le(20), u16le(0x0800), u16le(0), u16le(0), u16le(0),
      u32le(testCrc32(data)), u32le(data.length), u32le(data.length),
      u16le(name.length), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(0), u32le(offset), name,
    ]));
    offset += local.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  return concat([
    ...locals, ...centrals.reverse(),
    Uint8Array.from([0x50, 0x4b, 0x05, 0x06]),
    u16le(0), u16le(0), u16le(count), u16le(count),
    u32le(centralSize), u32le(offset), u16le(0),
  ]);
}
