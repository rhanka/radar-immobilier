/**
 * Focus-signal artifact cases — v2 REAL data (rework 2026-11-10).
 *
 * Provenance (each value re-checkable, see LANE-REPORT.md v2):
 * - Signals, excerpts, zones, lots, areas: preprod DB `radar_next`
 *   (read-only, SET default_transaction_read_only=on) on 2026-11-10:
 *   graph_nodes (Signal), zone_versions / lot_versions (PostGIS
 *   ST_Area / ST_Intersects). The immo MCP of this lane returned
 *   fixtures/empty for these cities, so it is NOT used as a source here.
 * - Market price: Centris community profile (public, cited inline).
 *
 * "Simulated" is ONLY the incorporation: signal<->lot link by spatial
 * intersection where the PV does not name the lot, and application of a
 * real bylaw parameter (authorised storeys read in the PV) to a real
 * lot. Missing real inputs stay explicit source-gaps, never numbers.
 */

export interface FocusLot {
  noLot: string;
  areaM2: number;
  frontageM: number | null;
  addressStreet: string | null;
  usage: string;
  /** true/false read from a source; null = source-gap (never guessed). */
  serviced: boolean | null;
  /** Lot named by the real PV text (real link) vs spatial incorporation. */
  linkedByProduct: boolean;
}

export interface FocusCase {
  signalId: string;
  citySlug: string;
  cityLabel: string;
  signalType: string;
  stage: string;
  stageDate: string;
  bylaw: string;
  summary: string;
  documentId: string;
  documentTitle: string;
  evidenceExcerpt: string;
  zoneCode: string;
  zoneUseBefore: string;
  bylawEvolutionAfter: string;
  gridBeforeAfter: string | null;
  gridSourceGap: string | null;
  lots: FocusLot[];
  medianCondoPrice: number | null;
  medianPriceSource: string | null;
  storeysAfter: number | null;
  valuationNote: string;
  /** Real centroid (zone or lot, DB geometry) for the harness map. */
  mapCenter: [number, number];
}

