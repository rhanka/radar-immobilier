import { z } from "zod";
import { isoDateSchema } from "../common.js";
import { EvidenceItem } from "../opportunity.js";
import { ReconBridge } from "../provenance.js";
import { geoFields } from "./geo.js";

/**
 * V1 canonical node-set Zod schemas (SPEC_ONTOLOGY §1.1 D4): Municipality, Zone,
 * Bylaw, DesignationEvent, Constraint, Lot, Adresse, Valuation, Source, Signal.
 *
 * These mirror the canonical entities materialised from the graphify ontology
 * layer. Every reconciled entity carries:
 *   - `recon`     : the canonical bridge (canonicalId + patch + knowledge-time, §4.1),
 *   - `rawRef`    : the S3 key of the raw document backing it (§4.6),
 *   - `evidence`  : citations (EvidenceItem[], citation_policy §1.3),
 * and, where geospatial, a nullable `geom` + `geomSource` (§4, geo.ts).
 *
 * Names are prefixed `Onto*` to avoid colliding with the watch-layer `Signal`
 * and the relational `OpportunityDossier` already defined in this package.
 */

/** S3 raw-document key, e.g. "raw/avis/salaberry/2026/05/.../Avis-150-49.pdf.sha". */
const rawRef = z.string().min(1);
/** City slug FK to CityProfile, present on every city-scoped entity (§4.6). */
const citySlug = z.string().min(1);
/** Citations backing the entity; ≥0 here, enforced ≥1 where evidence_policy requires (§1.3). */
const evidence = z.array(EvidenceItem).default([]);

// ─────────────────────────────────────────────────────────────────────────────
// Municipality — registry (`municipalities`), authoritative, not reconciled.
// ─────────────────────────────────────────────────────────────────────────────
export const OntoMunicipality = z.object({
  id: z.string().uuid(),
  slug: citySlug,
  nomOfficiel: z.string().min(1),
  /** MAMH code, e.g. "70052" (Salaberry-de-Valleyfield). */
  codeMamh: z.string().min(1),
  /** StatCan DGUID; null when not available (anti-invention). */
  dguidStatcan: z.string().nullable().default(null),
  /** MRC attribute (Region becomes a node in V2, §1.1). */
  mrcSlug: z.string().min(1),
  ...geoFields,
});
export type OntoMunicipalityT = z.infer<typeof OntoMunicipality>;

// ─────────────────────────────────────────────────────────────────────────────
// Zone — reconciled + hardenable. Identity is the stable `id`; `codeAffiche` is
// a dated alias that may change (U-521 → H-521) or be reused (§2.4).
// ─────────────────────────────────────────────────────────────────────────────
/** First letter of a zone code maps to a coarse land-use kind (§2.2). */
export const ZoneKind = z.enum(["H", "C", "U", "I", "P", "A", "autre"]);
export type ZoneKindT = z.infer<typeof ZoneKind>;
export const OntoZone = z.object({
  id: z.string().uuid(),
  citySlug,
  /** Displayed code at the active period, e.g. "H-609-4" (a dated alias, not the identity). */
  codeAffiche: z.string().min(1),
  kind: ZoneKind,
  rawRef,
  recon: ReconBridge,
  evidence,
  ...geoFields,
});
export type OntoZoneT = z.infer<typeof OntoZone>;

// ─────────────────────────────────────────────────────────────────────────────
// Bylaw (règlement) — reconciled + hardenable. `amendsBylawId` is DERIVED from
// the AMENDS edge in projection, never hand-entered (§1.2, §4.2).
// ─────────────────────────────────────────────────────────────────────────────
export const OntoBylaw = z.object({
  id: z.string().uuid(),
  citySlug,
  /** City-scoped number, e.g. "150-49", "2024-58". */
  numero: z.string().min(1),
  titre: z.string().nullable().default(null),
  /** Derived from the AMENDS edge (§4.2); null when the bylaw amends nothing. */
  amendsBylawId: z.string().uuid().nullable().default(null),
  rawRef,
  recon: ReconBridge,
  evidence,
});
export type OntoBylawT = z.infer<typeof OntoBylaw>;

