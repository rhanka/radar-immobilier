/**
 * Minimal ZIP reader for `.xlsx` workbooks.
 *
 * Reads the central directory, then extracts stored (method 0) and deflated
 * (method 8, via `node:zlib` inflateRaw) entries. Any structural problem
 * raises an explicit `SteveCaptureError` instead of returning partial data.
 */

import { inflateRawSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import { SteveCaptureError } from "./types.js";

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX_EOCD_COMMENT = 65535;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function findEocd(bytes: Uint8Array): number {
  const dv = view(bytes);
  const start = Math.max(0, bytes.length - (22 + MAX_EOCD_COMMENT));
  for (let i = bytes.length - 22; i >= start; i--) {
    if (dv.getUint32(i, true) === EOCD_SIG && i + 22 + dv.getUint16(i + 20, true) === bytes.length) return i;
  }
  throw new SteveCaptureError(
    "invalid ZIP archive: end-of-central-directory record not found",
  );
}

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 22) {
    throw new SteveCaptureError("invalid ZIP archive: file too small");
  }
  const dv = view(bytes);
  const eocd = findEocd(bytes);
  const count = dv.getUint16(eocd + 10, true);
  const centralSize = dv.getUint32(eocd + 12, true);
  const centralOffset = dv.getUint32(eocd + 16, true);
  if (dv.getUint16(eocd + 4, true) !== 0 || dv.getUint16(eocd + 6, true) !== 0 ||
      dv.getUint16(eocd + 8, true) !== count || count === 0xffff) {
    throw new SteveCaptureError("invalid ZIP archive: multipart and ZIP64 archives are not supported");
  }
  if (centralOffset + centralSize !== eocd) {
    throw new SteveCaptureError("invalid ZIP archive: central directory offset out of range");
  }
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let cursor = centralOffset;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > bytes.length) {
      throw new SteveCaptureError("invalid ZIP archive: truncated central directory");
    }
    if (dv.getUint32(cursor, true) !== CENTRAL_HEADER_SIG) {
      throw new SteveCaptureError("invalid ZIP archive: bad central directory signature");
    }
    const flags = dv.getUint16(cursor + 8, true);
    const method = dv.getUint16(cursor + 10, true);
    const compSize = dv.getUint32(cursor + 20, true);
    const expectedCrc = dv.getUint32(cursor + 16, true);
    const size = dv.getUint32(cursor + 24, true);
    const nameLen = dv.getUint16(cursor + 28, true);
    const extraLen = dv.getUint16(cursor + 30, true);
    const commentLen = dv.getUint16(cursor + 32, true);
    const localOffset = dv.getUint32(cursor + 42, true);
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new SteveCaptureError("invalid ZIP archive: ZIP64 is not supported");
    }
    if ((flags & 0x1) !== 0) {
      throw new SteveCaptureError("invalid ZIP archive: encrypted entries are not supported");
    }
    const nameStart = cursor + 46;
    if (nameStart + nameLen > bytes.length) {
      throw new SteveCaptureError("invalid ZIP archive: truncated entry name");
    }
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLen));
    cursor = nameStart + nameLen + extraLen + commentLen;
    if (cursor > eocd || out.has(name)) {
      throw new SteveCaptureError("invalid ZIP archive: duplicate or truncated directory entry");
    }
    if (name.endsWith("/")) continue;
    if (localOffset + 30 > bytes.length) {
      throw new SteveCaptureError(`invalid ZIP archive: truncated local header for "${name}"`);
    }
    if (dv.getUint32(localOffset, true) !== LOCAL_HEADER_SIG) {
      throw new SteveCaptureError(`invalid ZIP archive: bad local header for "${name}"`);
    }
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > centralOffset) {
      throw new SteveCaptureError(`invalid ZIP archive: truncated entry data for "${name}"`);
    }
    const raw = bytes.slice(dataStart, dataStart + compSize);
    let content = raw;
    if (method === 8) {
      try {
        content = Uint8Array.from(inflateRawSync(raw));
      } catch {
        throw new SteveCaptureError(`invalid ZIP archive: cannot inflate entry "${name}"`);
      }
    } else if (method !== 0) {
      throw new SteveCaptureError(
        `invalid ZIP archive: unsupported compression method ${String(method)} for "${name}"`,
      );
    }
    if (content.length !== size || crc32(content) !== expectedCrc) {
      throw new SteveCaptureError(`invalid ZIP archive: size or CRC mismatch for "${name}"`);
    }
    out.set(name, content);
  }
  if (cursor !== eocd) throw new SteveCaptureError("invalid ZIP archive: inconsistent entry count");
  return out;
}
