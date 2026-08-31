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
  /** Ferme vs anticipation SERVI par l'API (axe MARQUAGE, R5) — LU tel quel depuis
   *  la carte graph-signals, jamais re-classifié côté MCP : le classifieur unique
   *  (`deriveRegulatoryStatus`) vit côté serveur, le MCP consomme le champ servi
   *  (pas de dép `@radar/domain` = découplage volontaire). "anticipation" = fail-safe
   *  quand l'API ne sert pas le champ (jamais firm sans preuve servie). */
  regulatoryStatus: "firm" | "anticipation";
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
    regulatoryStatus: "anticipation",
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
    regulatoryStatus: "firm",
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
    regulatoryStatus: "anticipation",
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
 * GeoJSON fixtures for the raw-data tools (`get_zones_geojson` /
 * `get_lots_geojson` / `get_grille_pdf`). Deterministic, PII-free, aligned
 * with MOCK_LOTS (same cities/zones/lot numbers). Property spellings mirror
 * what the radar API serves:
 *  - zones: live OGC spellings (ZONE / URL_GRILLE / DENSITE) so the shared
 *    fallback readers in raw-data.ts are exercised on realistic keys;
 *  - lots: the server-side enrichment contract of
 *    api/src/routes/geo-collections.ts (zone / zoneCode / zoneJoin /
 *    multifamilial4plus / multifamilial4plusSource / superficieM2).
 * `citySlug` is a mock-only routing key (stripped nowhere: harmless extra).
 * Geometries are small distinct squares so bbox filtering is testable.
 */
export interface MockGeoFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: Record<string, unknown>;
}

function square(lon: number, lat: number, d = 0.002): number[][][] {
  return [
    [
      [lon, lat],
      [lon + d, lat],
      [lon + d, lat + d],
      [lon, lat + d],
      [lon, lat],
    ],
  ];
}

export const MOCK_ZONE_FEATURES: MockGeoFeature[] = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-73.52, 45.53, 0.01) },
    properties: {
      citySlug: "longueuil",
      ZONE: "H-203",
      DENSITE: 35,
      URL_GRILLE: "https://longueuil.example/grilles/H-203.pdf",
      kind: "H",
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-73.5, 45.51, 0.01) },
    properties: {
      citySlug: "longueuil",
      ZONE: "C-101",
      kind: "C",
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-74.13, 45.25, 0.01) },
    properties: {
      citySlug: "valleyfield",
      zone_code: "H-410",
      kind: "H",
    },
  },
];

export const MOCK_LOT_FEATURES: MockGeoFeature[] = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-73.518, 45.532) },
    properties: {
      citySlug: "longueuil",
      NO_LOT: "6 359 591",
      zoneCode: "H-203",
      zoneJoin: "code",
      zone: {
        code: "H-203",
        kind: "H",
        densiteLogHa: 35,
        usages: ["habitation"],
        grillePdfUrl: "https://longueuil.example/grilles/H-203.pdf",
      },
      multifamilial4plus: true,
      multifamilial4plusSource: "grille",
      superficieM2: 1240,
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-73.516, 45.534) },
    properties: {
      citySlug: "longueuil",
      NO_LOT: "6 359 612",
      zoneCode: "H-203",
      zoneJoin: "centroid",
      zone: {
        code: "H-203",
        kind: "H",
        densiteLogHa: 35,
        usages: ["habitation"],
        grillePdfUrl: "https://longueuil.example/grilles/H-203.pdf",
      },
      multifamilial4plus: true,
      multifamilial4plusSource: "grille",
      superficieM2: 1985,
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-73.498, 45.512) },
    properties: {
      citySlug: "longueuil",
      NO_LOT: "4 102 884",
      zoneCode: "C-101",
      zoneJoin: "code",
      zone: {
        code: "C-101",
        kind: "C",
        densiteLogHa: null,
        usages: [],
        grillePdfUrl: null,
      },
      multifamilial4plus: false,
      multifamilial4plusSource: "heuristique",
      superficieM2: 760,
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: square(-74.128, 45.252) },
    properties: {
      citySlug: "valleyfield",
      NO_LOT: "5 870 223",
      zoneCode: "H-410",
      zoneJoin: "centroid",
      multifamilial4plus: true,
      multifamilial4plusSource: "heuristique",
      superficieM2: 3120,
    },
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
