/**
 * Focus-signal artifact cases — REAL data only (owner amendment 2026-11-09).
 *
 * Every value below was read on 2026-11-09 from a real source, cited inline:
 * - immo MCP (preprod read-only): `search_signals`, `search_lots`,
 *   `get_lot_card`, `read_document_excerpt` (procès-verbaux).
 * - Public market indicator: Centris community profile, Le Vieux-Longueuil
 *   (median condominium price), consulted 2026-11-09.
 *
 * What is "simulated" is ONLY the incorporation: the product does not yet
 * persist the link signal <-> zone <-> lot <-> bylaw evolution, nor the
 * application of a real bylaw to a real lot. Each such link/calculation is
 * flagged `incorporation: true` in the UI ("incorporation simulée") with
 * its rule. No lot, area, use, stage or price is invented. Where a real
 * input is missing (zoning grid CES/COS, Valleyfield price), the case
 * carries an explicit source-gap instead of a fabricated number.
 */

export interface FocusLot {
  noLot: string;
  areaM2: number;
  frontageM: number | null;
  addressStreet: string | null;
  usage: string;
  serviced: boolean;
  /** MCP `get_lot_card.related_signals` already links this lot — real link. */
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
  /** Zoning-grid parameters (CES/COS/density): null = source-gap, never invented. */
  gridBeforeAfter: string | null;
  gridSourceGap: string | null;
  lots: FocusLot[];
  /** Public median condo price (CAD) used by the valuation; null = source-gap. */
  medianCondoPrice: number | null;
  medianPriceSource: string | null;
  /** Authorised storeys after the change, read from the real PV text. */
  storeysAfter: number | null;
  valuationNote: string;
}

export const FOCUS_CASES: FocusCase[] = [
  {
    signalId: "sig-longueuil-001",
    citySlug: "longueuil",
    cityLabel: "Longueuil",
    signalType: "Modification de zonage",
    stage: "Avis de motion",
    stageDate: "2026-04-14",
    bylaw: "CO-2026-1187",
    summary:
      "Avis de motion pour permettre l'habitation multifamiliale jusqu'à 4 étages dans la zone H-203.",
    documentId: "doc-longueuil-pv-2026-04-14",
    documentTitle: "Procès-verbal — séance ordinaire du conseil municipal (Longueuil)",
    evidenceExcerpt:
      "Point 7.3 — Avis de motion. Le conseil donne avis de motion qu'à une séance subséquente sera adopté le règlement CO-2026-1187 modifiant le règlement de zonage afin d'autoriser, dans la zone H-203, l'habitation multifamiliale jusqu'à quatre étages. Un projet de règlement est déposé. Le conseil ordonne la tenue d'une assemblée publique de consultation.",
    zoneCode: "H-203",
    zoneUseBefore: "Résidentiel basse densité (usage actuel des lots, MCP get_lot_card)",
    bylawEvolutionAfter:
      "Habitation multifamiliale jusqu'à 4 étages autorisée (projet de règlement déposé, PV point 7.3)",
    gridBeforeAfter: null,
    gridSourceGap:
      "Grille des usages et normes H-203 non ingérée : source publique = grilles de spécifications, Ville de Longueuil (Données Québec, jeu 183ae98e). Aucun CES/COS affiché sans cette grille.",
    lots: [
      {
        noLot: "6 359 591",
        areaM2: 1240,
        frontageM: 24,
        addressStreet: "rue Saint-Charles Ouest",
        usage: "résidentiel basse densité",
        serviced: true,
        linkedByProduct: true,
      },
      {
        noLot: "6 359 612",
        areaM2: 1985,
        frontageM: 31,
        addressStreet: "rue Saint-Charles Ouest",
        usage: "résidentiel basse densité",
        serviced: true,
        linkedByProduct: false,
      },
    ],
    medianCondoPrice: 398500,
    medianPriceSource:
      "Centris — profil de quartier Le Vieux-Longueuil, prix médian condominium 398 500 $ (consulté le 2026-11-09, centris.ca/en/tools/community-profile/montreal-south-shore/longueuil-le-vieux-longueuil)",
    storeysAfter: 4,
    valuationNote:
      "Lot 6 359 612 : même zone H-203 (MCP search_lots), rattachement au signal par incorporation simulée (règle : même zone que le signal). Lot 6 359 591 : lien déjà porté par le produit (related_signals).",
  },
  {
    signalId: "sig-valleyfield-001",
    citySlug: "valleyfield",
    cityLabel: "Salaberry-de-Valleyfield",
    signalType: "Plan d'aménagement (PPU)",
    stage: "Consultation",
    stageDate: "2026-03-02",
    bylaw: "PPU-2026-007",
    summary:
      "Programme particulier d'urbanisme en consultation visant la densification du secteur Victoria.",
    documentId: "doc-valleyfield-pv-2026-03-02",
    documentTitle: "Procès-verbal — assemblée de consultation publique (Valleyfield)",
    evidenceExcerpt:
      "Assemblée de consultation publique relative au programme particulier d'urbanisme PPU-2026-007. Le projet vise la densification du secteur Victoria. Les personnes présentes sont invitées à formuler des commentaires. Le calendrier prévoit une adoption envisagée à l'automne, conditionnelle au prolongement des services municipaux.",
    zoneCode: "H-410",
    zoneUseBefore: "Résidentiel moyenne densité (usage actuel du lot, MCP get_lot_card)",
    bylawEvolutionAfter:
      "Densification du secteur Victoria envisagée à l'automne, conditionnelle au prolongement des services municipaux (PV de consultation)",
    gridBeforeAfter: null,
    gridSourceGap:
      "Grille H-410 et paramètres du PPU non publiés dans les sources lues : aucun paramètre chiffré affiché.",
    lots: [
      {
        noLot: "5 870 223",
        areaM2: 3120,
        frontageM: 42,
        addressStreet: "rue Victoria",
        usage: "résidentiel moyenne densité",
        serviced: false,
        linkedByProduct: true,
      },
    ],
    medianCondoPrice: null,
    medianPriceSource: null,
    storeysAfter: null,
    valuationNote:
      "Lot non desservi (MCP) et adoption conditionnelle aux services : capacité et valeur restent en source-gap, aucun montant affiché.",
  },
];

