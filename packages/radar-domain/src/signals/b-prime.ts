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
  "commercial", "commerce", "industriel", "industrie",
]);
const RESIDENTIAL = /\b(?:residentiel(?:le)?s?|habitation|logement|multilogement|multi-logement|multifamilial(?:e)?s?|bifamilial(?:e)?s?|trifamilial(?:e)?s?|unifamilial(?:e)?s?|plurifamilial(?:e)?s?|densification|duplex|triplex|quadruplex|plex|condominium|maison de chambres|immeuble (?:residentiel|locatif|a logements)|usage mixte)\b/;
const COMMERCIAL_OR_INDUSTRIAL = /\b(?:commercial(?:e)?s?|industriel(?:le)?s?|parc industriel|zone industrielle)\b/;

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
  const completeReform = category === "refonte" || /\b(?:refonte|revision) complete\b/.test(text) ||
    instrument !== null && token(instrument) === "refonte";
  const commercialOrIndustrial =
    (category !== null && COMMERCIAL_OR_INDUSTRIAL_CATEGORIES.has(category)) ||
    COMMERCIAL_OR_INDUSTRIAL.test(text);
  const regionalCommercialPole = /\bpole commercial regional\b/.test(text);
  const residentiel = commercialOrIndustrial
    ? "non"
    : completeReform
      ? "indetermine"
      : (category !== null && RESIDENTIAL_CATEGORIES.has(category)) || RESIDENTIAL.test(text)
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
