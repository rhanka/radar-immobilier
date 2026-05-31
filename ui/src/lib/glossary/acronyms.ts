/**
 * Glossaire des acronymes du domaine immobilier québécois.
 * Chaque entrée comporte : terme, développé complet, définition concise (FR),
 * et une URL de référence autoritaire (si pertinente).
 */

export interface AcronymEntry {
  term: string;
  full: string;
  definition: string;
  url?: string;
}

export const ACRONYMS: Record<string, AcronymEntry> = {
  CPTAQ: {
    term: "CPTAQ",
    full: "Commission de protection du territoire agricole du Québec",
    definition:
      "Organisme gouvernemental qui administre la Loi sur la protection du territoire et des activités agricoles (LPTA). Elle autorise ou refuse les demandes d'utilisation du territoire agricole à des fins non agricoles.",
    url: "https://www.cptaq.gouv.qc.ca",
  },
  PPCMOI: {
    term: "PPCMOI",
    full: "Projet particulier de construction, de modification ou d'occupation d'un immeuble",
    definition:
      "Mécanisme d'approbation municipal permettant, sous conditions, de réaliser un projet qui déroge aux règlements d'urbanisme en vigueur, à condition qu'il respecte les grandes orientations d'aménagement.",
  },
  PIIA: {
    term: "PIIA",
    full: "Plan d'implantation et d'intégration architecturale",
    definition:
      "Outil réglementaire municipal qui balise l'intégration visuelle et architecturale des projets de construction ou de rénovation afin d'assurer leur cohérence avec le cadre bâti et le paysage environnant.",
  },
  BDZI: {
    term: "BDZI",
    full: "Base de données des zones inondables",
    definition:
      "Référentiel géospatial provincial répertoriant les zones inondables à récurrence de 0 à 20 ans et 0 à 100 ans. Utilisé pour évaluer le risque de contrainte réglementaire liée aux plaines inondables.",
  },
  GRHQ: {
    term: "GRHQ",
    full: "Géobase du réseau hydrographique du Québec",
    definition:
      "Base de données géographique officielle du réseau hydrographique (lacs, cours d'eau) du Québec. Sert de référence pour délimiter les zones de protection des rives et du littoral.",
  },
  LPTA: {
    term: "LPTA",
    full: "Loi sur la protection du territoire et des activités agricoles",
    definition:
      "Loi québécoise encadrant l'utilisation des terres en zone agricole. Elle interdit en principe l'utilisation non agricole des terres comprises dans la zone agricole, sauf autorisation de la CPTAQ.",
  },
  PPRLPI: {
    term: "PPRLPI",
    full: "Politique de protection des rives, du littoral et des plaines inondables",
    definition:
      "Politique gouvernementale québécoise fixant les normes minimales de protection applicables aux rives, au littoral et aux plaines inondables. Elle est intégrée aux schémas d'aménagement des MRC.",
  },
  COS: {
    term: "COS",
    full: "Coefficient d'occupation du sol",
    definition:
      "Rapport entre la superficie de plancher totale d'une construction et la superficie du terrain. Un COS de 1,5 signifie que la superficie de plancher peut atteindre 1,5 fois la superficie du lot.",
  },
  OACIQ: {
    term: "OACIQ",
    full: "Organisme d'autoréglementation du courtage immobilier du Québec",
    definition:
      "Organisme qui encadre et surveille la pratique du courtage immobilier au Québec. Il protège le public en s'assurant que les courtiers respectent les lois et règlements en vigueur.",
    url: "https://www.oaciq.com",
  },
  MRC: {
    term: "MRC",
    full: "Municipalité régionale de comté",
    definition:
      "Palier de gouvernement municipal intermédiaire au Québec. La MRC coordonne l'aménagement du territoire de son secteur et élabore le schéma d'aménagement et de développement.",
  },
  PADTC: {
    term: "PADTC",
    full: "Programme d'aide au développement du transport collectif",
    definition:
      "Programme de subventions du gouvernement québécois destiné à soutenir le développement et l'amélioration des services de transport collectif sur l'ensemble du territoire provincial.",
  },
  "LOI 25": {
    term: "Loi 25",
    full: "Loi modernisant des dispositions législatives en matière de protection des renseignements personnels",
    definition:
      "Loi québécoise (anciennement projet de loi 64) qui renforce les obligations des entreprises en matière de protection des renseignements personnels, en s'alignant sur les standards internationaux (RGPD).",
  },
};

/**
 * Recherche insensible à la casse d'un acronyme dans le glossaire.
 * Retourne l'entrée correspondante ou `undefined` si l'acronyme est inconnu.
 */
export function getAcronym(term: string): AcronymEntry | undefined {
  const normalized = term.trim().toUpperCase();
  if (normalized in ACRONYMS) {
    return ACRONYMS[normalized];
  }
  // Secondary lookup: handle "Loi 25" -> "LOI 25" and similar mixed-case
  for (const key of Object.keys(ACRONYMS)) {
    if (key.toUpperCase() === normalized) {
      return ACRONYMS[key];
    }
  }
  return undefined;
}
