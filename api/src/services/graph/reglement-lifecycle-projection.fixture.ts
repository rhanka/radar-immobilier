import { mockZoningEvent, type ZoningEventT } from "./zoning-event-mock.js";

/**
 * Fixtures for the règlement-lifecycle projection — REAL grounded events (WP2 corpus),
 * shaped to the confirmed ZoningEvent contract. Chosen to exercise the safety-critical
 * derivations: multi-stage lifecycle (predecessor by n° intersection), amends typing,
 * §9-unknown document_type, and the plan-mislabel anti-invention case.
 *
 * Contract reminders honored below:
 * - avis_motion: reglement_number EMPTY, cible = the ANNOUNCED future n° (for §4 avis→adoption).
 * - projet/adoption: reglement_number = the n° itself, cible = null; the modified BASE n° lives
 *   ONLY in libelles_relation (verbatim) — the projection TYPES amends/replaces from it.
 */

// ── sainte-martine — Règlement 2025-492 (zonage, modifie 2019-342) : 2e-projet → adoption ──
export const SM_2025_492_2E_PROJET: ZoningEventT = mockZoningEvent({
  event_id: "sm-2025-492-2e-projet",
  muni: "sainte-martine",
  document_type: "projet_reglement",
  type: "second_projet",
  reglement_number: ["2025-492"],
  cible_reglement_numero: null,
  libelles_relation: [
    "Adoption du Second projet de Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342",
  ],
  date_iso: "2025-12-15",
  url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/01/conseil-decembre-2025.pdf",
  extrait_brut: "2025-12-217 : Adoption du Second projet de Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342",
  provenance: {
    producer: "geo-mock", source_span: "2025-12-217 : Adoption du Second projet ...",
    source_url: "https://sainte-martine.ca/wp-content/uploads/2026/01/conseil-decembre-2025.pdf",
    as_of_date: null,
    sha256: "02072d39ea0000000000000000000000000000000000000000000000000000",
    retrieved_at: "2026-06-11T22:00:00.000Z",
  },
});

export const SM_2025_492_ADOPTION: ZoningEventT = mockZoningEvent({
  event_id: "sm-2025-492-adoption",
  muni: "sainte-martine",
  document_type: "adoption",
  reglement_number: ["2025-492"],
  cible_reglement_numero: null,
  bylaw_numero: "2025-492",
  libelles_relation: [
    "Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342 afin de permettre certains usages commerciaux para-agricoles en zone AD-18",
  ],
  date_iso: "2026-01-12",
  url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-janvier-2026.pdf",
  extrait_brut: "2026-01-012 : Adoption du Règlement numéro 2025-492 modifiant le Règlement de zonage numéro 2019-342 ...",
  provenance: {
    producer: "geo-mock", source_span: "2026-01-012 : Adoption du Règlement numéro 2025-492 ...",
    source_url: "https://sainte-martine.ca/wp-content/uploads/2026/02/conseil-janvier-2026.pdf",
    as_of_date: null,
    sha256: "1a7754f5318ca92e649f73dfec983bb7ec6edb22ebde41801f1a53227795d210",
    retrieved_at: "2026-06-11T21:54:21.807Z",
  },
});

// ── sainte-martine — Règlement 2026-511 (zonage) : avis de motion → 2e-projet ──
export const SM_2026_511_AVIS: ZoningEventT = mockZoningEvent({
  event_id: "sm-2026-511-avis",
  muni: "sainte-martine",
  document_type: "avis_motion",
  reglement_number: [],
  cible_reglement_numero: "2026-511", // §1/§4 announced future n°
  libelles_relation: [
    "Avis de motion du Règlement numéro 2026-511 modifiant le Règlement de zonage numéro 2019-342",
  ],
  date_iso: "2026-04-14",
  url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
  extrait_brut: "Avis de motion du Règlement numéro 2026-511 modifiant le Règlement de zonage numéro 2019-342 ...",
  provenance: {
    producer: "geo-mock", source_span: "Avis de motion du Règlement numéro 2026-511 ...",
    source_url: "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
    as_of_date: null,
    sha256: "5ddc6edab1bb7911761e47f9714151e6da4971f8152f7c59e4d057197a779a18",
    retrieved_at: "2026-06-11T21:53:52.454Z",
  },
});

export const SM_2026_511_2E_PROJET: ZoningEventT = mockZoningEvent({
  event_id: "sm-2026-511-2e-projet",
  muni: "sainte-martine",
  document_type: "projet_reglement",
  type: "second_projet",
  reglement_number: ["2026-511"],
  cible_reglement_numero: null,
  libelles_relation: [
    "Second projet de Règlement numéro 2026-511 modifiant le Règlement de zonage numéro 2019-342",
  ],
  date_iso: "2026-05-12",
  url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/06/conseil-mai-2026.pdf",
  extrait_brut: "Que le Second projet de Règlement numéro 2026-511 modifiant le Règlement de zonage numéro 2019-342 ...",
  provenance: {
    producer: "geo-mock", source_span: "Que le Second projet de Règlement numéro 2026-511 ...",
    source_url: "https://sainte-martine.ca/wp-content/uploads/2026/06/conseil-mai-2026.pdf",
    as_of_date: null,
    sha256: "54d3d536ef0000000000000000000000000000000000000000000000000000",
    retrieved_at: "2026-06-11T21:55:00.000Z",
  },
});

