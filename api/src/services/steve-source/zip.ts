/**
 * Minimal ZIP reader for `.xlsx` workbooks.
 *
 * Reads the central directory, then extracts stored (method 0) and deflated
 * (method 8, via `node:zlib` inflateRaw) entries. Any structural problem
 * raises an explicit `SteveCaptureError` instead of returning partial data.
 *
 * Signature constants below are the standard APPNOTE values (`PK\x03\x04`,
 * `PK\x01\x02`, `PK\x05\x06`); the test fixture writes the same bytes as
 * explicit literals without importing these constants.
 */

import { inflateRawSync } from "node:zlib";
import { crc32 } from "./crc32.js";
import { SteveCaptureError } from "./types.js";

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const MAX_EOCD_COMMENT = 65535;
/** Maximum compressed archive input (50 MiB). */
const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;
/** Largest declared uncompressed size accepted for one entry (64 MiB). */
const MAX_ENTRY_SIZE = 64 * 1024 * 1024;
/** Largest cumulative declared size accepted for the archive (256 MiB). */
const MAX_TOTAL_SIZE = 256 * 1024 * 1024;
/** Largest compressed input accepted for one entry (50 MiB). */
const MAX_ENTRY_COMPRESSED_SIZE = 50 * 1024 * 1024;
/** Data-descriptor flag: CRC and sizes follow the compressed payload. */
const FLAG_DATA_DESCRIPTOR = 0x08;

interface CentralEntry {
  flags: number;
  method: number;
  compSize: number;
  expectedCrc: number;
  size: number;
  localOffset: number;
  name: string;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeName(bytes: Uint8Array, what: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SteveCaptureError(`invalid ZIP archive: entry name is not valid UTF-8 for "${what}"`);
  }
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
  if (bytes.length > MAX_ARCHIVE_SIZE) {
    throw new SteveCaptureError("invalid ZIP archive: input exceeds the 50 MiB archive limit");
  }
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
  // First pass: validate the whole central directory (including every declared
  // size) before extracting or inflating anything.
  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  let cursor = centralOffset;
  let totalDeclared = 0;
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
    const name = decodeName(bytes.subarray(nameStart, nameStart + nameLen), `entry #${String(n)}`);
    cursor = nameStart + nameLen + extraLen + commentLen;
    if (cursor > eocd || names.has(name)) {
      throw new SteveCaptureError("invalid ZIP archive: duplicate or truncated directory entry");
    }
    names.add(name);
    if (name.endsWith("/")) continue;
    if (compSize > MAX_ENTRY_COMPRESSED_SIZE) {
      throw new SteveCaptureError(
        `invalid ZIP archive: compressed size of "${name}" exceeds the 50 MiB entry limit`,
      );
    }
    if (size > MAX_ENTRY_SIZE) {
      throw new SteveCaptureError(
        `invalid ZIP archive: declared size of "${name}" exceeds the 64 MiB per-entry limit`,
      );
    }
    totalDeclared += size;
    if (totalDeclared > MAX_TOTAL_SIZE) {
      throw new SteveCaptureError(
        "invalid ZIP archive: cumulative declared size exceeds the 256 MiB archive limit",
      );
    }
    entries.push({ flags, method, compSize, expectedCrc, size, localOffset, name });
  }
  if (cursor !== eocd) throw new SteveCaptureError("invalid ZIP archive: inconsistent entry count");
  // Second pass: extract entries against their local headers.
  const out = new Map<string, Uint8Array>();
  const used: Array<{ start: number; end: number }> = [];
  for (const entry of entries) {
    const { flags, method, compSize, expectedCrc, size, localOffset, name } = entry;
    if (localOffset + 30 > bytes.length) {
      throw new SteveCaptureError(`invalid ZIP archive: truncated local header for "${name}"`);
    }
    if (dv.getUint32(localOffset, true) !== LOCAL_HEADER_SIG) {
      throw new SteveCaptureError(`invalid ZIP archive: bad local header for "${name}"`);
    }
    const localFlags = dv.getUint16(localOffset + 6, true);
    const localMethod = dv.getUint16(localOffset + 8, true);
    const localCrc = dv.getUint32(localOffset + 14, true);
    const localCompSize = dv.getUint32(localOffset + 18, true);
    const localSize = dv.getUint32(localOffset + 22, true);
    const localNameLen = dv.getUint16(localOffset + 26, true);
    const localExtraLen = dv.getUint16(localOffset + 28, true);
    if (localOffset + 30 + localNameLen + localExtraLen > bytes.length) {
      throw new SteveCaptureError(`invalid ZIP archive: truncated local header for "${name}"`);
    }
    const localName = decodeName(
      bytes.subarray(localOffset + 30, localOffset + 30 + localNameLen),
      name,
    );
    if (localName !== name || localMethod !== method || localFlags !== flags) {
      throw new SteveCaptureError(
        `invalid ZIP archive: local header does not match central entry for "${name}"`,
      );
    }
    const hasDescriptor = (flags & FLAG_DATA_DESCRIPTOR) !== 0;
    const matches = (local: number, central: number): boolean =>
      local === central || (hasDescriptor && local === 0);
    if (!matches(localCrc, expectedCrc) || !matches(localCompSize, compSize) || !matches(localSize, size)) {
      throw new SteveCaptureError(
        `invalid ZIP archive: local sizes do not match central entry for "${name}"`,
      );
    }
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > centralOffset) {
      throw new SteveCaptureError(`invalid ZIP archive: truncated entry data for "${name}"`);
    }
    let dataEnd = dataStart + compSize;
    if (hasDescriptor) {
      if (dataEnd + 12 > centralOffset) {
        throw new SteveCaptureError(`invalid ZIP archive: truncated data descriptor for "${name}"`);
      }
      const descriptor = dataEnd + (dv.getUint32(dataEnd, true) === 0x08074b50 ? 4 : 0);
      if (descriptor + 12 > centralOffset || dv.getUint32(descriptor, true) !== expectedCrc ||
          dv.getUint32(descriptor + 4, true) !== compSize || dv.getUint32(descriptor + 8, true) !== size) {
        throw new SteveCaptureError(`invalid ZIP archive: data descriptor mismatch for "${name}"`);
      }
      dataEnd = descriptor + 12;
    }
    const span = { start: localOffset, end: dataEnd };
    for (const other of used) {
      if (span.start < other.end && other.start < span.end) {
        throw new SteveCaptureError(
          `invalid ZIP archive: overlapping entry data for "${name}"`,
        );
      }
    }
    used.push(span);
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    let content: Uint8Array = raw;
    if (method === 8) {
      try {
        content = inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
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
  return out;
}