/** Valuation assumptions — calculation hypotheses, displayed in the UI. */
export const VALUATION_ASSUMPTIONS = {
  netEfficiency: 0.8,
  avgUnitM2: 85,
  label:
    "Hypothèses de calcul (incorporation simulée, inspirée LotAI : capacité théorique = superficie constructible × gabarit autorisé) : rendement net 80 % de la surface de plancher brute, logement moyen 85 m². Entrées réelles : superficie du lot (MCP), étages autorisés après changement (PV), prix médian public (Centris).",
} as const;

export interface LotValuation {
  grossFloorM2: number | null;
  unitsAfter: number | null;
  indicativeValue: number | null;
  status: "calculee" | "source-gap";
  reason: string;
}

/**
 * Theoretical capacity of ONE real lot under the real bylaw change.
 * Returns a source-gap (no number) when a real input is missing.
 */
export function valuateLot(c: FocusCase, lot: FocusLot): LotValuation {
  if (!lot.serviced) {
    return {
      grossFloorM2: null,
      unitsAfter: null,
      indicativeValue: null,
      status: "source-gap",
      reason: "Lot non desservi (donnée MCP) : capacité non calculée.",
    };
  }
  if (c.storeysAfter === null) {
    return {
      grossFloorM2: null,
      unitsAfter: null,
      indicativeValue: null,
      status: "source-gap",
      reason: "Gabarit après changement absent des sources lues : capacité non calculée.",
    };
  }
  // Footprint proxy without an ingested CES: one storey plate is capped by
  // the lot itself; gross floor = area x storeys is an UPPER bound, labelled
  // as such. Net units use the displayed assumptions.
  const gross = lot.areaM2 * c.storeysAfter;
  const units = Math.floor((gross * VALUATION_ASSUMPTIONS.netEfficiency) / VALUATION_ASSUMPTIONS.avgUnitM2);
  return {
    grossFloorM2: gross,
    unitsAfter: units,
    indicativeValue: c.medianCondoPrice !== null ? units * c.medianCondoPrice : null,
    status: "calculee",
    reason:
      c.medianCondoPrice !== null
        ? "Borne haute théorique (sans CES de grille) ; valeur = logements x prix médian public cité."
        : "Capacité calculée ; valeur en source-gap (aucun prix public relevé pour cette ville).",
  };
}

export function focusCaseForSignal(signalId: string | null | undefined): FocusCase | null {
  if (!signalId) return null;
  return FOCUS_CASES.find((c) => c.signalId === signalId) ?? null;
}
