export type VisionAlignment =
  | "regulatory-signal"
  | "parcel-anchor"
  | "constraint-filter"
  | "market-validation"
  | "strategic-context"
  | "history-learning"
  | "false-positive-control";

export type AccessMode =
  | "public-free"
  | "public-api"
  | "account-free"
  | "paid-access"
  | "partner-feed"
  | "manual-paid"
  | "client-or-municipal-access";

export type CostLevel =
  | "none"
  | "low-variable"
  | "medium-variable"
  | "quote-required"
  | "manual-fee";

export type RecommendationKind =
  | "build-now"
  | "build-later"
  | "qualify-access-now"
  | "manual-check"
  | "drop-phase-1";

export type Quadrant =
  | "high-value-low-complexity"
  | "high-value-high-complexity"
  | "low-value-low-complexity"
  | "low-value-high-complexity";

export interface ConcreteEvidence {
  label: string;
  href: string;
  detail: string;
}

export interface SourceEvaluation {
  id: string;
  name: string;
  family: string;
  visionAlignment: VisionAlignment[];
  accessMode: AccessMode;
  costLevel: CostLevel;
  costNotes: string;
  weakSignalValue: number;
  precisionValue: number;
  recallValue: number;
  falsePositiveControl: number;
  historyLearningValue: number;
  businessValue: number;
  technicalComplexity: number;
  accessComplexity: number;
  legalComplexity: number;
  costComplexity: number;
  recommendation: RecommendationKind;
  done: string[];
  next: string[];
  clientExpected: string[];
  concreteEvidence: ConcreteEvidence[];
  auditFor: string;
  auditAgainst: string;
}

export interface RecommendationSummary {
  buildNow: number;
  buildLater: number;
  qualifyAccessNow: number;
  manualCheck: number;
  dropPhase1: number;
}

export interface CriteriaReference {
  label: string;
  href: string;
}

export interface CriteriaDefinition {
  id: string;
  label: string;
  explanation: string;
  references?: CriteriaReference[];
}

export const criteriaDefinitions: CriteriaDefinition[] = [
  {
    id: "PPCMOI",
    label: "PPCMOI",
    explanation:
      "Projet particulier de construction, de modification ou d'occupation d'un immeuble : une voie dérogatoire négociée qui peut révéler une densification avant même que le zonage ne soit modifié.",
    references: [
      {
        label: "MAMH — guide PPCMOI",
        href: "https://www.mamh.gouv.qc.ca/amenagement-du-territoire/guide-la-prise-de-decision-en-urbanisme/reglementation/projet-particulier-de-construction-de-modification-ou-doccupation-dun-immeuble-ppcmoi/",
      },
    ],
  },
  {
    id: "signal-faible",
    label: "Signal faible",
    explanation:
      "Indice précoce qu'une asymétrie réglementaire ou de marché est en train de se former, avant qu'elle ne devienne évidente pour le marché.",
  },
  {
    id: "precision",
    label: "Précision",
    explanation:
      "Capacité à pointer un secteur, une adresse, un lot, un numéro de règlement, un dossier ou un projet concret plutôt qu'une tendance vague.",
  },
  {
    id: "rappel",
    label: "Rappel",
    explanation:
      "Capacité à ne pas manquer de signaux pertinents à travers les archives, variantes, synonymes, vidéos, PDF et documents de suivi.",
  },
  {
    id: "faux-positif",
    label: "Faux positif",
    explanation:
      "Valeur d'une source pour rétrograder des opportunités séduisantes mais bloquées, trop bruitées ou sans lien réel avec la densification.",
  },
  {
    id: "friction-acces",
    label: "Friction d'accès",
    explanation:
      "Création de compte, quotas d'API, paywalls, contrats fournisseurs, exports municipaux ou démarches manuelles requis avant toute automatisation.",
  },
  {
    id: "risque-legal",
    label: "Risque légal",
    explanation:
      "Contraintes de conditions d'utilisation, de licence, de vie privée, d'automatisation de paiement, de réutilisation de preuves et d'interprétation juridique.",
  },
  {
    id: "complexite-cout",
    label: "Complexité coût",
    explanation:
      "Abonnements, frais de documents manuels, transcription, stockage, OCR/LLM et effort de négociation fournisseur.",
  },
  {
    id: "CPTAQ",
    label: "CPTAQ",
    explanation:
      "Commission de protection du territoire agricole du Québec : couche de contrainte et de réduction de risque pour les impacts en zone agricole.",
    references: [
      { label: "CPTAQ — site officiel", href: "https://www.cptaq.gouv.qc.ca/" },
    ],
  },
  {
    id: "MAMH",
    label: "MAMH",
    explanation:
      "Ministère des Affaires municipales et de l'Habitation : publie les fichiers du rôle d'évaluation et des jeux de données de référence municipaux.",
    references: [
      { label: "MAMH — site officiel", href: "https://www.mamh.gouv.qc.ca/" },
    ],
  },
  {
    id: "MRC",
    label: "MRC",
    explanation:
      "Municipalité régionale de comté : les documents de planification régionale expliquent l'expansion, les contraintes et l'orientation à long terme d'un secteur.",
    references: [
      {
        label: "MRC de Beauharnois-Salaberry",
        href: "https://www.mrc-beauharnois-salaberry.com/",
      },
    ],
  },
  {
    id: "BDZI",
    label: "BDZI",
    explanation:
      "Base de données des zones inondables : contexte de risque d'inondation utilisé pour éviter les faux positifs sur des sites par ailleurs attractifs.",
    references: [
      {
        label: "Québec — zones inondables",
        href: "https://www.quebec.ca/securite-situations-urgence/urgences-sinistres-risques-naturels/inondation/zones-inondables",
      },
    ],
  },
  {
    id: "GRHQ",
    label: "GRHQ",
    explanation:
      "Géobase du réseau hydrographique du Québec : contexte hydrographique pour les bandes riveraines et les vérifications réglementaires locales.",
    references: [
      {
        label: "Données Québec — GRHQ",
        href: "https://www.donneesquebec.ca/recherche/dataset/grhq",
      },
    ],
  },
  {
    id: "CKAN",
    label: "CKAN",
    explanation:
      "Modèle d'API de catalogue de données ouvertes utilisé par Données Québec pour découvrir des jeux de données et résoudre leurs ressources.",
    references: [
      { label: "Données Québec", href: "https://www.donneesquebec.ca/" },
    ],
  },
  {
    id: "WMS/WFS",
    label: "WMS/WFS",
    explanation:
      "Services web géospatiaux (couches cartographiques et entités) ; utiles pour les contraintes sans télécharger de gros fichiers.",
    references: [
      { label: "OGC — standards WMS/WFS", href: "https://www.ogc.org/standards/" },
    ],
  },
  {
    id: "GTFS",
    label: "GTFS",
    explanation:
      "General Transit Feed Specification : données de transport en commun utiles pour le contexte d'accessibilité, pas un signal réglementaire.",
    references: [{ label: "GTFS — spécification", href: "https://gtfs.org/" }],
  },
  {
    id: "MLS",
    label: "MLS / SIA",
    explanation:
      "Multiple Listing Service (Système inter-agences) : forte valeur marché si licencié, mais le scraping des inscriptions publiques n'est pas une voie acceptable en Phase 1.",
    references: [{ label: "Centris", href: "https://www.centris.ca/" }],
  },
];

