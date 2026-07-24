/**
 * Public provenance envelopes supplied by geo.
 *
 * They are opaque to immo: safe envelopes are passed through verbatim. An
 * envelope containing a storage key, local path, or non-canonical URL is
 * dropped as a whole rather than partly rewritten.
 */

export type ProvenanceEnvelope = Record<string, unknown>;

export interface FeatureProvenanceProperties {
  proof?: ProvenanceEnvelope;
  immo_zone_lot_provenance?: ProvenanceEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnsafeReference(value: string, key: string): boolean {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("s3://") ||
    lower.startsWith("file:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~/") ||
    /^[a-z]:[\\/]/i.test(trimmed)
  ) {
    return true;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return (
        (url.protocol !== "http:" && url.protocol !== "https:") ||
        !url.hostname ||
        Boolean(url.username || url.password || url.search || url.hash) ||
        /(^|\.)s3[.-]/i.test(url.hostname)
      );
    } catch {
      return true;
    }
  }

  const keyLower = key.toLowerCase();
  if (/(?:s3|object|storage).*key|(?:local|file).*path/.test(keyLower)) return true;
  return /(?:uri|url|path|key)$/.test(keyLower);
}

function containsUnsafeReference(value: unknown, key = "", seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return isUnsafeReference(value, key);
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((entry) => containsUnsafeReference(entry, key, seen));
  }
  return Object.entries(value).some(([entryKey, entryValue]) =>
    containsUnsafeReference(entryValue, entryKey, seen),
  );
}

function safeEnvelope(value: unknown): ProvenanceEnvelope | undefined {
  return isRecord(value) && !containsUnsafeReference(value) ? value : undefined;
}

/** Extract only safe, opaque envelopes without renaming or interpreting them. */
export function publicProvenanceFromProperties(
  properties: Record<string, unknown>,
): FeatureProvenanceProperties {
  const proof = safeEnvelope(properties["proof"]);
  const provenance = safeEnvelope(properties["immo_zone_lot_provenance"]);
  return {
    ...(proof ? { proof } : {}),
    ...(provenance ? { immo_zone_lot_provenance: provenance } : {}),
  };
}

/** Recover the envelopes stored in an OGC evidence entry. */
export function publicProvenanceFromEvidence(evidence: unknown): FeatureProvenanceProperties {
  const entries = Array.isArray(evidence) ? evidence : [evidence];
  for (const entry of entries) {
    if (isRecord(entry)) {
      const provenance = publicProvenanceFromProperties(entry);
      if (provenance.proof || provenance.immo_zone_lot_provenance) return provenance;
    }
  }
  return {};
}

/** Remove only unsafe provenance envelopes; every other property is unchanged. */
export function sanitizeFeatureProvenance(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const provenance = publicProvenanceFromProperties(properties);
  const sanitized = { ...properties };
  for (const key of ["proof", "immo_zone_lot_provenance"] as const) {
    if (!(key in properties)) continue;
    if (provenance[key]) sanitized[key] = provenance[key];
    else delete sanitized[key];
  }
  return sanitized;
}
