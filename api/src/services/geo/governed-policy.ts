/**
 * Governed instance policy + catalogue derivation (I-1A, converged r3 §1–§2).
 *
 * A collection enters the SERVED catalogue only when a dated per-collection
 * record attests the three conditions: (i) known licence by exact title match
 * with redistribution-compatible conditions, (ii) Loi 25 class `public` for
 * the actually served fields, (iii) rights present. Every other collection is
 * listed NOT SERVED with an explicit status — never served, and every refusal
 * happens BEFORE any upstream call.
 *
 * Statuses:
 * - `served`      — full dated record, all three conditions hold.
 * - `not covered` — licence known but the record is incomplete (no dated
 *                   per-collection line, or rights missing).
 * - `unknown`     — licence unknown, unmatched, or ambiguous.
 * - `not served`  — family deferred in I-1A (lots, zoning events, norms, TOD,
 *                   constraints, any other prefix), regardless of licence.
 */

import {
  GOVERNED_LICENCE_REGISTRY,
  resolveLicenceId,
  type GovernedLicence,
  type LicenceResolution,
} from "./governed-licences.js";
import { GOVERNED_ZONING_RECORDS } from "./governed-zoning-records.js";

/** Per-collection served record (instance policy, versioned in code). */
export interface ServedCollectionRecord {
  readonly collectionId: string;
  /** OGC title the record was matched against (exact). */
  readonly matchedTitle: string;
  /** Licence id resolved from the matched title. */
  readonly licenseId: string;
  /** Loi 25 class for the served fields. Only `public` is servable. */
  readonly loi25Class: "public";
  /** Property keys the facade serves for this collection (allowlist). */
  readonly servedFields: readonly string[];
  /** Date of the field observation backing this record (ISO date). */
  readonly observedAt: string;
  /** Where the record comes from (live recount, field review, …). */
  readonly source: string;
  /**
   * J1 zonage: when present, items are served through the CLOSED zoning
   * projection (zoning-projection.ts) instead of the raw-key allowlist:
   * `sourceKeys` is the explicit per-collection mapping (the only raw keys
   * ever read) and `servedFields` lists the projection output keys.
   */
  readonly zoning?: {
    readonly projection: "zoning-v1";
    readonly sourceKeys: readonly string[];
  };
}

/**
 * I-1A instance policy (converged r3 P2). Exactly one complete record: the
 * technical pilot collection, observed live at opening (2026-11-03, 177
 * features, property keys recorded verbatim, no personal data among them).
 * Every other collection — including the 41 other licence-known qc-zonage-*
 * collections — has NO complete dated line and stays listed, not served.
 *
 * J1 zonage (policy j1z-2026-11-05) appends the dated city zoning records of
 * governed-zoning-records.ts. The three conditions are unchanged: a city
 * record whose live listing renders no `rights` stays `not covered`.
 */
export const GOVERNED_POLICY_VERSION = "j1z-2026-11-05";

export const GOVERNED_SERVED_RECORDS: readonly ServedCollectionRecord[] = [
  {
    collectionId: "qc-zonage-gatineau-affectations-territoire",
    matchedTitle: "Creative Commons Attribution 4.0 International",
    licenseId: "cc-by-4.0",
    loi25Class: "public",
    servedFields: [
      "ABREVIATION",
      "AIRE",
      "DESCRIPTION",
      "ENTITEID",
      "MUNID",
      "PERIM",
      "TYPE",
      "country",
      "geoId",
      "level",
      "name",
    ],
    observedAt: "2026-11-03",
    source: "live-recount-public-ogc-api-collections-items-limit-1",
  },
  // J1 zonage (2026-11-05): 68 city zoning collections through the closed
  // zoning projection. Each still needs live licence + rights at every read.
  ...GOVERNED_ZONING_RECORDS,
];

/** Technical pilot city named at I-1A opening (P2). */
export const GOVERNED_PILOT_CITY = "gatineau";

/**
 * Historic business pilot, listed as a gap: its zonage collection carries an
 * unknown licence, so it is NOT the technical pilot until GEO-LIC1 stamps it.
 */