export const FOCUS_CASES: FocusCase[] = [
  {
    signalId: "signal-levis-densification-L0054",
    citySlug: "levis",
    cityLabel: "Lévis",
    signalType: "Modification de zonage (densification)",
    stage: "Avis de motion",
    stageDate: "2026-03-31",
    bylaw: "L0054 (numéro du règlement modificatif : source-gap)",
    summary:
      "Augmentation de la hauteur max à 4 étages/18 m dans zone L0054 — signal densification commerciale/mixte (description réelle du signal, base preprod).",
    documentId: "1839a7943a10b5043671d35cb7c78d3fe169a039dfb32525a6533973e57dbddb",
    documentTitle: "Procès-verbal — Lévis (extrait p. 21, archivé en base preprod)",
    evidenceExcerpt:
      "Ce règlement a pour objet de : • de supprimer à la grille des spécifications de la zone L0054 la limite de superficie de plancher applicable à la classe d'usages C700; • d'augmenter à 4 étages la hauteur maximale des bâtiments principaux en étages et à 18 mètres la hauteur maximale pour les classes d'usages C700 et L300 dans la grille des spécifications de la zone L0054.",
    zoneCode: "L0054",
    zoneUseBefore:
      "Grille L0054 avant modification : hauteur maximale inférieure à 4 étages et limite de superficie de plancher applicable à la classe C700 (objets de la modification, PV p. 21). Superficie de la zone en base : 947 711 m² (zone_versions).",
    bylawEvolutionAfter:
      "Hauteur maximale portée à 4 étages et 18 mètres pour les classes d'usages C700 et L300; suppression de la limite de superficie de plancher C700 (PV p. 21).",
    gridBeforeAfter: null,
    gridSourceGap:
      "Grille des spécifications L0054 (CES/COS/densité chiffrés) non ingérée dans les sources lues : aucun CES/COS affiché sans cette grille.",
    lots: [
      { noLot: "1 960 556", areaM2: 4174, frontageM: null, addressStreet: null, usage: "usage : source-gap (rôle non ingéré pour ce lot)", serviced: null, linkedByProduct: false },
      { noLot: "2 244 656", areaM2: 9139, frontageM: null, addressStreet: null, usage: "usage : source-gap (rôle non ingéré pour ce lot)", serviced: null, linkedByProduct: false },
      { noLot: "1 962 094", areaM2: 10467, frontageM: null, addressStreet: null, usage: "usage : source-gap (rôle non ingéré pour ce lot)", serviced: null, linkedByProduct: false },
    ],
    medianCondoPrice: 299000,
    medianPriceSource:
      "Centris — profil de communauté Lévis (Desjardins), prix médian condominium 299 000 $ (consulté le 2026-11-10, centris.ca/en/tools/community-profile/province-of-quebec/levis-desjardins)",
    storeysAfter: 4,
    valuationNote:
      "Lots réels intersectant la zone L0054 (PostGIS ST_Intersects, lot_versions x zone_versions) : rattachement au signal par incorporation simulée (règle : intersection spatiale avec la zone du signal). Desserte et rôle : source-gap en base pour ces lots.",
    mapCenter: [-71.3215, 46.7245],
  },
  {
    signalId: "signal-coaticook-rezonage-c416",
    citySlug: "coaticook",
    cityLabel: "Coaticook",
    signalType: "Extension de zone commerciale",
    stage: "Projet de règlement",
    stageDate: "2026-02-09",
    bylaw: "C-416 (numéro du règlement : source-gap)",
    summary:
      "Extension zone C-416 pour inclure lots 3 311 583 et 5 820 197 (ex-RB-414) et lots 4 999 198 et portion 5 820 198 (ex-P-412). Autorise usage D-6 (réparations mécaniques agricoles). 1er projet adopté 9 fév 2026, 2e projet ordre du jour 8 juin 2026 (description réelle du signal, base preprod).",
    documentId: "8c4662d38ea0060e99cd112a1116291d6bd920f93908d4e87fd42527f71660dc",
    documentTitle: "Procès-verbal — Coaticook, PV20260209 (extrait p. 23, archivé en base preprod)",
    evidenceExcerpt:
      "L'objet du présent règlement est d'agrandir la zone C-416 de l'annexe B du Règlement de zonage afin d'y inclure : les lots numéro 3 311 583 et 5 820 197, actuellement situés dans la zone RB-414; le lot numéro 4 999 198, faisant partie de la zone P-412 ; ainsi qu'une portion du lot numéro 5 820 198, également comprise dans la zone P-412",
    zoneCode: "C-416",
    zoneUseBefore:
      "Lots visés situés en zones RB-414 (49 104 m² en base) et P-412 (79 058 m² en base), superficies zone_versions.",
    bylawEvolutionAfter:
      "Agrandissement de la zone C-416 (16 851 m² en base avant extension) aux lots cités au PV; usage D-6 (réparations mécaniques agricoles) autorisé (description du signal).",
    gridBeforeAfter: null,
    gridSourceGap:
      "Grille des usages et normes C-416 (hauteurs/CES/COS) non ingérée : aucun gabarit chiffré affiché, capacité résidentielle non calculée pour un usage D-6.",
    lots: [
      { noLot: "3 311 583", areaM2: 1115, frontageM: null, addressStreet: null, usage: "ex-zone RB-414 (PV p. 23); rôle : source-gap", serviced: null, linkedByProduct: true },
      { noLot: "5 820 197", areaM2: 508, frontageM: null, addressStreet: null, usage: "ex-zone RB-414 (PV p. 23); rôle : source-gap", serviced: null, linkedByProduct: true },
      { noLot: "4 999 198", areaM2: 2111, frontageM: null, addressStreet: null, usage: "ex-zone P-412 (PV p. 23); rôle : source-gap", serviced: null, linkedByProduct: true },
      { noLot: "5 820 198", areaM2: 1136, frontageM: null, addressStreet: null, usage: "portion visée, ex-zone P-412 (PV p. 23); rôle : source-gap", serviced: null, linkedByProduct: true },
    ],
    medianCondoPrice: null,
    medianPriceSource: null,
    storeysAfter: null,
    valuationNote:
      "Lots nommés dans le texte réel du PV (lien réel, pas une incorporation). Aucun gabarit résidentiel au PV : valorisation résidentielle en source-gap, superficies réelles affichées seules.",
    mapCenter: [-71.8035, 45.1263],
  },
  {
    signalId: "signal-rosemere-rezonage-lot-3005325-2026",
    citySlug: "rosemere",
    cityLabel: "Rosemère",
    signalType: "Modification de zonage (règlement 801-70)",
    stage: "Second projet",
    stageDate: "2026-03-09",
    bylaw: "801-70",
    summary:
      "Le lot 3 005 325 est intégré à la zone C-18 du pôle commercial régional par le Règlement 801-70 (description réelle du signal, base preprod).",
    documentId: "d302f381682e55315c53888593a416938f6c0d9af2941a303b335ac6219de22f",
    documentTitle: "Procès-verbal — Rosemère, séance 2026-03-09 (extrait p. 5, archivé en base preprod)",
    evidenceExcerpt:
      "D'ADOPTER le second projet de Règlement 801-70 modifiant le règlement 801 - Zonage, afin de modifier des dispositions ainsi qu'inclure le lot 3 005 325 à la zone C-18 sans changement. ADOPTÉE À L'UNANIMITÉ.",
    zoneCode: "C-18",
    zoneUseBefore:
      "Zone C-18 — Rosemère (pôle commercial régional, nœud graphe zone-rosemere-C-18). Géométrie de la zone absente de zone_versions : source-gap géométrie.",
    bylawEvolutionAfter:
      "Inclusion du lot 3 005 325 à la zone C-18 « sans changement » des dispositions (PV p. 5) : aucun nouveau gabarit créé par ce règlement.",
    gridBeforeAfter: null,
    gridSourceGap:
      "Géométrie C-18 et grille 801 (CES/COS/hauteurs) non présentes dans les tables lues : aucun paramètre chiffré affiché.",
    lots: [
      { noLot: "3 005 325", areaM2: 4238, frontageM: null, addressStreet: null, usage: "pôle commercial régional (graphe); rôle : source-gap", serviced: null, linkedByProduct: true },
    ],
    medianCondoPrice: null,
    medianPriceSource: null,
    storeysAfter: null,
    valuationNote:
      "Lot nommé au PV et porté par le signal (no_lot réel). Règlement « sans changement » de gabarit : aucune capacité additionnelle calculée, valeur en source-gap.",
    mapCenter: [-73.8112, 45.6191],
  },
];

