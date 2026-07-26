export type BPrimeEtape =
  | "avis_motion"
  | "projet_reglement"
  | "consultation"
  | "second_projet"
  | "adoption"
  | "entree_vigueur"
  | "accorde"
  | "refuse"
  | "inconnu";

export interface BPrimeClassification {
  etape: BPrimeEtape;
  etapeAnnotation?: { raw: string; valid: boolean };
  residentiel: "oui" | "non" | "indetermine";
  exclusionReason: "non_residentiel_franc" | "pole_commercial_regional" | null;
  provenance: { extrait: string; source?: string };
  effetDensifiant: "inconnu";
}

export interface BPrimeSignalInput {
  category?: string | null;
  label?: string | null;
  description?: string | null;
  etapeAnnotation?: string | null;
  props?: Record<string, unknown>;
  sourceRef?: string | null;
}

const ETAPES = new Set<BPrimeEtape>([
  "avis_motion", "projet_reglement", "consultation", "second_projet", "adoption",
  "entree_vigueur", "accorde", "refuse", "inconnu",
]);
const RESIDENTIAL_CATEGORIES = new Set([
  "densification", "developpement_residentiel", "logement", "logement_abordable", "habitation",
]);
const COMMERCIAL_OR_INDUSTRIAL_CATEGORIES = new Set([
  "commercial", "commerce", "commerces", "industriel", "industrie",
]);
const RESIDENTIAL = /\b(?:residentiel(?:le)?s?|habitation|logement|multilogement|multi-logement|multifamilial(?:e)?s?|bifamilial(?:e)?s?|trifamilial(?:e)?s?|unifamilial(?:e)?s?|plurifamilial(?:e)?s?|densification|duplex|triplex|quadruplex|plex|condominium|maison de chambres|immeuble (?:residentiel|locatif|a logements)|usage mixte)\b/;

/**
 * Vocabulaire FRANC non-résidentiel (commercial / industriel / enseigne),
 * SOURCE PARTAGÉE — texte NORMALISÉ (minuscule, sans accents). Réutilisé
 * verbatim côté serveur (`graph-store.NON_RESIDENTIEL_MARKERS_RE`,
 * `vivier-v2` R3) ET ici dans `classifyBPrime`, pour rester SYNCHRONISÉS.
 *
 * Le pluriel « commerciaux » (contre-exemple réel Lavaltrie, zone C-8 « usages
 * commerciaux »), « commerciale(s) », « industriel(le)(s) » et les variantes
 * d'affichage (enseigne, affichage, panneau-réclame) sont explicitement
 * couverts — c'était le trou lexical R3 relevé en revue.
 */
export const FRANC_NON_RESIDENTIEL_SOURCE =
  "commerce(?:s)?|commercia(?:ux|l(?:es?)?)|industriel(?:les?|s)?|centre commercial|parc industriel|zone industrielle|enseignes?|affichages?|panneaux?[- ]?reclames?";
export const FRANC_NON_RESIDENTIEL_RE = new RegExp(`\\b(?:${FRANC_NON_RESIDENTIEL_SOURCE})\\b`);
/** Pôle commercial régional — raison d'exclusion NOMMÉE (R4), source partagée. */
export const REGIONAL_COMMERCIAL_POLE_RE = /\bpole commercial regional\b/;
const COMMERCIAL_OR_INDUSTRIAL = FRANC_NON_RESIDENTIEL_RE;

/**
 * Strong residential evidence shared with `vivier-v2` for the R3 decision.
 * Concrete housing markers, mixed use, and explicit conversion to residential
 * use override a frank commercial marker. Bare “densification” and
 * “residential” remain deliberately weak: they occur in commercial-only
 * phrases and must not rescue a signal without a real residential use.
 */
export const RESIDENTIEL_FORT_SOURCE =
  "habitations?|logements?|multi[- ]?logements?|multifamilial(?:e)?s?|bifamilial(?:e)?s?|trifamilial(?:e)?s?|unifamilial(?:e)?s?|plurifamilial(?:e)?s?|duplex|triplex|quadruplex|plex|condominiums?|maison de chambres|immeuble (?:residentiel|locatif|a logements)|usage mixte|(?:conversion|transformation|changement d usage|passage)[\\s\\S]{0,120}?\\b(?:vers|a|au|en|pour)\\s+(?:un\\s+)?(?:usage\\s+)?residentiel(?:le)?s?";
export const RESIDENTIEL_FORT_RE = new RegExp(`\\b(?:${RESIDENTIEL_FORT_SOURCE})\\b`);
/**
 * Catégories intrinsèquement résidentielles FORTES = `RESIDENTIAL_CATEGORIES`
 * moins « densification » (marqueur faible). Partagé avec `vivier-v2`.
 */
export const RESIDENTIEL_FORT_CATEGORIES: readonly string[] = [
  "developpement_residentiel", "logement", "logement_abordable", "habitation",
];
const RESIDENTIEL_FORT_CATEGORIES_SET = new Set(RESIDENTIEL_FORT_CATEGORIES);

