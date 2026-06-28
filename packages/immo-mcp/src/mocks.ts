/**
 * Deterministic mock fixtures for the immo MCP provider (v0).
 *
 * ANTI-PII BY CONSTRUCTION: no owner names, no contacts, no personal
 * identifiers. Lots are referenced by cadastral number + zone, signals by
 * municipal regulation, documents by public reference. This keeps the v0
 * demo offline and safe to expose through any MCP client.
 */

export interface MockLot {
  no_lot: string;
  city: string;
  zone: string;
  area_m2: number;
  frontage_m: number;
  address_street: string;
  usage: string;
  serviced: boolean;
}

export interface MockSignal {
  id: string;
  city: string;
  type: string;
  etape: string;
  etape_date: string;
  reglement_number: string;
  zone_ref: string;
  no_lot: string | null;
  summary: string;
  source_document_id: string;
}

export interface MockOpportunity {
  id: string;
  city: string;
  title: string;
  score: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  lot_refs: string[];
  signal_refs: string[];
}

export interface MockDocument {
  id: string;
  city: string;
  title: string;
  doc_type: string;
  published_at: string;
  source: string;
  archive_url: string;
  page_count: number;
}

export interface MockDocumentBody {
  id: string;
  text: string;
}

export const MOCK_LOTS: MockLot[] = [
  {
    no_lot: "6 359 591",
    city: "longueuil",
    zone: "H-203",
    area_m2: 1240,
    frontage_m: 24,
    address_street: "rue Saint-Charles Ouest",
    usage: "résidentiel basse densité",
    serviced: true,
  },
  {
    no_lot: "6 359 612",
    city: "longueuil",
    zone: "H-203",
    area_m2: 1985,
    frontage_m: 31,
    address_street: "rue Saint-Charles Ouest",
    usage: "résidentiel basse densité",
    serviced: true,
  },
  {
    no_lot: "4 102 884",
    city: "longueuil",
    zone: "C-101",
    area_m2: 760,
    frontage_m: 18,
    address_street: "boulevard Curé-Poirier",
    usage: "commercial",
    serviced: true,
  },
  {
    no_lot: "5 870 223",
    city: "valleyfield",
    zone: "H-410",
    area_m2: 3120,
    frontage_m: 42,
    address_street: "rue Victoria",
    usage: "résidentiel moyenne densité",
    serviced: false,
  },
];

export const MOCK_SIGNALS: MockSignal[] = [
  {
    id: "sig-longueuil-001",
    city: "longueuil",
    type: "modification_zonage",
    etape: "avis_motion",
    etape_date: "2026-04-14",
    reglement_number: "CO-2026-1187",
    zone_ref: "H-203",
    no_lot: "6 359 591",
    summary:
      "Avis de motion pour permettre l'habitation multifamiliale jusqu'à 4 étages dans la zone H-203.",
    source_document_id: "doc-longueuil-pv-2026-04-14",
  },
  {
    id: "sig-longueuil-002",
    city: "longueuil",
    type: "usage_conditionnel",
    etape: "adoption",
    etape_date: "2026-05-12",
    reglement_number: "USC-2026-044",
    zone_ref: "C-101",
    no_lot: "4 102 884",
    summary:
      "Adoption d'un usage conditionnel autorisant la mixité commerce/logement sur le boulevard Curé-Poirier.",
    source_document_id: "doc-longueuil-pv-2026-05-12",
  },
  {
    id: "sig-valleyfield-001",
    city: "valleyfield",
    type: "plan_amenagement",
    etape: "consultation",
    etape_date: "2026-03-02",
    reglement_number: "PPU-2026-007",
    zone_ref: "H-410",
    no_lot: "5 870 223",
    summary:
      "Programme particulier d'urbanisme en consultation visant la densification du secteur Victoria.",
    source_document_id: "doc-valleyfield-pv-2026-03-02",
  },
];

export const MOCK_OPPORTUNITIES: MockOpportunity[] = [
  {
    id: "opp-longueuil-h203",
    city: "longueuil",
    title: "Assemblage H-203 — fenêtre multifamilial 4 étages",
    score: 0.82,
    confidence: "high",
    rationale:
      "Avis de motion CO-2026-1187 ouvre le multifamilial 4 étages; deux lots contigus desservis (>3000 m² assemblés) sur la rue Saint-Charles.",
    lot_refs: ["6 359 591", "6 359 612"],
    signal_refs: ["sig-longueuil-001"],
  },
  {
    id: "opp-valleyfield-victoria",
    city: "valleyfield",
    title: "Secteur Victoria — PPU densification (consultation)",
    score: 0.58,
    confidence: "medium",
    rationale:
      "PPU-2026-007 en consultation; grand lot non desservi (3120 m²) — potentiel conditionné à l'adoption et aux services.",
    lot_refs: ["5 870 223"],
    signal_refs: ["sig-valleyfield-001"],
  },
];

export const MOCK_DOCUMENTS: MockDocument[] = [
  {
    id: "doc-longueuil-pv-2026-04-14",
    city: "longueuil",
    title: "Procès-verbal — séance ordinaire du conseil municipal",
    doc_type: "proces_verbal",
    published_at: "2026-04-14",
    source: "Ville de Longueuil",
    archive_url: "s3://radar-archive/longueuil/pv/2026-04-14.pdf",
    page_count: 18,
  },
  {
    id: "doc-longueuil-pv-2026-05-12",
    city: "longueuil",
    title: "Procès-verbal — séance ordinaire du conseil municipal",
    doc_type: "proces_verbal",
    published_at: "2026-05-12",
    source: "Ville de Longueuil",
    archive_url: "s3://radar-archive/longueuil/pv/2026-05-12.pdf",
    page_count: 22,
  },
  {
    id: "doc-valleyfield-pv-2026-03-02",
    city: "valleyfield",
    title: "Procès-verbal — assemblée de consultation publique",
    doc_type: "proces_verbal",
    published_at: "2026-03-02",
    source: "Ville de Salaberry-de-Valleyfield",
    archive_url: "s3://radar-archive/valleyfield/pv/2026-03-02.pdf",
    page_count: 12,
  },
];

/**
 * Bodies are kept short and free of personal data. They intentionally
 * contain no owner identity; `read_document_excerpt` still routes them
 * through `redact()` as a defence-in-depth measure.
 */
export const MOCK_DOCUMENT_BODIES: MockDocumentBody[] = [
  {
    id: "doc-longueuil-pv-2026-04-14",
    text:
      "Point 7.3 — Avis de motion. Le conseil donne avis de motion qu'à une séance subséquente sera adopté le règlement CO-2026-1187 modifiant le règlement de zonage afin d'autoriser, dans la zone H-203, l'habitation multifamiliale jusqu'à quatre étages. Un projet de règlement est déposé. Le conseil ordonne la tenue d'une assemblée publique de consultation.",
  },
  {
    id: "doc-longueuil-pv-2026-05-12",
    text:
      "Point 9.1 — Usage conditionnel. Le conseil adopte la résolution USC-2026-044 autorisant, à titre d'usage conditionnel, la mixité commerce et logement pour les immeubles donnant sur le boulevard Curé-Poirier, sous réserve des conditions d'intégration architecturale prévues au règlement.",
  },
  {
    id: "doc-valleyfield-pv-2026-03-02",
    text:
      "Assemblée de consultation publique relative au programme particulier d'urbanisme PPU-2026-007. Le projet vise la densification du secteur Victoria. Les personnes présentes sont invitées à formuler des commentaires. Le calendrier prévoit une adoption envisagée à l'automne, conditionnelle au prolongement des services municipaux.",
  },
];