export const VALUATION_ASSUMPTIONS = {
  netEfficiency: 0.8,
  avgUnitM2: 85,
  label:
    "Hypothèses de calcul (incorporation simulée, inspirée LotAI : capacité théorique = superficie constructible × gabarit autorisé) : rendement net 80 % de la surface de plancher brute, logement moyen 85 m². Entrées réelles : superficie du lot (PostGIS, lot_versions), étages autorisés après changement (texte du PV), prix médian public cité (Centris).",
} as const;

export interface LotValuation {
  grossFloorM2: number | null;
  unitsAfter: number | null;
  indicativeValue: number | null;
  status: "calculee" | "source-gap";
  reason: string;
}

export function valuateLot(c: FocusCase, lot: FocusLot): LotValuation {
  if (lot.serviced === false) {
    return { grossFloorM2: null, unitsAfter: null, indicativeValue: null, status: "source-gap", reason: "Lot non desservi selon la source lue : capacité non calculée." };
  }
  if (c.storeysAfter === null) {
    return { grossFloorM2: null, unitsAfter: null, indicativeValue: null, status: "source-gap", reason: "Gabarit après changement absent des sources lues : capacité non calculée." };
  }
  const gross = lot.areaM2 * c.storeysAfter;
  const units = Math.floor((gross * VALUATION_ASSUMPTIONS.netEfficiency) / VALUATION_ASSUMPTIONS.avgUnitM2);
  return {
    grossFloorM2: gross,
    unitsAfter: units,
    indicativeValue: c.medianCondoPrice !== null ? units * c.medianCondoPrice : null,
    status: "calculee",
    reason:
      (lot.serviced === null ? "Desserte : source-gap en base (capacité affichée à titre théorique). " : "") +
      (c.medianCondoPrice !== null
        ? "Borne haute théorique (sans CES de grille) ; valeur = logements x prix médian public cité."
        : "Capacité calculée ; valeur en source-gap (aucun prix public relevé pour cette ville)."),
  };
}

export function focusCaseForSignal(signalId: string | null | undefined): FocusCase | null {
  if (!signalId) return null;
  return FOCUS_CASES.find((c) => c.signalId === signalId) ?? null;
}