export const GOVERNED_BUSINESS_PILOT_GAP = {
  citySlug: "salaberry-de-valleyfield",
  collectionId: "qc-zonage-salaberry-de-valleyfield",
  status: "unknown",
  reason: "licence unknown on the live API (GEO-LIC1 pending)",
} as const;

/** Live collection descriptor as rendered by the OGC `/collections` listing. */
export interface LiveCollectionDescriptor {
  readonly id: string;
  readonly licenseTitle?: unknown;
  readonly rightsPresent: boolean;
}

export type ServedStatus = "served" | "not covered" | "unknown" | "not served";

export interface CataloguedCollection {
  readonly collectionId: string;
  readonly status: ServedStatus;
  /** Licence resolution detail (exact title match outcome). */
  readonly licence: LicenceResolution;
  readonly rightsPresent: boolean;
  /** Present only when served. */
  readonly record?: ServedCollectionRecord;
  /** Machine-readable refusal reason (absent when served). */
  readonly reason?: string;
}

/** Parse a collection id into its family, or null when it matches none. */
export function parseGovernedFamily(
  id: string,
): "zonage" | "lots" | "zoning-events" | "zonage-norms" | "tod" | "constraints" | "other" {
  if (id.startsWith("qc-zoning-events-")) return "zoning-events";
  if (id.startsWith("qc-zonage-norms-")) return "zonage-norms";
  if (id.startsWith("qc-zonage-")) return "zonage";
  if (id.startsWith("qc-lots-")) return "lots";
  if (id.startsWith("qc-tod-")) return "tod";
  if (id.startsWith("ca-qc-constraints-")) return "constraints";
  return "other";
}

/** Families deferred in I-1A: listed, never served (converged r3 §1). */
const DEFERRED_FAMILIES: ReadonlySet<string> = new Set([
  "lots",
  "zoning-events",
  "zonage-norms",
  "tod",
  "constraints",
  "other",
]);

/**
 * Catalogue one live collection. Pure: no network, no fabrication — a `served`
 * entry requires the full dated record plus rights present plus a known,
 * unambiguous licence whose resolved id equals the recorded one.
 */
export function catalogueCollection(
  collection: LiveCollectionDescriptor,
  records: readonly ServedCollectionRecord[] = GOVERNED_SERVED_RECORDS,
  registry: readonly GovernedLicence[] = GOVERNED_LICENCE_REGISTRY,
): CataloguedCollection {
  const family = parseGovernedFamily(collection.id);
  const licence = resolveLicenceId(collection.licenseTitle, registry);

  if (DEFERRED_FAMILIES.has(family)) {
    return {
      collectionId: collection.id,
      status: "not served",
      licence,
      rightsPresent: collection.rightsPresent,
      reason: `family-${family}-deferred-in-i1a`,
    };
  }

  // Family `zonage` from here on.
  if (licence.status !== "known") {
    return {
      collectionId: collection.id,
      status: "unknown",
      licence,
      rightsPresent: collection.rightsPresent,
      reason: `licence-${licence.reason}`,
    };
  }
  const record = records.find((r) => r.collectionId === collection.id);
  if (!record || record.licenseId !== licence.licenseId || !collection.rightsPresent) {
    return {
      collectionId: collection.id,
      status: "not covered",
      licence,
      rightsPresent: collection.rightsPresent,
      reason: !record
        ? "no-dated-per-collection-record"
        : record.licenseId !== licence.licenseId
          ? "record-licence-mismatch"
          : "rights-missing",
    };
  }
  return {
    collectionId: collection.id,
    status: "served",
    licence,
    rightsPresent: true,
    record,
  };
}

/** Catalogue a whole live listing. Pure. */
export function catalogueCollections(
  collections: readonly LiveCollectionDescriptor[],
  records: readonly ServedCollectionRecord[] = GOVERNED_SERVED_RECORDS,
  registry: readonly GovernedLicence[] = GOVERNED_LICENCE_REGISTRY,
): CataloguedCollection[] {
  return collections.map((collection) => catalogueCollection(collection, records, registry));
}
