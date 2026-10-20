/**
 * Municipality resolution for the D3 report.
 *
 * A city matches a QC municipality by exact name (NFC, trimmed, case
 * ignored). The MRC / region column only disambiguates homonyms. Zero
 * matching slugs is unresolved, two or more is a conflict.
 */

import { QC_MUNICIPALITIES } from "@radar/sources/municipalities";

export interface MunicipalityRef {
  slug: string;
  name: string;
  mrc: string | null;
}

export type MunicipalityResolution =
  | { kind: "unique"; slug: string }
  | { kind: "unresolved" }
  | { kind: "conflict"; slugs: string[] };

const DEFAULT_MUNICIPALITIES: MunicipalityRef[] = QC_MUNICIPALITIES.map(
  (entry) => ({ slug: entry.slug, name: entry.name, mrc: entry.mrc }),
);

export function normalizeMunicipalityName(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

function slugsOf(candidates: MunicipalityRef[]): string[] {
  return candidates.map((entry) => entry.slug).sort();
}

export function resolveMunicipality(
  cityRaw: string | null,
  mrcRaw: string | null,
  municipalities: readonly MunicipalityRef[] = DEFAULT_MUNICIPALITIES,
): MunicipalityResolution {
  const cityText = (cityRaw ?? "").normalize("NFC").trim();
  if (cityText.length === 0) return { kind: "unresolved" };
  const wanted = normalizeMunicipalityName(cityText);
  const byName = municipalities.filter(
    (entry) => normalizeMunicipalityName(entry.name) === wanted,
  );
  if (byName.length === 0) return { kind: "unresolved" };
  if (byName.length === 1) {
    const only = byName[0];
    if (only === undefined) return { kind: "unresolved" };
    return { kind: "unique", slug: only.slug };
  }
  const mrcText = (mrcRaw ?? "").normalize("NFC").trim();
  if (mrcText.length === 0) return { kind: "conflict", slugs: slugsOf(byName) };
  const wantedMrc = normalizeMunicipalityName(mrcText);
  const byMrc = byName.filter(
    (entry) =>
      entry.mrc !== null &&
      normalizeMunicipalityName(entry.mrc) === wantedMrc,
  );
  if (byMrc.length === 0) return { kind: "unresolved" };
  if (byMrc.length === 1) {
    const only = byMrc[0];
    if (only === undefined) return { kind: "unresolved" };
    return { kind: "unique", slug: only.slug };
  }
  return { kind: "conflict", slugs: slugsOf(byMrc) };
}