// ─────────────────────────────────────────────────────────────────────────────
// DesignationEvent — reconciled + hardenable. PPCMOI/CPTAQ/dérogation/intention
// are V1 SUBTYPES (§1.1 deferral note, §7.1), promoted to dedicated nodes in V2.
// ─────────────────────────────────────────────────────────────────────────────
export const DesignationEventSubtype = z.enum([
  "rezoning",
  "split",
  "rename",
  "merge",
  "lot-subdivision",
  "ppcmoi",
  "cptaq",
  "minor-variance",
  "intention", // weak signal: "the city is open to densifying this sector" (D6)
  "precedent", // a PPCMOI invoked as a regulatory precedent (D6)
]);
export type DesignationEventSubtypeT = z.infer<typeof DesignationEventSubtype>;
export const OntoDesignationEvent = z.object({
  id: z.string().uuid(),
  citySlug,
  subtype: DesignationEventSubtype,
  /** Regulatory effect date (adoption / entry into force); null when only proposed. */
  occurredOn: isoDateSchema.nullable().default(null),
  rawRef,
  recon: ReconBridge,
  evidence,
});
export type OntoDesignationEventT = z.infer<typeof OntoDesignationEvent>;

// ─────────────────────────────────────────────────────────────────────────────
// Constraint — source-backed (D2). Feeds the auditable risk axis via ConstraintHit.
// Reliable provincial constraints (CPTAQ/BDZI/GRHQ) are high-confidence; servitudes
// /PIIA stay `manual-check` (§4.3, §7.3).
// ─────────────────────────────────────────────────────────────────────────────
export const ConstraintKind = z.enum([
  "cptaq-zone-agricole",
  "bdzi-inondable",
  "grhq-hydro",
  "bande-riveraine",
  "milieu-humide",
  "servitude",
  "piia",
  "patrimoine",
  "autre",
]);
export type ConstraintKindT = z.infer<typeof ConstraintKind>;
export const ConstraintConfidence = z.enum(["high", "medium", "low", "manual-check"]);
export type ConstraintConfidenceT = z.infer<typeof ConstraintConfidence>;
export const OntoConstraint = z.object({
  id: z.string().uuid(),
  citySlug,
  kind: ConstraintKind,
  /** Provenance authority: CPTAQ / BDZI / GRHQ / municipal. */
  source: z.string().min(1),
  observedOn: isoDateSchema.nullable().default(null),
  confidence: ConstraintConfidence.default("manual-check"),
  rawRef,
  /** Citation obligatoire (evidence_policy lists Constraint, §1.3): ≥1 ref. */
  evidence: z.array(EvidenceItem).min(1),
  ...geoFields,
});
export type OntoConstraintT = z.infer<typeof OntoConstraint>;

// ─────────────────────────────────────────────────────────────────────────────
// Lot — registry (`cadastre`, NO_LOT authoritative) + light reconciliation of
// PDF graphies. Province-wide key, but carries citySlug for filtering (§4.6).
// ─────────────────────────────────────────────────────────────────────────────
export const OntoLot = z.object({
  id: z.string().uuid(),
  /** Authoritative cadastre key (cadastre du Québec), e.g. "3819015". */
  noLot: z.string().min(1),
  citySlug,
  rawRef,
  recon: ReconBridge,
  evidence,
  ...geoFields,
});
export type OntoLotT = z.infer<typeof OntoLot>;

// ─────────────────────────────────────────────────────────────────────────────
// Adresse — registry (`adresses_qc`), province-wide key. LOCATED_AT links lots.
// ─────────────────────────────────────────────────────────────────────────────
export const OntoAdresse = z.object({
  id: z.string().uuid(),
  /** Adresses Québec provincial key. */
  idAdresse: z.string().min(1),
  adresseComplete: z.string().min(1),
  citySlug,
  /** LOCATED_AT projection (Lot ↔ Adresse). */
  lotIds: z.array(z.string().uuid()).default([]),
  rawRef,
  recon: ReconBridge,
  evidence,
  ...geoFields,
});
export type OntoAdresseT = z.infer<typeof OntoAdresse>;

