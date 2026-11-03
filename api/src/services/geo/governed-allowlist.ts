/**
 * Property allowlist for governed zonage items (I-1A, converged r3 §1:
 * allowlist, never a denylist alone — geo-N2/geo-N3, owner decision O3).
 *
 * The facade serves item properties ONLY through the per-collection field
 * list recorded in the instance policy. On top, a banned-key guard strips
 * civic-address and raw-excerpt keys even if a record ever listed them: a
 * pass-through `else` branch would silently emit exactly what this module
 * exists to protect, so the default branch drops, never passes through.
 *
 * Banned (fail-closed, Loi 25):
 * - `adresse` (civic address — personal targeting use, O3 default);
 * - `code_postal*` (postal code + precision — same default);
 * - `extrait_brut` (raw PV excerpt — presumed carrier of names until a
 *   per-source field review concludes otherwise);
 * - `url_pdf` (served only after an explicit field review classifying it as
 *   a public-source link; no review exists in I-1A).
 */

import { GOVERNED_SERVED_RECORDS } from "./governed-policy.js";

/** Keys (or key prefixes) that are never served, whatever a record says. */
const BANNED_EXACT: ReadonlySet<string> = new Set([
  "adresse",
  "extrait_brut",
  "url_pdf",
]);

const BANNED_PREFIXES: readonly string[] = ["code_postal"];

/** Provenance envelope keys: preserved only through the existing sanitiser. */
const PROVENANCE_KEYS: ReadonlySet<string> = new Set([
  "proof",
  "immo_zone_lot_provenance",
]);

/** True when the key must never be served. */
export function isBannedPropertyKey(key: string): boolean {
  if (BANNED_EXACT.has(key)) return true;
  return BANNED_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Apply the per-collection allowlist to one item's properties.
 *
 * - Unknown collection (no record): everything is dropped (empty object).
 * - Recorded collection: only the recorded fields survive, minus banned keys.
 * - Provenance envelopes are NOT allowlisted here: the caller keeps them via
 *   the existing `sanitizeFeatureProvenance`, which validates them positively.
 */
export function applyZonageAllowlist(
  collectionId: string,
  properties: Record<string, unknown>,
  records: readonly { collectionId: string; servedFields: readonly string[] }[] = GOVERNED_SERVED_RECORDS,
): Record<string, unknown> {
  const record = records.find((r) => r.collectionId === collectionId);
  if (!record) return {};
  const allowed = new Set(record.servedFields);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (PROVENANCE_KEYS.has(key)) continue; // handled by the provenance sanitiser
    if (!allowed.has(key)) continue; // default branch drops, never passes through
    if (isBannedPropertyKey(key)) continue; // belt and braces over the record
    out[key] = value;
  }
  return out;
}
