import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML,
  AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
  AVIS_PUBLICS_FIXTURE_HTML,
  AVIS_PUBLICS_SOURCE_URL,
  buildRawDocumentRecord,
  parseAvisPublics,
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
 * graphify project state from the REAL committed corpus so the reconciliation
 * studio is never empty on a fresh stack (SPEC_ONTOLOGY §0.2).
 *
 * It reuses the RECUEIL S3 substrate: the committed sample bytes are wrapped as
 * `RawDocumentRecord`s and PUT into object storage under the canonical raw keys
 * (exactly as RECUEIL would after a real fetch — but with NO network call), then
 * EXPLOITATION re-reads those bytes and reconciles them. Every entity that
 * results is derived from the parsers on the real bytes (anti-invention, §7.4:
 * owner/PII is NEVER surfaced — always `non-disponible`).
 *
 * Each pilot city is seeded from TWO real sources so the screen carries cross-
 * source structure (WP4 Source #2):
 *   1. its REAL MAMH role record (Lot / Valuation canonicals), and
 *   2. its REAL avis-publics index (Bylaw + DesignationEvent canonicals +
 *      derogation/PPCMOI Signals).
 * A Bylaw or Lot that co-occurs in BOTH the role and the avis surfaces as a
 * cross-source `entity_match` candidate; where the two committed records share
 * no identifier, the honest result is zero such candidates (reported as-is).
 *
 *   - salaberry-de-valleyfield (MAMH 70052): role lot 4193751 (+4 lots),
 *     matricule 5114-86-8189, total 2 748 500 $; avis = Craft index (4 notices:
 *     dérogation, registre 150-49-1, EEV 209-47/216-34, PPCMOI 2026-0066).
 *   - beauharnois (MAMH 70022): role lot 4716029, matricule 6719-81-9976,
 *     total 444 000 $; avis = WordPress index (4 notices: dérogation
 *     DM-2026-0037, consultation/projet 701-102, EEV 2026-11/2026-07).
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

/** A city's REAL committed avis-publics index (committed bytes, no network). */
export interface CityAvisSpec {
  /** Stable source id stamped on the seeded avis RawDocument. */
  readonly sourceId: string;
  /** The real, public avis-publics index URL (provenance). */
  readonly sourceUrl: string;
  /** Verbatim HTML captured from the live page (the committed fixture). */
  readonly html: string;
}

/** Per-city REAL sample mapping (committed bytes, no network). */
export interface CitySampleSpec {
  readonly citySlug: string;
  /** MAMH municipality code (provenance only; the bytes are authoritative). */
  readonly codeMamh: string;
  /** Committed role sample filename under the spikes samples dir. */
  readonly sampleFile: string;
  /** Stable source id stamped on the seeded role RawDocument. */
  readonly sourceId: string;
  /** A real, public URL for provenance (the MAMH open-data role product). */
  readonly sourceUrl: string;
  /** The city's REAL committed avis-publics index (cross-source corpus). */
  readonly avis: CityAvisSpec;
}

export const CITY_SAMPLES: Record<string, CitySampleSpec> = {
  "salaberry-de-valleyfield": {
    citySlug: "salaberry-de-valleyfield",
    codeMamh: "70052",
    sampleFile: "RL70052_2026.first-record.xml",
    sourceId: "role-evaluation-mamh-70052",
    sourceUrl:
      "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
    avis: {
      sourceId: "avis-publics-valleyfield",
      sourceUrl: AVIS_PUBLICS_SOURCE_URL,
      html: AVIS_PUBLICS_FIXTURE_HTML,
    },
  },
  beauharnois: {
    citySlug: "beauharnois",
    codeMamh: "70022",
    sampleFile: "RL70022_2026.first-record.xml",
    sourceId: "role-evaluation-mamh-70022",
    sourceUrl:
      "https://www.donneesquebec.ca/recherche/dataset/role-evaluation-fonciere",
    avis: {
      sourceId: "avis-publics-beauharnois",
      sourceUrl: AVIS_PUBLICS_BEAUHARNOIS_SOURCE_URL,
      html: AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML,
    },
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

/** A concrete real avis notice the seed parsed (for honest reporting / tests). */
export interface SeededRealAvis {
  readonly title: string;
  readonly type: string;
  readonly bylaws: string[];
}

export interface SeedOntologyResult {
  readonly ok: boolean;
  readonly citySlug: string;
  /** S3 key the raw ROLE sample was stored under (RECUEIL substrate). */
  readonly rawRef: string;
  /** S3 key the raw AVIS index was stored under (RECUEIL substrate). */
  readonly avisRawRef: string;
  readonly mentionCount: number;
  readonly candidateCount: number;
  readonly canonicalCount: number;
  /** Real role units parsed from the sample bytes (verbatim values). */
  readonly realEntities: SeededRealEntity[];
  /** Real avis notices parsed from the committed index bytes (verbatim). */
  readonly realAvis: SeededRealAvis[];
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

  // Build the RECUEIL record from the REAL ROLE bytes and PUT them under the raw
  // key (exactly what RECUEIL persists after a fetch — but the bytes are committed).
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

  // Build the RECUEIL record from the REAL AVIS index bytes (committed fixture —
  // the city's live avis-publics page captured verbatim) and PUT them too. This
  // is the second source that gives the screen Bylaw/DesignationEvent canonicals
  // + Signals, and any role↔avis overlap as a cross-source entity_match candidate.
  const avisBytes = new TextEncoder().encode(spec.avis.html);
  const avisRecord: RawDocumentRecord = buildRawDocumentRecord({
    source: spec.avis.sourceId,
    sourceUrl: spec.avis.sourceUrl,
    body: avisBytes,
    fetchedAt,
    contentType: "text/html; charset=utf-8",
    provenance: { version: "seed-1", userAgent: "radar-seed", viaObscura: false },
  });
  const avisExisting = await store.head(avisRecord.storageKey);
  if (!avisExisting) {
    await store.put(avisRecord.storageKey, avisBytes, avisRecord.contentType);
  }

  // EXPLOITATION over BOTH real docs: re-read the bytes → modeled mentions →
  // graphify reconciliation → persisted per-city project state served at
  // GET /api/ontology/:city/*. The role XML yields Lot/Valuation mentions; the
  // avis HTML yields Bylaw/DesignationEvent mentions; shared identifiers across
  // the two reconcile into a single cross-source canonical.
  const exploitation = await runExploitation({
    store,
    citySlug,
    rawDocRecords: [record, avisRecord],
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

  // Parse the REAL avis notices straight from the committed bytes for reporting.
  const realAvis: SeededRealAvis[] = parseAvisPublics(spec.avis.html).map((a) => ({
    title: a.title,
    type: a.type,
    bylaws: a.bylaws,
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
    avisRawRef: avisRecord.storageKey,
    mentionCount: exploitation.mentionCount,
    candidateCount: exploitation.candidateCount,
    canonicalCount: exploitation.canonicalCount,
    realEntities,
    realAvis,
    signalCount,
    stateKey: exploitation.stateKey,
    validation,
    exploitation,
  };
}
