import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRawDocumentRecord,
  parseRoleEvaluation,
  type RawDocumentRecord,
} from "@radar/sources";

import type { ObjectStore } from "../../storage/object-store.js";
import {
  runExploitation,
  type ExploitationResult,
} from "./exploitation.js";
import { deriveSignals } from "../exploitation/signals.js";
import {
  validateProjectState,
  type ProjectStateValidationResult,
} from "../exploitation/validators.js";

/**
 * SEED-ONTOLOGY — a deterministic, NETWORK-FREE path that populates a city's
 * graphify project state from the REAL committed MAMH role samples so the
 * reconciliation studio is never empty on a fresh stack (SPEC_ONTOLOGY §0.2).
 *
 * It reuses the RECUEIL S3 substrate: the committed sample bytes are wrapped as
 * a `RawDocumentRecord` and PUT into object storage under the canonical raw key
 * (exactly as RECUEIL would after a real fetch — but with NO network call), then
 * EXPLOITATION re-reads those bytes and reconciles them. Every entity that
 * results is derived from `parseRoleEvaluation` on the real bytes (anti-invention,
 * §7.4: owner/PII is NEVER surfaced — always `non-disponible`).
 *
 * Both pilot cities are seeded from their REAL role record:
 *   - salaberry-de-valleyfield (MAMH 70052): lot 4193751 (+4 lots),
 *     matricule 5114-86-8189, total 2 748 500 $.
 *   - beauharnois (MAMH 70022): lot 4716029, matricule 6719-81-9976,
 *     total 444 000 $.
 */

const here = dirname(fileURLToPath(import.meta.url));
/** Repo root relative to api/src/services/sources (4 levels up). */
const REPO_ROOT = join(here, "..", "..", "..", "..");
const SAMPLES_DIR = join(
  REPO_ROOT,
  "packages",
  "radar-sources",
  "src",
  "sources",
  "_spikes",
  "roles-evaluation-fonciere-mamh",
  "samples",
);

/** Per-city REAL role sample mapping (committed bytes, no network). */
export interface CitySampleSpec {
  readonly citySlug: string;
  /** MAMH municipality code (provenance only; the bytes are authoritative). */
  readonly codeMamh: string;
  /** Committed sample filename under the spikes samples dir. */
  readonly sampleFile: string;
  /** Stable source id stamped on the seeded RawDocument. */
  readonly sourceId: string;
  /** A real, public URL for provenance (the MAMH open-data role product). */
  readonly sourceUrl: string;
}

export const CITY_SAMPLES: Record<string, CitySampleSpec> = {
  "salaberry-de-valleyfield": {
    citySlug: "salaberry-de-valleyfield",
    codeMamh: "70052",
    sampleFile: "RL70052_2026.first-record.xml",
    sourceId: "role-evaluation-mamh-70052",
    sourceUrl:
      "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
  },
  beauharnois: {
    citySlug: "beauharnois",
    codeMamh: "70022",
    sampleFile: "RL70022_2026.first-record.xml",
    sourceId: "role-evaluation-mamh-70022",
    sourceUrl:
      "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
  },
};

/** The cities the seed knows how to populate (used for scope enforcement). */
export const SEED_CITY_SLUGS: readonly string[] = Object.keys(CITY_SAMPLES);

/** A concrete real entity the seed produced (for honest reporting / tests). */
export interface SeededRealEntity {
  readonly noLots: string[];
  readonly matricule: string;
  /** Total role value (RL0404A) in CAD, or null when absent. */
  readonly valeur: number | null;
  readonly valeurDate: string;
}