function fold(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function firstString(records: readonly Record<string, unknown>[], keys: readonly string[]): string | null {
  for (const item of records) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return null;
}

function firstStringValue(records: readonly Record<string, unknown>[], keys: readonly string[]): string | null {
  for (const item of records) {
    for (const key of keys) {
      const value = item[key];
      if (typeof value === "string") return value;
    }
  }
  return null;
}

function token(value: string): string {
  return fold(value.trim()).replace(/[ -]+/g, "_");
}

function normalizedEtape(value: string): BPrimeEtape | null {
  const normalized = token(value) === "consultation_publique" ? "consultation" : token(value);
  return ETAPES.has(normalized as BPrimeEtape) ? normalized as BPrimeEtape : null;
}

function deriveEtape(label: string | null | undefined, description: string | null | undefined): BPrimeEtape {
  const text = fold(`${label ?? ""} ${description ?? ""}`);
  if (text.includes("avis de motion") || text.includes("avis d motion")) return "avis_motion";
  if (text.includes("second projet") || text.includes("2e projet") || text.includes("deuxieme projet")) return "second_projet";
  if (text.includes("premier projet") || text.includes("1er projet") || text.includes("projet de reglement") || text.includes("projet du reglement")) return "projet_reglement";
  if (text.includes("consultation")) return "consultation";
  if (text.includes("entree en vigueur") || text.includes("entre en vigueur") || text.includes("en vigueur")) return "entree_vigueur";
  if (text.includes("adoption") || text.includes("adopte") || text.includes("adoptee")) return "adoption";
  if (text.includes("accordee") || text.includes("accorde") || text.includes("autorise") || text.includes("autorisee")) return "accorde";
  if (text.includes("refuse") || text.includes("refusee") || text.includes("rejete") || text.includes("rejetee")) return "refuse";
  return "inconnu";
}

export function classifyBPrime(input: BPrimeSignalInput): BPrimeClassification {
  const props = record(input.props);
  const properties = record(props.properties);
  const records = [properties, props];
  const categoryRaw = input.category ?? firstString(records, ["category"]);
  const category = categoryRaw === null ? null : token(categoryRaw);
  const label = input.label ?? firstString(records, ["label"]);
  const description = input.description ?? firstString(records, ["description", "summary", "details"]);
  const annotationRaw = input.etapeAnnotation ?? firstStringValue(records, ["etape"]);
  const annotated = annotationRaw === null ? null : normalizedEtape(annotationRaw);
  const text = fold(`${label ?? ""} ${description ?? ""}`);
  const instrument = firstString(records, ["instrument"]);
  const completeReform = category === "refonte" ||
    /\b(?:refonte|revision)\b[\s\S]{0,30}\b(?:complete|totale|globale|generale|integrale)\b/.test(text) ||
    instrument !== null && token(instrument) === "refonte";
  const commercialOrIndustrial =
    (category !== null && COMMERCIAL_OR_INDUSTRIAL_CATEGORIES.has(category)) ||
    COMMERCIAL_OR_INDUSTRIAL.test(text);
  const regionalCommercialPole = REGIONAL_COMMERCIAL_POLE_RE.test(text);
  // La preuve résidentielle FORTE l'emporte sur le franc-non-résidentiel :
  // l'exclusion R3 ne s'applique QUE s'il n'y a AUCUN marqueur fort (logements /
  // habitation / usage mixte / conversion vers du logement). Ainsi « rezonage de
  // commercial à résidentiel, 12 logements » et l'usage mixte restent dans B,
  // tandis que « usages commerciaux » (Lavaltrie C-8) et « densification
  // commerciale » (preuve faible seule) restent exclus.
  const hasStrongResidentiel =
    RESIDENTIEL_FORT_RE.test(text) ||
    (category !== null && RESIDENTIEL_FORT_CATEGORIES_SET.has(category));
  const hasResidentiel =
    hasStrongResidentiel ||
    (category !== null && RESIDENTIAL_CATEGORIES.has(category)) ||
    RESIDENTIAL.test(text);
  const residentiel = commercialOrIndustrial && !hasStrongResidentiel
    ? "non"
    : completeReform
      ? "indetermine"
      : hasResidentiel
        ? "oui"
        : "indetermine";
  const source = input.sourceRef ?? firstString(records, ["sourceRef", "source_ref", "rawRef", "raw_ref"]);

  return {
    etape: annotationRaw === null ? deriveEtape(label, description) : annotated ?? "inconnu",
    ...(annotationRaw !== null ? { etapeAnnotation: { raw: annotationRaw, valid: annotated !== null } } : {}),
    residentiel,
    exclusionReason: regionalCommercialPole
      ? "pole_commercial_regional"
      : residentiel === "non" ? "non_residentiel_franc" : null,
    provenance: {
      extrait: firstString(records, ["extrait", "excerpt", "citation", "quote", "text"]) ?? "",
      ...(source !== null ? { source } : {}),
    },
    // HEAD carries no pair of sourced geographic bounds for this signal.
    effetDensifiant: "inconnu",
  };
}
