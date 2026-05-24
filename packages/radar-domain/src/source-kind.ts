/** Catalogue of data sources the radar can ingest (VISION §4, PROCESS Annexe B). */
export const SOURCE_KINDS = [
  "avis-publics",
  "pv",
  "video-youtube",
  "reglement",
  "zonage",
  "plan-zonage",
  "cadastre",
  "role-evaluation",
  "registre-foncier",
  "cptaq",
  "zones-inondables",
  "hydrographie",
  "adresses-quebec",
  "permis-construction",
  "donnees-quebec",
  "transactions",
  "statcan",
  "transport",
  "schema-mrc",
  "orthophotos",
] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];

export function isSourceKind(value: string): value is SourceKind {
  return (SOURCE_KINDS as readonly string[]).includes(value);
}
