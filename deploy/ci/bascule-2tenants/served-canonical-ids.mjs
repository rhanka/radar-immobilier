// =============================================================================
// served-canonical-ids.mjs — the JOIN-VERIFY byte-identity core.
//
// Builds the immo side of the served canonical_id set by CONSUMING
// @sentropic/geo `buildServedCanonicalIds` (it re-canonicalizes RAW `code_zone` /
// `no_lot` via `canonicalizeZoneCodeForJoin` / `canonicalizeNoLotForJoin`
// internally — dossier §9(a): byte-identical to geo's served set BY CONSTRUCTION,
// not by measurement). This module DOES NOT re-implement id construction; it
// takes the geo module (dependency-injected via geo-loader.loadGeo) plus RAW refs.
//
// The orchestrator downloads the two per-leg served-ids artefacts and compares
// them OCTET-À-OCTET (coordinator 2026-09-25, point 3): status = match | drift.
// =============================================================================
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

/**
 * @typedef {{ citySlug: string, noLot: unknown }} RawLotRef
 * @typedef {{ citySlug: string, zoneCode: unknown }} RawZoneRef
 * @typedef {{ lots?: Iterable<RawLotRef>, zones?: Iterable<RawZoneRef> }} RawRefs
 */

// SHA-256 over the EXACT serialized bytes (the value hashed into geo.json
// s3_servi.sha256 and used to seal each leg's served-ids artefact).
export function sha256Hex(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/**
 * Build the immo served canonical_id set from RAW refs, using the injected geo
 * module. Returns the sorted id list, the canonical serialization (byte-sorted,
 * newline-terminated) and its sha256 — the exact artefact payload immo publishes.
 * @param {{ buildServedCanonicalIds: Function, serializeServedCanonicalIds: Function }} geo
 * @param {RawRefs} rawRefs
 * @returns {{ ids: string[], text: string, sha256: string, count: number }}
 */
export function buildServedIds(geo, rawRefs) {
  if (!geo || typeof geo.buildServedCanonicalIds !== "function" || typeof geo.serializeServedCanonicalIds !== "function") {
    throw new Error("buildServedIds: geo module must expose buildServedCanonicalIds + serializeServedCanonicalIds (see geo-loader.loadGeo)");
  }
  const ids = geo.buildServedCanonicalIds({
    lots: rawRefs && rawRefs.lots ? rawRefs.lots : [],
    zones: rawRefs && rawRefs.zones ? rawRefs.zones : [],
  });
  const text = geo.serializeServedCanonicalIds(ids);
  return { ids, text, sha256: sha256Hex(text), count: ids.length };
}

// Parse a serialized served-ids blob into the ordered id array (drops the final
// newline-terminated empty token; tolerant of CRLF).
export function parseServedIds(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/\r$/, ""))
    .filter((l) => l.length > 0);
}

// Merge-diff of two BYTE-SORTED id arrays → { aOnly, bOnly }. O(n) single pass.
function mergeDiff(a, b) {
  const aOnly = [];
  const bOnly = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; }
    else if (a[i] < b[j]) { aOnly.push(a[i]); i += 1; }
    else { bOnly.push(b[j]); j += 1; }
  }
  while (i < a.length) { aOnly.push(a[i]); i += 1; }
  while (j < b.length) { bOnly.push(b[j]); j += 1; }
  return { aOnly, bOnly };
}

const SAMPLE = 20;

/**
 * OCTET-À-OCTET comparison of two served-ids blobs (locked contract). `match`
 * iff the bytes are identical. On any difference, `drift` with a merge-diff
 * summary (both directions) — the fail-closed signal that triggers redo-on-drift.
 *
 * Naming: `a` = immo, `b` = geo by convention. The set diff surfaces both
 * `immoOnly` (immo references geo does not serve — the SPEC §3.1 fail-closed
 * pendings) and `geoOnly` (geo serves more than immo references).
 * @returns {{ status: "match" | "drift", diff_summary: object }}
 */
export function byteCompare(aText, bText, { aLabel = "immo", bLabel = "geo" } = {}) {
  const aStr = String(aText ?? "");
  const bStr = String(bText ?? "");
  const aSha = sha256Hex(aStr);
  const bSha = sha256Hex(bStr);
  if (aStr === bStr) {
    const a = parseServedIds(aStr);
    return { status: "match", diff_summary: { [`${aLabel}_count`]: a.length, [`${bLabel}_count`]: a.length, [`${aLabel}_sha256`]: aSha, [`${bLabel}_sha256`]: bSha } };
  }
  const a = parseServedIds(aStr);
  const b = parseServedIds(bStr);
  const { aOnly, bOnly } = mergeDiff(a, b);
  return {
    status: "drift",
    diff_summary: {
      [`${aLabel}_count`]: a.length,
      [`${bLabel}_count`]: b.length,
      [`${aLabel}_sha256`]: aSha,
      [`${bLabel}_sha256`]: bSha,
      [`${aLabel}_only`]: { count: aOnly.length, sample: aOnly.slice(0, SAMPLE) },
      [`${bLabel}_only`]: { count: bOnly.length, sample: bOnly.slice(0, SAMPLE) },
    },
  };
}

/**
 * SPEC §3.1 fail-closed subset check: every immo reference must be served by geo
 * (`immo_refs ⊆ served`). Kept alongside the locked byte-equality path for the
 * cases where immo publishes its REF set rather than its served set.
 * @returns {{ ok: boolean, pending: string[] }}  pending = immo ids absent from served
 */
export function subsetCheck(immoRefsText, servedText) {
  const refs = parseServedIds(immoRefsText);
  const served = parseServedIds(servedText);
  const { aOnly } = mergeDiff(refs, served);
  return { ok: aOnly.length === 0, pending: aOnly };
}
