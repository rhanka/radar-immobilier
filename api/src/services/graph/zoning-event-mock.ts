import { z } from "zod";

/**
 * MOCK input contract for the règlement-lifecycle projection (LOT 1.b).
 *
 * `ZoningEvent` is the shape EMITTED VERBATIM by geo on the `qc-zoning-events` feed
 * (frozen contract geo↔immo `5f7ca0a9` §1-§6). The feed is NOT live yet, so this file
 * defines the emitted shape locally to mock fixtures against; when geo publishes a shared
 * type this mock is replaced by the import. It is validated by geo's `validateZoningEvent`.
 *
 * Boundary (contract §3, confirmed by geo-archi): geo emits verbatim material only —
 * it NEVER emits typed relations (`replaces`/`amends`) or a derived `lifecycle_stage`.
 * The immo projection derives those (see reglement-lifecycle-projection.ts).
 */

/** §1 — first-class emitted document_type. String (not enum) so §9-unknown values
 *  (e.g. "premier_projet", "second_projet") pass through tolerated, never a crash. */
export const KNOWN_DOCUMENT_TYPES = [
  "avis_motion",
  "projet_reglement",
  "adoption",
  "entree_en_vigueur",
  "abrogation",
] as const;

/** §2.1 — legal trigger fact the en_vigueur delay runs from (NOT the adoption). */
export const DeclencheurType = z.enum(["publication_avis", "certificat_mrc"]);

/** §6 — provenance v2: verbatim-or-unknown, LIVE source required (placeholder/404 forbidden). */
export const ZoningEventProvenance = z.object({
  producer: z.string().min(1),
  source_span: z.string(),
  source_url: z.string().url(),
  as_of_date: z.string().nullable().default(null),
  sha256: z.string().min(1),
  retrieved_at: z.string().min(1),
});
export type ZoningEventProvenanceT = z.infer<typeof ZoningEventProvenance>;

export const ZoningEvent = z
  .object({
    /** §5 A1 — sha256(muni|source_ref|detection_anchor); NEVER the reglement number. */
    event_id: z.string().min(1),
    /** v2.1 — revision counter; a higher version supersedes the same event_id. */
    version: z.number().int().nonnegative().default(1),
    /** v2.1 — event_id of the revision this one supersedes (same-stage correction), or null. */
    supersedes: z.string().nullable().default(null),
    state: z.string().nullable().default(null),
    muni: z.string().min(1),
    /** Bylaw number carried at adoption/en_vigueur; null on an avis. */
    bylaw_numero: z.string().nullable().default(null),
    /** Content type (incl. the 4 suspensive: registre-referendaire/retrait/echec-referendaire/refus-mrc). */
    type: z.string().nullable().default(null),
    /** §1 — string (§9-tolerant): a value outside KNOWN_DOCUMENT_TYPES is passed through. */
    document_type: z.string().min(1),
    /** §10 — instrument family DECLARED-SOURCE by geo (verbatim known-or-§9-tolerated value,
     *  the literal "unknown", or null/legacy). immo CONSUMES it verbatim — never classifies.
     *  Orthogonal to document_type (regime): a habilitant bylaw carries typeInstrument="derogation". */
    typeInstrument: z.string().nullable().default(null),
    /** §1 — the numbers the event attests (LIST; refonte = N numbers). Empty on avis. */
    reglement_number: z.array(z.string().nullable()).default([]),
    /** §1/§4 — AVIS-ONLY: the announced future number (for avis→adoption correlation).
     *  MUST be null on any non-avis document_type (guard below). */
    cible_reglement_numero: z.string().nullable().default(null),
    /** §3 — verbatim relation libellés ("modifiant/abroge et remplace <n°>"); typing material. */
    libelles_relation: z.array(z.string()).default([]),
    declencheur_type: DeclencheurType.nullable().default(null),
    declencheur_date_verbatim: z.string().nullable().default(null),
    date_iso: z.string().nullable().default(null),
    zone_codes_resolus: z.array(z.string()).default([]),
    zone_codes_non_resolus: z.array(z.string()).default([]),
    url_pdf: z.string().url(),
    extrait_brut: z.string(),
    provenance: ZoningEventProvenance,
  })
  // §1/§4 guard (matches geo `validateZoningEvent`): `cible_reglement_numero` is reserved
  // for `avis_motion`. On a KNOWN non-avis type it MUST be null — else the base number would
  // be mis-correlated as the avis target immo-side. (Unknown §9 types are not constrained.)
  .refine(
    (e) =>
      e.cible_reglement_numero === null ||
      e.document_type === "avis_motion" ||
      !(KNOWN_DOCUMENT_TYPES as readonly string[]).includes(e.document_type),
    { message: "cible_reglement_numero is avis_motion-only (§1/§4)", path: ["cible_reglement_numero"] },
  );
export type ZoningEventT = z.infer<typeof ZoningEvent>;

/** Build a ZoningEvent for fixtures/tests — sane defaults, override what the case needs.
 *  Parses through the schema so fixtures can never drift from the emitted contract. */
export function mockZoningEvent(overrides: Partial<ZoningEventT> & Pick<ZoningEventT, "muni" | "document_type">): ZoningEventT {
  const base = {
    event_id: `mock:${overrides.muni}:${overrides.document_type}:${overrides.event_id ?? Math.random().toString(36).slice(2)}`,
    url_pdf: "https://example.invalid/pv.pdf",
    extrait_brut: "",
    provenance: {
      producer: "mock",
      source_span: "",
      source_url: "https://example.invalid/pv.pdf",
      as_of_date: null,
      sha256: "0".repeat(64),
      retrieved_at: "2026-01-01T00:00:00.000Z",
    },
  };
  return ZoningEvent.parse({ ...base, ...overrides });
}