export interface SeedOntologyResult {
  readonly ok: boolean;
  readonly citySlug: string;
  /** S3 key the raw sample was stored under (RECUEIL substrate). */
  readonly rawRef: string;
  readonly mentionCount: number;
  readonly candidateCount: number;
  readonly canonicalCount: number;
  /** Real role units parsed from the sample bytes (verbatim values). */
  readonly realEntities: SeededRealEntity[];
  /** Count of validated OntoSignals derived from reconciled DesignationEvents. */
  readonly signalCount: number;
  readonly stateKey: string;
  /** Radar-validator (D3) outcome over the produced state. */
  readonly validation: ProjectStateValidationResult;
  readonly exploitation: ExploitationResult;
}

/** Read the committed REAL sample bytes for a city (no network, no fabrication). */
export function readCitySampleBytes(spec: CitySampleSpec): Uint8Array {
  const path = join(SAMPLES_DIR, spec.sampleFile);
  return new Uint8Array(readFileSync(path));
}

/**
 * Wrap the city's REAL committed role bytes as a RawDocument in S3 (idempotent),
 * then run EXPLOITATION + the radar validators over the result.
 *
 * @param store    object storage (reused RECUEIL S3 store; no network)
 * @param citySlug pilot city slug (must be a key of CITY_SAMPLES)
 * @param now      deterministic clock for tests
 */
export async function seedCityOntology(
  store: ObjectStore,
  citySlug: string,
  now: () => Date = () => new Date(),
): Promise<SeedOntologyResult> {
  const spec = CITY_SAMPLES[citySlug];
  if (!spec) {
    throw new Error(
      `seed-ontology: no committed role sample for city "${citySlug}" (known: ${SEED_CITY_SLUGS.join(", ")})`,
    );
  }

  const bytes = readCitySampleBytes(spec);
  const fetchedAt = now().toISOString();

  // Build the RECUEIL record from the REAL bytes and PUT them under the raw key
  // (exactly what RECUEIL persists after a fetch — but the bytes are committed).
  const record: RawDocumentRecord = buildRawDocumentRecord({
    source: spec.sourceId,
    sourceUrl: spec.sourceUrl,
    body: bytes,
    fetchedAt,
    contentType: "application/xml",
    provenance: { version: "seed-1", userAgent: "radar-seed", viaObscura: false },
  });
  const existing = await store.head(record.storageKey);
  if (!existing) {
    await store.put(record.storageKey, bytes, record.contentType);
  }

  // EXPLOITATION: re-read the bytes → modeled mentions → graphify reconciliation
  // → persisted per-city project state served at GET /api/ontology/:city/*.
  const exploitation = await runExploitation({
    store,
    citySlug,
    rawDocRecords: [record],
    now,
  });

  // Parse the REAL role units straight from the bytes for honest reporting.
  const role = parseRoleEvaluation(new TextDecoder().decode(bytes));
  const realEntities: SeededRealEntity[] = role.units.map((u) => ({
    noLots: u.noLots,
    matricule: u.matricule,
    valeur: u.valeur,
    valeurDate: u.valeurDate,
  }));

  // Signals derived from reconciled DesignationEvent canonicals (role-only seed
  // produces Lot/Valuation/Source canonicals ⇒ typically zero signals; an avis
  // corpus would add some). Reported honestly.
  const signalCount = deriveSignals({
    citySlug,
    canonicals: exploitation.state.canonicals,
  }).length;

  // RADAR VALIDATORS (D3 §3.5/§4.4): per-city scope + status-transition gate over
  // the produced state. A violation routes the entity to needs_review (not
  // projected); for the seed it MUST be clean.
  const validation = validateProjectState({
    citySlug,
    canonicals: exploitation.state.canonicals,
    mentions: exploitation.state.mentions,
    knownCitySlugs: SEED_CITY_SLUGS,
  });

  return {
    ok: exploitation.ok && validation.ok,
    citySlug,
    rawRef: record.storageKey,
    mentionCount: exploitation.mentionCount,
    candidateCount: exploitation.candidateCount,
    canonicalCount: exploitation.canonicalCount,
    realEntities,
    signalCount,
    stateKey: exploitation.stateKey,
    validation,
    exploitation,
  };
}
