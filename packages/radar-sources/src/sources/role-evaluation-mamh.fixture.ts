import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * REAL committed rôle d'évaluation XML fixtures for the MAMH adapter tests.
 *
 * NOTHING here is fabricated: both constants are the verbatim first-record
 * excerpts of the live MAMH open-data files, already committed under the spike's
 * `samples/` directory (the SAME bytes the deterministic seed-ontology path and
 * the `role-evaluation-parser` tests use). The fixture only re-reads those
 * committed files so the RECUEIL adapter can be unit-tested against REAL bytes
 * with no network call.
 *
 *   - RL70052_2026.first-record.xml — Salaberry-de-Valleyfield (MAMH 70052):
 *     lot 4193751 (+4 lots), matricule 5114-86-8189, valeur 2 748 500 $.
 *   - RL70022_2026.first-record.xml — Beauharnois (MAMH 70022):
 *     lot 4716029, matricule 6719-81-9976, valeur 444 000 $.
 */

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(
  here,
  "_spikes",
  "roles-evaluation-fonciere-mamh",
  "samples",
);

function readSample(name: string): string {
  return readFileSync(join(SAMPLES_DIR, name), "utf-8");
}

/** Verbatim Valleyfield (70052) first-record rôle XML — committed bytes. */
export const ROLE_EVALUATION_MAMH_VALLEYFIELD_XML = readSample(
  "RL70052_2026.first-record.xml",
);

/** Verbatim Beauharnois (70022) first-record rôle XML — committed bytes. */
export const ROLE_EVALUATION_MAMH_BEAUHARNOIS_XML = readSample(
  "RL70022_2026.first-record.xml",
);