const cityPage = (path: string) => `https://www.ville.valleyfield.qc.ca/${path}`;

export const sourceEvaluations: SourceEvaluation[] = [
  {
    id: "avis-publics-valleyfield",
    name: "Avis publics - Valleyfield",
    family: "Municipal signal",
    visionAlignment: ["regulatory-signal", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public municipal page; storage/OCR/LLM costs only.",
    weakSignalValue: 5,
    precisionValue: 4,
    recallValue: 5,
    falsePositiveControl: 2,
    historyLearningValue: 5,
    businessValue: 5,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-now",
    done: [
      "BR05 identified real Valleyfield public notices for derogations, PPCMOI, consultations, registers, and referendum approval.",
    ],
    next: [
      "Build BR07 list/fetch/hash/PDF extraction and classify notices against the VISION densification priorities.",
    ],
    clientExpected: [
      "Confirm that early municipal notice detection is the first proposal proof point.",
      "Set tolerance for alert noise so minor derogations such as sheds, fences, and small accessory items do not flood the radar.",
    ],
    concreteEvidence: [
      {
        label: "Avis publics page",
        href: cityPage("avis-publics"),
        detail:
          "Public HTML archive with PDF notices including PPCMOI and zoning amendment notices.",
      },
    ],
    auditFor:
      "Best first weak-signal source: it is official, current, public, and directly tied to zoning/PPCMOI events.",
    auditAgainst:
      "Not enough alone: titles and PDFs can hide the real impact behind bylaw numbers and need linking to regulations.",
  },
  {
    id: "reglements-urbanisme-valleyfield",
    name: "Reglements d'urbanisme - Valleyfield",
    family: "Municipal context",
    visionAlignment: ["regulatory-signal", "false-positive-control"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public pages and PDFs; extraction cost only.",
    weakSignalValue: 4,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 4,
    businessValue: 5,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-now",
    done: [
      "BR05 found current and pending urbanism regulation pages with bylaw numbers and PDF attachments.",
    ],
    next: [
      "Link notice bylaw numbers to regulation pages and extract amendment chains.",
    ],
    clientExpected: [
      "Validate that the proposal should explain hidden value behind simple bylaw numbers.",
    ],
    concreteEvidence: [
      {
        label: "Reglements municipaux - urbanisme",
        href: cityPage("reglements-municipaux?cat=reglement-durbanisme&terme="),
        detail: "Public listing with categories, bylaw numbers, and PDF links.",
      },
      {
        label: "Reglements en attente",
        href: cityPage("reglements-en-attente"),
        detail: "Pending regulatory changes that may reveal active dossiers.",
      },
    ],
    auditFor:
      "High business value because it explains the real planning impact behind official notice references.",
    auditAgainst:
      "More context than alert: without avis publics it can become a slow regulatory archive crawler.",
  },
  {
    id: "ppcmoi-valleyfield",
    name: "PPCMOI - Valleyfield",
    family: "Municipal signal",
    visionAlignment: ["regulatory-signal", "parcel-anchor", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public pages/PDFs; linking and extraction cost only.",
    weakSignalValue: 5,
    precisionValue: 5,
    recallValue: 4,
    falsePositiveControl: 3,
    historyLearningValue: 5,
    businessValue: 5,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-now",
    done: [
      "BR05 identified PPCMOI framework documents, project packages, and public consultation notices.",
    ],
    next: [
      "After avis-publics extraction, reconstruct PPCMOI lifecycle by address, project number, and stage.",
    ],
    clientExpected: [
      "Confirm PPCMOI as a core Phase 1 signal for negotiated residential densification.",
    ],
    concreteEvidence: [
      {
        label: "PPCMOI municipal page",
        href: cityPage("ppcmoi"),
        detail:
          "Public PPCMOI page with framework and project material referenced in BR05 notes.",
      },
    ],
    auditFor:
      "Very strong signal: PPCMOI is explicitly a negotiated path around existing zoning.",
    auditAgainst:
      "Lifecycle states are textual and can overstate opportunity if final approval or address matching is missing.",
  },
  {
    id: "seances-conseil-valleyfield",
    name: "Seances du conseil - Valleyfield",
    family: "Municipal deliberation",
    visionAlignment: ["history-learning", "regulatory-signal"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public agendas/minutes; parsing and historical indexing cost only.",
    weakSignalValue: 4,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 5,
    businessValue: 4,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: [
      "BR05 identified council agenda/minute archive value for dossier timelines.",
    ],
    next: [
      "Build after avis publics to enrich the same dossiers and distinguish agenda intent from adopted decisions.",
    ],
    clientExpected: [
      "Confirm whether the proposal needs council-timeline reconstruction in the first client demo.",
    ],
    concreteEvidence: [
      {
        label: "Valleyfield council content",
        href: cityPage("conseil-municipal"),
        detail: "Municipal council area used to locate agendas and minutes.",
      },
    ],
    auditFor:
      "Important for historical learning: it can show how a weak signal matured across meetings.",
    auditAgainst:
      "Lower immediate alert value than avis publics and can add noise before document linking is stable.",
  },
  {
    id: "videos-youtube-conseil-valleyfield",
    name: "Videos YouTube du conseil - Valleyfield",
    family: "Municipal deliberation",
    visionAlignment: ["regulatory-signal", "history-learning"],
    accessMode: "public-api",
    costLevel: "medium-variable",
    costNotes:
      "YouTube pages/API are often free; transcript availability and speech-to-text cost still need explicit qualification by source language, channel policy, and monthly alert volume.",
    weakSignalValue: 5,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 3,
    historyLearningValue: 5,
    businessValue: 5,
    technicalComplexity: 4,
    accessComplexity: 2,
    legalComplexity: 3,
    costComplexity: 4,
    recommendation: "qualify-access-now",
    done: [
      "BR05 marked council videos as high-potential but deferred because captions, API path, and transcription cost were not qualified.",
    ],
    next: [
      "Run a YouTube-specific access audit: channel/feed discovery, caption availability, API quota, transcript quality, and per-hour transcription cost before deciding on transcription provider.",
    ],
    clientExpected: [
      "Decide whether faster-than-PV detection justifies transcription cost in Phase 1, and define the acceptable alert latency.",
      "Confirm budget appetite for YouTube API/captions/Whisper qualification before production transcription.",
    ],
    concreteEvidence: [
      {
        label: "Valleyfield public video presence",
        href: cityPage("seances-du-conseil-municipal"),
        detail:
          "Municipal meeting/video area to verify embeds and official publication timing.",
      },
    ],
    auditFor:
      "VISION explicitly values videos because they can appear before official transcripts and include unfiltered discussion.",
    auditAgainst:
      "Cost, caption availability, and terms/API constraints can make it expensive compared with PDF-first sources.",
  },
  {
    id: "avis-reglements-mrcbhs",
    name: "Avis et reglements - MRC Beauharnois-Salaberry",
    family: "Regional planning",
    visionAlignment: ["regulatory-signal", "strategic-context"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public MRC pages/PDFs; possible Cloudflare handling cost.",
    weakSignalValue: 3,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 3,
    historyLearningValue: 4,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 2,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified regional public-notice value after city sources."],
    next: [
      "Add after Valleyfield city-level avis to detect regional regulatory signals and classify Valleyfield relevance.",
    ],
    clientExpected: [
      "Confirm whether regional MRC context is part of Phase 1 proposal narrative.",
    ],
    concreteEvidence: [
      {
        label: "MRC Beauharnois-Salaberry",
        href: "https://mrc-beauharnois-salaberry.com/",
        detail: "Regional site where notices and regulation material are published.",
      },
    ],
    auditFor:
      "Regional notices can flag planning shifts before city-level details are obvious.",
    auditAgainst:
      "Signal density is lower and relevance filtering is required for Valleyfield-only demo value.",
  },
  {
    id: "schema-amenagement-mrcbhs",
    name: "Schema d'amenagement - MRCBHS",
    family: "Regional planning",
    visionAlignment: ["strategic-context", "false-positive-control"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public PDFs/maps; extraction cost only.",
    weakSignalValue: 2,
    precisionValue: 2,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 3,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified large planning PDFs as context rather than alerts."],
    next: [
      "Use as context once core municipal signals can point to sectors or addresses.",
    ],
    clientExpected: [
      "Confirm whether long-horizon regional planning is needed in the proposal pack.",
    ],
    concreteEvidence: [
      {
        label: "MRC site",
        href: "https://mrc-beauharnois-salaberry.com/",
        detail: "Source for regional planning and schema documents.",
      },
    ],
    auditFor:
      "Useful to explain expansion, urban perimeter, and constraints behind local signals.",
    auditAgainst:
      "Low alert frequency and weak direct timing signal for an early low-cost demo.",
  },
  {
    id: "seances-conseil-maires-mrcbhs",
    name: "Conseil des maires - MRCBHS",
    family: "Regional planning",
    visionAlignment: ["strategic-context", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public documents; extraction cost only.",
    weakSignalValue: 2,
    precisionValue: 2,
    recallValue: 3,
    falsePositiveControl: 3,
    historyLearningValue: 4,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified regional meeting documents as secondary context."],
    next: ["Defer until city-level dossier linking is operational."],
    clientExpected: [
      "Confirm whether MRC governance context matters for the first commercial proposal.",
    ],
    concreteEvidence: [
      {
        label: "MRC public site",
        href: "https://mrc-beauharnois-salaberry.com/",
        detail: "Regional governance source to audit for agendas/minutes.",
      },
    ],
    auditFor:
      "Can explain regional intent and policy direction around municipal dossiers.",
    auditAgainst:
      "Lower signal density than city council and likely too broad for first proposal value.",
  },
  {
    id: "donnees-quebec-catalog",
    name: "Donnees Quebec catalog",
    family: "Open-data discovery",
    visionAlignment: ["parcel-anchor", "constraint-filter", "strategic-context"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes:
      "Internal CKAN discovery plumbing for catalog, package, and resource lookup; keep this as shared infrastructure rather than a direct value source.",
    weakSignalValue: 2,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 2,
    businessValue: 2,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified CKAN package_search/package_show API endpoints."],
    next: [
      "Build a resource resolver used by MAMH roles, CPTAQ, BDZI, and other public datasets.",
    ],
    clientExpected: [
      "No client action expected unless a preferred dataset whitelist is desired.",
    ],
    concreteEvidence: [
      {
        label: "CKAN package_search",
        href: "https://www.donneesquebec.ca/recherche/api/3/action/package_search",
        detail: "Public API endpoint for dataset discovery.",
      },
    ],
    auditFor:
      "Low-cost infrastructure for multiple public sources and reduces one-off adapter work.",
    auditAgainst:
      "It is internal plumbing, not a client-visible opportunity source; it should not be presented at the same business level as avis publics or PPCMOI.",
  },
  {
    id: "roles-evaluation-fonciere-mamh",
    name: "Roles d'evaluation fonciere - MAMH",
    family: "Parcel and value anchor",
    visionAlignment: ["parcel-anchor", "market-validation", "false-positive-control"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public caviarded files; storage/streaming cost for large files.",
    weakSignalValue: 2,
    precisionValue: 5,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 4,
    businessValue: 5,
    technicalComplexity: 4,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 2,
    recommendation: "build-now",
    done: [
      "BR05 identified MAMH role files as key parcel/value/use enrichment.",
    ],
    next: [
      "Confirm dictionary/XSD path, stream large files, and normalize caviarded fields.",
    ],
    clientExpected: [
      "Confirm the minimum lot/value fields needed in the proposal fiche opportunite.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec role dataset",
        href: "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec",
        detail: "Public role-assessment dataset referenced by BR05.",
      },
    ],
    auditFor:
      "Essential anti-false-positive and parcel anchor: signals need real lots, uses, and values.",
    auditAgainst:
      "Caviarded and periodic data can lag reality; it cannot replace registry-level ownership due diligence.",
  },
  {
    id: "adresses-quebec-igo-geocoder",
    name: "Adresses Quebec / IGO geocoder",
    family: "Geocoding",
    visionAlignment: ["parcel-anchor", "false-positive-control"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes:
      "Public API but not a direct value source; use as a supportive normalization input and keep it in a build-later phase.",
    weakSignalValue: 1,
    precisionValue: 2,
    recallValue: 2,
    falsePositiveControl: 4,
    historyLearningValue: 1,
    businessValue: 2,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified ArcGIS GeocodeServer and downloadable formats."],
    next: [
      "Use for address normalization and sector matching in avis/PPCMOI extraction.",
    ],
    clientExpected: [
      "No client action expected unless proprietary address lists are later supplied.",
    ],
    concreteEvidence: [
      {
        label: "Adresses Quebec GeocodeServer",
        href: "https://servicescarto.mern.gouv.qc.ca/pes/rest/services/Territoire/AdressesQuebec_Geocodage/GeocodeServer",
        detail: "Public geocoding service for address candidates and reverse geocode.",
      },
    ],
    auditFor:
      "Cheap and important precision layer: converts textual notices into map-ready entities.",
    auditAgainst:
      "It creates no opportunity on its own, does not prove lot identity or constructibility, and needs caching/rate discipline.",
  },
  {
    id: "cptaq-zone-agricole",
    name: "CPTAQ zone agricole",
    family: "Constraint",
    visionAlignment: ["constraint-filter", "false-positive-control"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public geospatial layer; storage/geoprocessing cost only.",
    weakSignalValue: 1,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 3,
    businessValue: 4,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 1,
    recommendation: "build-now",
    done: ["BR05 identified this as a hard constraint filter."],
    next: [
      "Add spatial intersection caveats and downgrade opportunities affected by agricultural zoning.",
    ],
    clientExpected: [
      "Confirm whether agricultural-zone risk should be shown as blocker or qualification.",
    ],
    concreteEvidence: [
      {
        label: "CPTAQ public site",
        href: "https://www.cptaq.gouv.qc.ca/",
        detail: "Official source family for agricultural-zone context.",
      },
    ],
    auditFor:
      "Strong false-positive reducer: avoids scoring lots as attractive when agricultural constraints dominate.",
    auditAgainst:
      "The transposed layer is not a legal opinion; decisions and local context may still be required.",
  },
  {
    id: "cptaq-decisions",
    name: "CPTAQ decisions",
    family: "Constraint",
    visionAlignment: ["constraint-filter", "false-positive-control", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes:
      "Public decision/search material; high-value for phase-1 anti-blocking checks where municipal change intent is visible.",
    weakSignalValue: 4,
    precisionValue: 5,
    recallValue: 5,
    falsePositiveControl: 5,
    historyLearningValue: 5,
    businessValue: 5,
    technicalComplexity: 4,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 2,
    recommendation: "build-now",
    done: ["BR05 identified decision data as unlock/de-risk signal after zone filtering."],
    next: [
      "Link notice dossiers to decision summaries and status history so denials and authorizations can qualify opportunity ranking immediately.",
    ],
    clientExpected: [
      "Confirm how much agricultural-edge opportunity hunting matters for Phase 1 because VISION treats CPTAQ requests as early expansion signals.",
    ],
    concreteEvidence: [
      {
        label: "CPTAQ public site",
        href: "https://www.cptaq.gouv.qc.ca/",
        detail: "Official source family for decisions and agricultural territory context.",
      },
    ],
    auditFor:
      "Can turn a simple blocker into a nuanced opportunity if past exclusions or authorizations exist.",
    auditAgainst:
      "Many-to-many shape/detail relationships can be expensive for limited first-demo impact.",
  },
  {
    id: "bdzi-flood-zones",
    name: "BDZI flood zones",
    family: "Constraint",
    visionAlignment: ["constraint-filter", "false-positive-control"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public REST/WMS or bulk GIS; bulk storage can grow.",
    weakSignalValue: 1,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 2,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 2,
    recommendation: "build-later",
    done: ["BR05 identified flood risk as a later risk filter."],
    next: [
      "Use REST/WMS first for risk badges; postpone bulk downloads until offline geoprocessing is necessary.",
    ],
    clientExpected: [
      "Confirm whether flood-risk filtering is required in first proposal screenshots.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec search",
        href: "https://www.donneesquebec.ca/recherche/fr/",
        detail: "Public catalog path used to locate BDZI resources.",
      },
    ],
    auditFor:
      "Good anti-false-positive layer for waterfront and low-lying opportunities.",
    auditAgainst:
      "Not a source of densification signal and legal interpretation is sensitive.",
  },
  {
    id: "grhq-hydrography",
    name: "GRHQ hydrography",
    family: "Constraint",
    visionAlignment: ["constraint-filter", "false-positive-control"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public WMS/FGDB resources; geoprocessing cost only.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 2,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified hydrography as environmental proximity context."],
    next: [
      "Add after local bylaw interpretation can explain setbacks and riparian strips.",
    ],
    clientExpected: [
      "Confirm whether environmental constraints need to appear in the initial client proposal.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec search",
        href: "https://www.donneesquebec.ca/recherche/fr/",
        detail: "Public catalog path for hydrography datasets and services.",
      },
    ],
    auditFor:
      "Helpful to reduce false positives near waterways once local rules are modeled.",
    auditAgainst:
      "Hydrography alone is not the regulation; without local setbacks it can mislead.",
  },
  {
    id: "zonage-municipal-open-data",
    name: "Zonage municipal open data",
    family: "Open-data zoning",
    visionAlignment: ["regulatory-signal", "false-positive-control"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public where available; multi-city schema normalization cost.",
    weakSignalValue: 3,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 3,
    businessValue: 3,
    technicalComplexity: 4,
    accessComplexity: 2,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 found no Salaberry-specific open zoning dataset in Donnees Quebec."],
    next: [
      "Build generic CKAN/ArcGIS support later, but do not make Salaberry demo depend on it.",
    ],
    clientExpected: [
      "Confirm target expansion cities where open zoning may be more available.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec catalog",
        href: "https://www.donneesquebec.ca/recherche/fr/",
        detail: "Public catalog used to search for municipal zoning datasets.",
      },
    ],
    auditFor:
      "High reuse value for multi-city scale if cities publish zoning layers.",
    auditAgainst:
      "Weak Salaberry value now because the key pilot dataset was not found.",
  },
  {
    id: "zonage-plans-grilles-valleyfield",
    name: "Zonage plans et grilles - Valleyfield",
    family: "Municipal context",
    visionAlignment: ["false-positive-control", "regulatory-signal"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public PDF maps/grids; OCR/table extraction can be costly in time.",
    weakSignalValue: 3,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 4,
    businessValue: 5,
    technicalComplexity: 5,
    accessComplexity: 1,
    legalComplexity: 2,
    costComplexity: 2,
    recommendation: "build-later",
    done: ["BR05 identified plans/grids as important but extraction-heavy."],
    next: [
      "Use bylaw references first; add targeted/manual extraction for top dossiers in Phase 1, then automate full plan/grid extraction later.",
    ],
    clientExpected: [
      "Confirm whether the proposal needs targeted before/after zoning-plan evidence for the strongest dossiers.",
    ],
    concreteEvidence: [
      {
        label: "Urbanism regulations",
        href: cityPage("reglements-municipaux?cat=reglement-durbanisme&terme="),
        detail: "Public regulation area where zoning grids and amendments are referenced.",
      },
    ],
    auditFor:
      "Major false-positive reducer: real density potential depends on grids, not just notice wording.",
    auditAgainst:
      "Too extraction-heavy for first proof unless the client needs strong parcel-level zoning confidence immediately.",
  },
  {
    id: "cadastre-infolot",
    name: "Cadastre / Infolot",
    family: "Parcel geometry",
    visionAlignment: ["parcel-anchor", "false-positive-control"],
    accessMode: "paid-access",
    costLevel: "quote-required",
    costNotes:
      "Public consultation is typically free/manual for targeted lot checks; official extracts or licensed bulk feeds are paid and require qualification before automation.",
    weakSignalValue: 1,
    precisionValue: 5,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 3,
    businessValue: 5,
    technicalComplexity: 4,
    accessComplexity: 4,
    legalComplexity: 4,
    costComplexity: 4,
    recommendation: "qualify-access-now",
    done: [
      "BR05 separated parcel geometry value from ownership proof and warned against live map scraping.",
    ],
    next: [
      "Separate manual consultation from official paid extracts; qualify licensing, update cadence, and cost before automating.",
    ],
    clientExpected: [
      "Decide whether manual cadastral checks are enough for proposal-stage lots or whether official extracts should be funded.",
    ],
    concreteEvidence: [
      {
        label: "Infolot public entry",
        href: "https://appli.mern.gouv.qc.ca/infolot/",
        detail: "Official cadastre consultation entry point requiring access-policy review.",
      },
    ],
    auditFor:
      "Crucial for parcel anchoring and assemblage analysis in the PROCESS pipeline.",
    auditAgainst:
      "Access/licence risk can consume budget; MAMH roles plus addresses may be enough for the first proposal.",
  },
  {
    id: "registre-foncier-qc",
    name: "Registre foncier du Quebec",
    family: "Ownership due diligence",
    visionAlignment: ["parcel-anchor", "market-validation"],
    accessMode: "manual-paid",
    costLevel: "manual-fee",
    costNotes:
      "Paid per consultation/document workflow. PROCESS cites CAD 1.50/document from 2026-04-01; verify current tariff and reuse/storage rights before use.",
    weakSignalValue: 1,
    precisionValue: 5,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 3,
    businessValue: 5,
    technicalComplexity: 5,
    accessComplexity: 5,
    legalComplexity: 5,
    costComplexity: 4,
    recommendation: "manual-check",
    done: [
      "BR05 identified high due-diligence value and high automation/legal/payment risk.",
    ],
    next: [
      "Keep manual evidence links for demo parcels; do not automate browser/payment workflows in Phase 1.",
    ],
    clientExpected: [
      "Confirm whether manual registry checks on final candidate lots are acceptable for the proposal instead of daily registry automation.",
    ],
    concreteEvidence: [
      {
        label: "Registre foncier official portal",
        href: "https://www.registrefoncier.gouv.qc.ca/",
        detail: "Official paid registry portal for legal property records.",
      },
    ],
    auditFor:
      "Highest confidence for ownership/legal due diligence when a target parcel matters.",
    auditAgainst:
      "Poor automation ROI and sensitive legal/payment constraints for an early low-cost proposal.",
  },
  {
    id: "jlr",
    name: "JLR",
    family: "Paid market data",
    visionAlignment: ["market-validation", "parcel-anchor"],
    accessMode: "partner-feed",
    costLevel: "quote-required",
    costNotes:
      "Commercial subscription/feed quote required; likely material monthly cost and reuse constraints.",
    weakSignalValue: 2,
    precisionValue: 5,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 5,
    businessValue: 5,
    technicalComplexity: 4,
    accessComplexity: 5,
    legalComplexity: 5,
    costComplexity: 5,
    recommendation: "qualify-access-now",
    done: ["BR05 identified JLR as strongest paid enrichment candidate."],
    next: [
      "Request product/pricing/licence details for transaction, ownership, and reuse rights.",
    ],
    clientExpected: [
      "Decide whether paid market/ownership enrichment is in proposal budget or later phase.",
    ],
    concreteEvidence: [
      {
        label: "JLR official site",
        href: "https://www.jlr.ca/",
        detail: "Commercial Quebec real-estate data provider to qualify for feed/export terms.",
      },
    ],
    auditFor:
      "Could dramatically improve market validation and historical learning if licensing allows storage and scoring.",
    auditAgainst:
      "May be the largest recurring cost and could restrict derivative products or redistribution.",
  },
  {
    id: "centris-mls",
    name: "Centris / MLS",
    family: "Paid market data",
    visionAlignment: ["market-validation"],
    accessMode: "partner-feed",
    costLevel: "quote-required",
    costNotes:
      "Formal feed or partnership required; public listing scraping should be excluded.",
    weakSignalValue: 2,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 4,
    businessValue: 4,
    technicalComplexity: 4,
    accessComplexity: 5,
    legalComplexity: 5,
    costComplexity: 5,
    recommendation: "qualify-access-now",
    done: ["BR05 flagged MLS listing data as partner-only for Phase 1."],
    next: [
      "Qualify whether any official aggregate or feed access is realistic; keep public scraping out of scope.",
    ],
    clientExpected: [
      "Confirm whether listing-level market context is essential, and whether the client has broker/board access.",
    ],
    concreteEvidence: [
      {
        label: "Centris public site",
        href: "https://www.centris.ca/",
        detail: "Public listing site; not a scraping target without formal permission.",
      },
    ],
    auditFor:
      "Useful market signal if licensed: listings, absorption, and price pressure support value scoring.",
    auditAgainst:
      "High governance/IP risk and likely not needed to prove the municipal weak-signal thesis.",
  },
  {
    id: "transactions-immobilieres",
    name: "Transactions immobilieres",
    family: "Market validation",
    visionAlignment: ["market-validation", "history-learning"],
    accessMode: "paid-access",
    costLevel: "quote-required",
    costNotes:
      "Aggregate public context may be free; parcel-level transaction feeds require paid/provider access.",
    weakSignalValue: 2,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 5,
    businessValue: 4,
    technicalComplexity: 4,
    accessComplexity: 4,
    legalComplexity: 4,
    costComplexity: 4,
    recommendation: "build-later",
    done: ["BR05 separated aggregate market context from parcel-level feeds."],
    next: [
      "Use aggregate market context later; parcel-level transactions only through authorized provider access.",
    ],
    clientExpected: [
      "Confirm acceptable market-evidence depth for the first proposal.",
    ],
    concreteEvidence: [
      {
        label: "JLR official site",
        href: "https://www.jlr.ca/",
        detail: "Provider path likely required for parcel-level transaction evidence.",
      },
    ],
    auditFor:
      "Historical transactions are valuable to learn whether zoning changes preceded market repricing.",
    auditAgainst:
      "Without licensed parcel-level data, it may remain too aggregate to validate specific opportunities.",
  },
  {
    id: "permis-construction-valleyfield",
    name: "Permis de construction - Valleyfield",
    family: "Municipal market validation",
    visionAlignment: ["market-validation", "history-learning"],
    accessMode: "client-or-municipal-access",
    costLevel: "quote-required",
    costNotes:
      "No public enumerable feed observed; access is contingent on municipal export or client-supported data-sharing work.",
    weakSignalValue: 3,
    precisionValue: 5,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 5,
    businessValue: 4,
    technicalComplexity: 3,
    accessComplexity: 5,
    legalComplexity: 4,
    costComplexity: 4,
    recommendation: "qualify-access-now",
    done: ["BR05 did not find an enumerable public Valleyfield permit feed."],
    next: [
      "Ask whether a public/municipal export or client-supported data request is possible.",
    ],
    clientExpected: [
      "If permits are essential, help request or authorize access/export to detailed municipal permit records and define acceptable lead time.",
    ],
    concreteEvidence: [
      {
        label: "Valleyfield municipal site",
        href: cityPage(""),
        detail:
          "Public municipal site did not expose a granular permit feed in BR05 notes.",
      },
    ],
    auditFor:
      "Excellent historical validation if accessible: did projects follow earlier regulatory signals?",
    auditAgainst:
      "No public feed means it can easily become an access negotiation, not an automation task.",
  },
  {
    id: "construction-permits-open-data",
    name: "Construction permits open data",
    family: "Market validation",
    visionAlignment: ["market-validation", "history-learning"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes:
      "Free where a city publishes it; Salaberry has no confirmed open feed. Multi-city normalization cost applies later.",
    weakSignalValue: 2,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 4,
    historyLearningValue: 4,
    businessValue: 2,
    technicalComplexity: 3,
    accessComplexity: 2,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "drop-phase-1",
    done: [
      "BR05 found this useful for cities that publish permits, but not for Valleyfield.",
    ],
    next: ["Drop for the Salaberry-de-Valleyfield Phase 1 unless a feed appears."],
    clientExpected: [
      "Identify other target cities if open permits become a proposal requirement.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec catalog",
        href: "https://www.donneesquebec.ca/recherche/fr/",
        detail: "Catalog path for cities that publish permit datasets.",
      },
    ],
    auditFor:
      "Strong market validation in cities with open permit feeds.",
    auditAgainst:
      "Low immediate value for the chosen pilot because no Salaberry feed was found.",
  },
  {
    id: "statcan-census-profile-2021",
    name: "StatCan Census Profile 2021",
    family: "Socio-economic context",
    visionAlignment: ["strategic-context", "market-validation"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public bulk/API data; slice to avoid large unnecessary downloads.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 1,
    businessValue: 4,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-now",
    done: [
      "BR05 identified Salaberry-de-Valleyfield CSD DGUID 2021A00052470052.",
    ],
    next: [
      "Extract a small curated municipal baseline for proposal context.",
    ],
    clientExpected: [
      "Confirm which socio-economic indicators matter for the client narrative.",
    ],
    concreteEvidence: [
      {
        label: "StatCan Census Profile",
        href: "https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/index.cfm",
        detail: "Official census profile search and data entry point.",
      },
    ],
    auditFor:
      "Low-cost official context for demand and municipal positioning.",
    auditAgainst:
      "Five-year cadence means it is context, not an alert or timing source.",
  },
  {
    id: "statcan-wds-socioeconomic-tables",
    name: "StatCan WDS socio-economic tables",
    family: "Socio-economic context",
    visionAlignment: ["strategic-context", "market-validation"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public WDS; metadata management cost by table.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 1,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 recommended a curated whitelist rather than generic scraper."],
    next: ["Start only after Census Profile proves which indicators matter."],
    clientExpected: [
      "Select indicators if the proposal needs deeper demographic/economic support.",
    ],
    concreteEvidence: [
      {
        label: "StatCan WDS",
        href: "https://www.statcan.gc.ca/en/developers/wds",
        detail: "Official Web Data Service documentation.",
      },
    ],
    auditFor:
      "Can enrich proposal narrative with official indicators beyond census profile.",
    auditAgainst:
      "Generic table crawling adds complexity before the client value story is settled.",
  },
  {
    id: "statcan-core-public-infrastructure-assets",
    name: "StatCan core public infrastructure assets",
    family: "Infrastructure context",
    visionAlignment: ["strategic-context"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public data; low technical cost but low opportunity value.",
    weakSignalValue: 1,
    precisionValue: 1,
    recallValue: 3,
    falsePositiveControl: 1,
    historyLearningValue: 1,
    businessValue: 1,
    technicalComplexity: 1,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "drop-phase-1",
    done: ["BR05 identified this as macro background only."],
    next: ["Drop from Phase 1 proposal UI except as archived rationale."],
    clientExpected: [
      "No client action expected unless macro infrastructure assets become a proposal topic.",
    ],
    concreteEvidence: [
      {
        label: "StatCan WDS",
        href: "https://www.statcan.gc.ca/en/developers/wds",
        detail: "Public API family where infrastructure tables can be queried.",
      },
    ],
    auditFor:
      "Cheap public context if a later report needs national/provincial background.",
    auditAgainst:
      "Too coarse to identify weak municipal densification opportunities.",
  },
  {
    id: "infc-hicc-projects",
    name: "INFC/HICC projects",
    family: "Infrastructure catalyst",
    visionAlignment: ["strategic-context", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public CSV/JSON/XLSX style data; normalization cost only.",
    weakSignalValue: 3,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 4,
    businessValue: 3,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified official federal public-investment context."],
    next: [
      "Defer unless a concrete Salaberry project is linked to hot sectors; otherwise keep as strategic context.",
    ],
    clientExpected: [
      "Confirm whether public investment catalysts should appear in proposal cards after municipal signals are proven.",
    ],
    concreteEvidence: [
      {
        label: "Housing, Infrastructure and Communities Canada",
        href: "https://housing-infrastructure.canada.ca/",
        detail: "Federal project/funding source family referenced by BR05.",
      },
    ],
    auditFor:
      "Low-cost context that can strengthen the 'why now' narrative around sectors.",
    auditAgainst:
      "Federal project data can lag and rarely proves a parcel-level opportunity alone.",
  },
  {
    id: "mtmd-travaux-routiers",
    name: "MTMD travaux routiers",
    family: "Transport context",
    visionAlignment: ["strategic-context"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public GIS feed; snapshot storage needed for history.",
    weakSignalValue: 2,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 1,
    historyLearningValue: 3,
    businessValue: 3,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified roadwork context and snapshot requirement."],
    next: ["Add after core opportunity cards need infrastructure timing context."],
    clientExpected: [
      "Confirm whether road disruption/investment timing matters to the client thesis.",
    ],
    concreteEvidence: [
      {
        label: "MTMD Quebec",
        href: "https://www.quebec511.info/",
        detail: "Public transport/roadwork information family to qualify.",
      },
    ],
    auditFor:
      "Can add timing context for sectors undergoing infrastructure disruption or upgrade.",
    auditAgainst:
      "Operational roadwork is often noise rather than durable densification catalyst.",
  },
  {
    id: "mtmd-reseau-routier-rtss",
    name: "MTMD reseau routier RTSS",
    family: "Transport context",
    visionAlignment: ["strategic-context"],
    accessMode: "public-api",
    costLevel: "none",
    costNotes: "Public GIS; province-wide fetches should be scoped.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 1,
    historyLearningValue: 2,
    businessValue: 2,
    technicalComplexity: 2,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 marked this as a supporting road hierarchy layer."],
    next: [
      "Use only if road hierarchy/proximity enters scoring or map context.",
    ],
    clientExpected: [
      "No client action expected unless transport access is a proposal priority.",
    ],
    concreteEvidence: [
      {
        label: "MTMD Quebec",
        href: "https://www.transports.gouv.qc.ca/",
        detail: "Official transport source family for road-network data.",
      },
    ],
    auditFor:
      "Cheap supporting geography for accessibility and road hierarchy.",
    auditAgainst:
      "Not a weak signal; low proposal leverage without map/scoring dependencies.",
  },
  {
    id: "exo-gtfs-transit-service",
    name: "Exo GTFS transit service",
    family: "Transit context",
    visionAlignment: ["strategic-context", "market-validation"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public GTFS feed; update handling and route filtering cost.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 2,
    businessValue: 3,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "build-later",
    done: ["BR05 identified GTFS as accessibility context, not project alerts."],
    next: ["Add only after opportunity scoring needs transit accessibility."],
    clientExpected: [
      "Confirm whether Exo accessibility is materially relevant to Valleyfield before adding it to Phase 1.",
    ],
    concreteEvidence: [
      {
        label: "Exo open data",
        href: "https://exo.quebec/en/about/open-data",
        detail: "Public transit data source family.",
      },
    ],
    auditFor:
      "Useful for accessibility and demand narrative around residential density.",
    auditAgainst:
      "Service feed, not an infrastructure-project or regulatory signal.",
  },
  {
    id: "salaberry-info-travaux-projets",
    name: "Salaberry info travaux/projets",
    family: "Local infrastructure",
    visionAlignment: ["strategic-context", "history-learning"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public HTML; geocoding and NLP extraction cost.",
    weakSignalValue: 3,
    precisionValue: 4,
    recallValue: 3,
    falsePositiveControl: 2,
    historyLearningValue: 4,
    businessValue: 3,
    technicalComplexity: 4,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 2,
    recommendation: "build-later",
    done: ["BR05 identified local projects/travaux as pilot context."],
    next: [
      "Defer until BR07 cards need local public-work catalysts or street-segment context.",
    ],
    clientExpected: [
      "Confirm whether local infrastructure context should appear beside regulatory alerts.",
    ],
    concreteEvidence: [
      {
        label: "Valleyfield municipal site",
        href: cityPage(""),
        detail: "Public municipal source family for local works and projects.",
      },
    ],
    auditFor:
      "Can create a credible 'why this sector now' narrative when paired with regulatory signals.",
    auditAgainst:
      "HTML/NLP extraction and fuzzy street geocoding can be too costly for uncertain alert value.",
  },
  {
    id: "artm-grands-projets",
    name: "ARTM grands projets",
    family: "Transit projects",
    visionAlignment: ["strategic-context"],
    accessMode: "public-free",
    costLevel: "none",
    costNotes: "Public pages; low direct pilot value.",
    weakSignalValue: 1,
    precisionValue: 1,
    recallValue: 3,
    falsePositiveControl: 1,
    historyLearningValue: 2,
    businessValue: 1,
    technicalComplexity: 3,
    accessComplexity: 1,
    legalComplexity: 1,
    costComplexity: 1,
    recommendation: "drop-phase-1",
    done: ["BR05 identified Montreal-region bias and weak Valleyfield relevance."],
    next: ["Drop unless the client expands the target geography to ARTM territory."],
    clientExpected: [
      "No action unless the proposal geography changes beyond Salaberry-de-Valleyfield.",
    ],
    concreteEvidence: [
      {
        label: "ARTM projects",
        href: "https://www.artm.quebec/",
        detail: "Regional transit project source with weak Valleyfield fit.",
      },
    ],
    auditFor:
      "Could matter for Montreal-region expansion where transit projects drive density.",
    auditAgainst:
      "Poor fit with the current pilot city and not worth Phase 1 attention.",
  },
  {
    id: "orthophotos-imagery",
    name: "Orthophotos / imagery",
    family: "Visual validation",
    visionAlignment: ["false-positive-control", "strategic-context"],
    accessMode: "public-api",
    costLevel: "low-variable",
    costNotes:
      "Public WMS/index use is low cost; bulk imagery storage and computer vision are separate costs.",
    weakSignalValue: 1,
    precisionValue: 3,
    recallValue: 3,
    falsePositiveControl: 5,
    historyLearningValue: 3,
    businessValue: 3,
    technicalComplexity: 4,
    accessComplexity: 2,
    legalComplexity: 2,
    costComplexity: 3,
    recommendation: "build-later",
    done: ["BR05 recommended preview/index first and no heavy CV in Phase 1."],
    next: [
      "Use WMS preview only if source-review or map screens need visual grounding.",
    ],
    clientExpected: [
      "Confirm whether visual parcel inspection is needed in proposal demos.",
    ],
    concreteEvidence: [
      {
        label: "Donnees Quebec catalog",
        href: "https://www.donneesquebec.ca/recherche/fr/",
        detail: "Catalog path for orthophoto and imagery resources.",
      },
    ],
    auditFor:
      "Useful to visually validate friches, parking lots, vacant or underused sites, and improve proposal credibility without heavy computer vision.",
    auditAgainst:
      "Large imagery and computer vision can become a separate product before core radar value is proven.",
  },
];

export function getPotentialComplexity(source: SourceEvaluation): number {
  return Number(
    (
      source.technicalComplexity * 0.35 +
      source.accessComplexity * 0.25 +
      source.legalComplexity * 0.2 +
      source.costComplexity * 0.2
    ).toFixed(2),
  );
}

export function getQuadrant(source: SourceEvaluation): Quadrant {
  const highValue = source.businessValue >= 4;
  const highComplexity = getPotentialComplexity(source) >= 3.5;

  if (highValue && highComplexity) {
    return "high-value-high-complexity";
  }
  if (highValue) {
    return "high-value-low-complexity";
  }
  if (highComplexity) {
    return "low-value-high-complexity";
  }
  return "low-value-low-complexity";
}

export function getAccessPrioritySources(
  sources: SourceEvaluation[],
): SourceEvaluation[] {
  const accessPriorityModes = new Set([
    "paid-access",
    "partner-feed",
    "manual-paid",
    "client-or-municipal-access",
  ]);

  return sources
    .filter(
      (source) =>
        source.recommendation === "qualify-access-now" ||
        source.recommendation === "manual-check" ||
        source.costLevel === "quote-required" ||
        source.costLevel === "manual-fee" ||
        accessPriorityModes.has(source.accessMode),
    )
    .sort((left, right) =>
      right.businessValue - left.businessValue || right.costComplexity - left.costComplexity,
    );
}

export function getRecommendationSummary(
  sources: SourceEvaluation[],
): RecommendationSummary {
  return {
    buildNow: sources.filter((source) => source.recommendation === "build-now")
      .length,
    buildLater: sources.filter((source) => source.recommendation === "build-later")
      .length,
    qualifyAccessNow: sources.filter(
      (source) => source.recommendation === "qualify-access-now",
    ).length,
    manualCheck: sources.filter((source) => source.recommendation === "manual-check")
      .length,
    dropPhase1: sources.filter((source) => source.recommendation === "drop-phase-1")
      .length,
  };
}

export function getSourcesByQuadrant(
  sources: SourceEvaluation[],
): Record<Quadrant, SourceEvaluation[]> {
  const groups: Record<Quadrant, SourceEvaluation[]> = {
    "high-value-low-complexity": [],
    "high-value-high-complexity": [],
    "low-value-low-complexity": [],
    "low-value-high-complexity": [],
  };

  for (const source of sources) {
    groups[getQuadrant(source)].push(source);
  }

  return groups;
}
