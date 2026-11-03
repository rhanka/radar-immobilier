/**
 * Governed licence registry (I-1A, converged r3 §1, geo-N4).
 *
 * The public OGC API renders `license {title, href?}` with NO id, so the
 * facade matches `license.title` by EXACT equality (no case/accent/prefix
 * normalisation — any invented normalisation could promote an unknown licence
 * into a known one) against the titles below.
 *
 * "Unknown license", an absent title, or a title with no registry entry means
 * licence `unknown` and the collection is EXCLUDED from the served catalogue.
 * A title duplicated across ids with different conditions is AMBIGUOUS and
 * also resolves to `unknown` until F3-PUB renders `license.id`.
 *
 * Titles below were measured on the live public prod OGC API at I-1A opening
 * (2026-11-03, 3 900 collections). The resolved ids are the facade's local
 * resolution of each documented source licence; F3-LIAISON switches the
 * resolution to the geo-rendered `license.id` wherever it is served.
 */

/** A known licence: its exact OGC title and the resolved registry id. */
export interface GovernedLicence {
  /** Resolved licence id (see module note on provenance). */
  readonly id: string;
  /** Exact OGC `license.title` as rendered by the geo API (verbatim). */
  readonly title: string;
}

export const GOVERNED_LICENCE_REGISTRY: readonly GovernedLicence[] = [
  {
    id: "cc-by-4.0",
    title: "Creative Commons Attribution 4.0 International",
  },
  {
    id: "portneuf-zonage-municipal",
    title: "Donnée publique municipale (zonage) — MRC de Portneuf",
  },
  {
    id: "rosemere-zonage-municipal",
    title: "Plan de zonage municipal Ville de Rosemère",
  },
];

/** The OGC fallback title: conservative, "not redistributable" — never served. */
export const UNKNOWN_LICENCE_TITLE = "Unknown license";

export type LicenceResolution =
  | { readonly status: "known"; readonly licenseId: string }
  | {
      readonly status: "unknown";
      readonly reason: "unmatched-title" | "ambiguous-title" | "missing-title";
    };

/**
 * Resolve an OGC `license.title` to a registry id by EXACT match.
 *
 * Pure: no normalisation, no network, no fallback value. The registry is
 * injectable (default: the shipped `GOVERNED_LICENCE_REGISTRY`) so tests can
 * prove the ambiguous-title refusal against a duplicated title without
 * touching the shipped registry.
 */
export function resolveLicenceId(
  title: unknown,
  registry: readonly GovernedLicence[] = GOVERNED_LICENCE_REGISTRY,
): LicenceResolution {
  if (typeof title !== "string" || title.length === 0) {
    return { status: "unknown", reason: "missing-title" };
  }
  const matches = registry.filter((entry) => entry.title === title);
  if (matches.length === 0) {
    return { status: "unknown", reason: "unmatched-title" };
  }
  if (matches.length > 1) {
    return { status: "unknown", reason: "ambiguous-title" };
  }
  return { status: "known", licenseId: matches[0]!.id };
}

/**
 * Assert at startup/test time that registry titles are unique: a duplicated
 * title across ids with different conditions would silently serve an
 * ambiguous collection. Throws on the first duplicate.
 */
export function assertRegistryTitlesUnique(
  registry: readonly GovernedLicence[] = GOVERNED_LICENCE_REGISTRY,
): void {
  const seen = new Map<string, string>();
  for (const entry of registry) {
    const first = seen.get(entry.title);
    if (first !== undefined && first !== entry.id) {
      throw new Error(
        `ambiguous licence title ${JSON.stringify(entry.title)} (ids ${first} and ${entry.id})`,
      );
    }
    seen.set(entry.title, entry.id);
  }
}
