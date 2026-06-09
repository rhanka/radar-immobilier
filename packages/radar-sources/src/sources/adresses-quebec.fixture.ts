import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * REAL committed terrAPI / Adresses Québec FeatureCollection fixtures for the
 * adapter tests.
 *
 * NOTHING here is fabricated: both constants are verbatim first-records excerpts
 * of the live terrAPI `municipalites/<code>/adresses?geometry=0` responses,
 * committed under the spike's `samples/` directory (the SAME bytes the
 * deterministic seed-ontology path reuses). The fixture only re-reads those
 * committed files so the RECUEIL adapter can be unit-tested against REAL bytes
 * with no network call.
 *
 *   - terrapi-adresses-salaberry.json  — Salaberry-de-Valleyfield (70052):
 *     "24 rue Paquette, …", "561 avenue de Grande-Île, …", "310 boulevard Pie-XII, …".
 *   - terrapi-adresses-beauharnois.json — Beauharnois (70022):
 *     "279 chemin Saint-Louis, …", "28 rue Trudeau, …", "568 2 rue Richard, …".
 *
 * The committed sample was fetched with `geometry=0`, so it carries NO geometry
 * coordinates and NO lot numbers (HONEST: the Adresse geom stays null downstream).
 */

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(
  here,
  "_spikes",
  "adresses-quebec-igo-geocoder",
  "samples",
);

function readSample(name: string): string {
  return readFileSync(join(SAMPLES_DIR, name), "utf-8");
}

/** Verbatim Salaberry-de-Valleyfield (70052) terrAPI addresses — committed bytes. */
export const ADRESSES_QUEBEC_VALLEYFIELD_JSON = readSample(
  "terrapi-adresses-salaberry.json",
);

/** Verbatim Beauharnois (70022) terrAPI addresses — committed bytes. */
export const ADRESSES_QUEBEC_BEAUHARNOIS_JSON = readSample(
  "terrapi-adresses-beauharnois.json",
);