// ─────────────────────────────────────────────────────────────────────────────
// Valuation — registry (`role`) / derived. Attached per lot/matricule (§1.2 VALUED_BY).
// `owner` is PII excluded from the graph: always non-disponible / manual-check (§7.4).
// ─────────────────────────────────────────────────────────────────────────────
export const ValuationSourceKind = z.enum(["role", "market-estimate"]);
export type ValuationSourceKindT = z.infer<typeof ValuationSourceKind>;
export const OwnerStatus = z.enum(["non-disponible", "manual-check"]);
export type OwnerStatusT = z.infer<typeof OwnerStatus>;
export const OntoValuation = z.object({
  id: z.string().uuid(),
  /** Role evaluation matricule (per-lot key). */
  matricule: z.string().min(1),
  /** Lot the valuation attaches to (VALUED_BY is per lot/matricule, not per zone). */
  lotId: z.string().uuid(),
  citySlug,
  sourceKind: ValuationSourceKind,
  /** Land value in CAD; null when not chiffré (anti-invention). */
  valeur: z.number().nonnegative().nullable().default(null),
  valuedOn: isoDateSchema.nullable().default(null),
  /** Owner is PII, never a node (LFM 72 + Loi 25): explicitly unavailable (§7.4). */
  owner: OwnerStatus.default("non-disponible"),
  rawRef,
  recon: ReconBridge,
  evidence,
});
export type OntoValuationT = z.infer<typeof OntoValuation>;

// ─────────────────────────────────────────────────────────────────────────────
// Source (Document) — source_backed, the evidence carrier. Points at the S3 raw
// key; never re-fetched on re-extraction (§0.2).
// ─────────────────────────────────────────────────────────────────────────────
export const SourceDocKind = z.enum([
  "avis-public",
  "reglement",
  "ppcmoi",
  "proces-verbal",
  "grille-zonage",
  "plan-urbanisme",
  "role-evaluation",
  "cadastre",
  "adresses-qc",
  "cptaq",
  "bdzi",
  "grhq",
  "presse",
  "video",
]);
export type SourceDocKindT = z.infer<typeof SourceDocKind>;
export const OntoSource = z.object({
  id: z.string().uuid(),
  kind: SourceDocKind,
  /** Authoritative raw S3 key (`raw/<kind>/<city>/<Y>/<M>/<D>/<sha>.<ext>`, §0.2). */
  rawRef,
  /** Originating city (null for province-wide / cross-city docs). */
  citySlug: citySlug.nullable().default(null),
  /** sha256 of the raw bytes (provenance integrity). */
  sha256: z.string().min(1).nullable().default(null),
  publishedOn: isoDateSchema.nullable().default(null),
});
export type OntoSourceT = z.infer<typeof OntoSource>;

// ─────────────────────────────────────────────────────────────────────────────
// Signal — derived watch signal incl. intentions / precedents (D6). Distinct from
// the package-level watch `Signal`; this is the ontology projection node.
// ─────────────────────────────────────────────────────────────────────────────
export const OntoSignalKind = z.enum([
  "residential-rezoning",
  "ppcmoi",
  "derogation",
  "cptaq-dezonage",
  "intention", // weak signal, capped at "surveillance" (D6)
  "precedent", // regulatory precedent, capped at "surveillance" (D6)
]);
export type OntoSignalKindT = z.infer<typeof OntoSignalKind>;
export const OntoSignal = z.object({
  id: z.string().uuid(),
  citySlug,
  kind: OntoSignalKind,
  /** The DesignationEvent that raised this signal (RAISES_SIGNAL). */
  designationEventId: z.string().uuid().nullable().default(null),
  summary: z.string().min(1),
  /**
   * Intentions/precedents are weak signals capped at "surveillance" and stay
   * `needs_review` until a direct evidence ref is attached (D6, anti-invention).
   * Enforced here: a weak signal must declare `cappedAtSurveillance: true`.
   */
  cappedAtSurveillance: z.boolean().default(false),
  rawRef,
  evidence,
}).refine(
  (s) => !(s.kind === "intention" || s.kind === "precedent") || s.cappedAtSurveillance,
  { message: "intention/precedent signals must be cappedAtSurveillance (D6)" },
);
export type OntoSignalT = z.infer<typeof OntoSignal>;