// ── cowansville — Règlement 1841-52-2026 (zonage, modifie 1841) : adoption, autre-muni ──
export const COW_1841_52_ADOPTION: ZoningEventT = mockZoningEvent({
  event_id: "cow-1841-52-adoption",
  muni: "cowansville",
  document_type: "adoption",
  reglement_number: ["1841-52-2026"],
  cible_reglement_numero: null,
  bylaw_numero: "1841-52-2026",
  libelles_relation: [
    "Adoption du règlement numéro 1841-52-2026 modifiant le règlement de zonage numéro 1841 afin de relocaliser l'usage de classe C53",
  ],
  date_iso: "2026-04-07",
  url_pdf: "https://www.cowansville.ca/storage/app/media/vie-municipale/democratie/proces-verbaux/2026/pv_seance_2026-04-07.pdf",
  extrait_brut: "Adoption du règlement numéro 1841-52-2026 modifiant le règlement de zonage numéro 1841 ...",
  provenance: {
    producer: "geo-mock", source_span: "Adoption du règlement numéro 1841-52-2026 ...",
    source_url: "https://www.cowansville.ca/storage/app/media/vie-municipale/democratie/proces-verbaux/2026/pv_seance_2026-04-07.pdf",
    as_of_date: null,
    sha256: "5e59b2409ba32f6631e58508dde455a81fba6ac3a28bfdaa5bfd7128b820414b",
    retrieved_at: "2026-06-11T23:53:20.445Z",
  },
});

// ── candiac — Règlement 5000-076 (zonage, création zone P-447) : SECOND_PROJET (§9-unknown), NO cible ──
export const CAN_5000_076_SECOND_PROJET: ZoningEventT = mockZoningEvent({
  event_id: "can-5000-076-second-projet",
  muni: "candiac",
  document_type: "second_projet", // §9-tolerated unknown value
  reglement_number: ["5000-076"],
  cible_reglement_numero: null,
  libelles_relation: [
    "Règlement 5000-076 modifiant le Règlement de zonage afin de créer la zone P-447",
  ],
  date_iso: "2026-05-25",
  url_pdf: "https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_NON_APPROUVE.pdf",
  extrait_brut: "QUE soit adopté le second projet de règlement intitulé : Règlement 5000-076 modifiant le Règlement de zonage afin de créer la zone P-447 ...",
  provenance: {
    producer: "geo-mock", source_span: "QUE soit adopté le second projet ... Règlement 5000-076 ...",
    source_url: "https://candiac.ca/uploads/Documents/Juridiques/2026/2026-05-25/2026-05-25_pv_NON_APPROUVE.pdf",
    as_of_date: null,
    sha256: "7eb37e07312fc273a0087a9d646b1b79621063a1bf711b19fef98e7b9c644e24",
    retrieved_at: "2026-06-12T00:22:41.804Z",
  },
});

// ── PLAN-MISLABEL anti-invention fixture — sainte-martine 2026-509 modifies the PLAN (2019-341),
//    NOT the zonage. Must NOT be projected as a zonage change (D9). Kept out-of-scope until owner §1. ──
export const SM_2026_509_PLAN_AVIS: ZoningEventT = mockZoningEvent({
  event_id: "sm-2026-509-plan-avis",
  muni: "sainte-martine",
  document_type: "avis_motion",
  reglement_number: [],
  cible_reglement_numero: "2026-509",
  libelles_relation: [
    "Avis de motion du Règlement numéro 2026-509 modifiant le Règlement numéro 2019-341 concernant le plan d'urbanisme afin d'agrandir l'aire d'affectation Mixte villageoise",
  ],
  date_iso: "2026-04-14",
  url_pdf: "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
  extrait_brut: "Avis de motion du Règlement numéro 2026-509 modifiant le Règlement numéro 2019-341 concernant le plan d'urbanisme ...",
  provenance: {
    producer: "geo-mock", source_span: "Avis de motion du Règlement numéro 2026-509 ... plan d'urbanisme ...",
    source_url: "https://sainte-martine.ca/wp-content/uploads/2026/05/conseil-avril-2026.pdf",
    as_of_date: null,
    sha256: "5ddc6edab1bb7911761e47f9714151e6da4971f8152f7c59e4d057197a779a18",
    retrieved_at: "2026-06-11T21:53:52.454Z",
  },
});

/** The sainte-martine 2025-492 two-stage lifecycle (2e-projet → adoption) — predecessor by n° 2025-492. */
export const SM_2025_492_LIFECYCLE: ZoningEventT[] = [SM_2025_492_2E_PROJET, SM_2025_492_ADOPTION];
/** The sainte-martine 2026-511 lifecycle (avis → 2e-projet) — predecessor by n° 2026-511. */
export const SM_2026_511_LIFECYCLE: ZoningEventT[] = [SM_2026_511_AVIS, SM_2026_511_2E_PROJET];

/** All in-scope ZONAGE fixtures (PLAN 2026-509 excluded — frozen until owner §1). */
export const ZONAGE_FIXTURES: ZoningEventT[] = [
  ...SM_2025_492_LIFECYCLE,
  ...SM_2026_511_LIFECYCLE,
  COW_1841_52_ADOPTION,
  CAN_5000_076_SECOND_PROJET,
];
