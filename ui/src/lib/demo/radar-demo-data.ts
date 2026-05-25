// Demo data = VERIFIED Valleyfield findings from the multi-agent PROMPT benchmark
// (tracks A2 Opus + H1 human, cross-checked reference set R1-R11 in
// docs/spec/SPEC_EVOL_DEMO_FINDINGS_SCORING.md). No fabricated data: every signal
// carries an official source link and a fact/hypothesis tag. Fabricated G2 items
// are excluded per the absolute no-cheating rule.

export type SignalKind = "ppcmoi" | "zoning" | "cptaq" | "derogation";
export type SignalStatus = "new" | "reviewing" | "watch";
export type Verification = "fait" | "hypothese";

export interface EvidenceLink {
  label: string;
  url: string;
}

export interface RadarSignal {
  id: string;
  title: string;
  kind: SignalKind;
  sourceLabel: string;
  sourceUrl: string;
  detectedAt: string;
  score: number;
  confidence: number;
  status: SignalStatus;
  verification: Verification;
  summary: string;
  evidenceLabel: string;
  timingLabel: string;
}

export interface RadarOpportunity {
  id: string;
  title: string;
  address: string;
  score: number;
  scoreLabel: string;
  nextMilestone: string;
  densityPotential: string;
  constraints: string[];
  evidence: EvidenceLink[];
}

export interface DashboardMetrics {
  activeSignals: number;
  highPotentialSignals: number;
  topScore: number;
  nextMilestone: string;
}

const SRC = {
  consult4950:
    "https://dua3m7xvptjbw.cloudfront.net/documents/avis/AP_150-49_150-50_assemblee_consultation.pdf",
  avis51:
    "https://dua3m7xvptjbw.cloudfront.net/documents/avis/Avis-public-Approbation-referendaire-150-51.pdf",
  zonage:
    "https://www.ville.valleyfield.qc.ca/reglements-municipaux/zonage-et-ses-amendements",
  ppcmoi: "https://www.ville.valleyfield.qc.ca/ppcmoi",
  plan450:
    "https://www.ville.valleyfield.qc.ca/reglements-municipaux/projet-de-reglement-450-concernant-le-plan-durbanisme",
};

export const demoSignals: RadarSignal[] = [
  {
    id: "sig-zoning-150-49",
    title: "Règlement 150-49 — densité conditionnelle des boisés",
    kind: "zoning",
    sourceLabel: "Avis public — règl. 150-49 (Ville)",
    sourceUrl: SRC.consult4950,
    detectedAt: "2026-04-22",
    score: 90,
    confidence: 0.9,
    status: "reviewing",
    verification: "fait",
    summary:
      "Densité de base 0,5 log/ha portée jusqu'à 50 log/ha (zones H-143, H-143-1, H-609-4) si ≥30 % du boisé est conservé, via PIIA. Règlement en attente d'adoption.",
    evidenceLabel: "Avis consultation 150-49/150-50 (PDF)",
    timingLabel: "En attente d'adoption (registres avr. 2026)",
  },
  {
    id: "sig-zoning-150-51",
    title: "Règlement 150-51 — conversions résidentielles",
    kind: "zoning",
    sourceLabel: "Avis approbation référendaire 150-51 (Ville)",
    sourceUrl: SRC.avis51,
    detectedAt: "2026-04-22",
    score: 86,
    confidence: 0.85,
    status: "reviewing",
    verification: "fait",
    summary:
      "U-521→H-521, C-627→H-627-2, agrandissement H-535 (résidence étudiante face au Cégep) ; multifamilial 5 à 12 logements, max 3 étages. En attente d'approbation référendaire.",
    evidenceLabel: "Avis approbation référendaire 150-51 (PDF)",
    timingLabel: "Approbation référendaire — 22 avr. 2026",
  },
  {
    id: "sig-ppcmoi-2026-0066",
    title: "PPCMOI 2026-0066 — 110 chemin Larocque",
    kind: "ppcmoi",
    sourceLabel: "Liste PPCMOI active (Ville)",
    sourceUrl: SRC.ppcmoi,
    detectedAt: "2026-05-01",
    score: 72,
    confidence: 0.8,
    status: "new",
    verification: "fait",
    summary:
      "Projet particulier dérogeant au zonage — signal ponctuel de densification résidentielle. 1 des 6 PPCMOI actifs (490 Hébert et 74 Maden écartés : non résidentiels).",
    evidenceLabel: "Page PPCMOI municipale",
    timingLabel: "Assemblée de consultation",
  },
  {
    id: "sig-plan-450",
    title: "Plan d'urbanisme 450 — doctrine de densification",
    kind: "zoning",
    sourceLabel: "Règlement 450 (en vigueur)",
    sourceUrl: SRC.plan450,
    detectedAt: "2025-01-23",
    score: 70,
    confidence: 0.92,
    status: "watch",
    verification: "fait",
    summary:
      "Densification concentrée (jusqu'à 10 étages au pôle MOCO), périmètre urbain réduit (~30 % du territoire), protection de la zone agricole. Contexte structurant : pas de conversion agricole→résidentiel.",
    evidenceLabel: "Plan d'urbanisme 450 (codifié 450-01)",
    timingLabel: "En vigueur depuis le 23 janv. 2025",
  },
  {
    id: "sig-cptaq-a118",
    title: "Proximité zone agricole A-118 (CPTAQ)",
    kind: "cptaq",
    sourceLabel: "Annexe règl. 150-49 (zonage CONSERVATION)",
    sourceUrl: SRC.consult4950,
    detectedAt: "2026-04-22",
    score: 52,
    confidence: 0.6,
    status: "watch",
    verification: "hypothese",
    summary:
      "Les nouvelles zones boisées / CONSERVATION du règl. 150-49 jouxtent la zone agricole A-118 — contrainte CPTAQ possible à moyen terme (hypothèse d'analyse, à valider).",
    evidenceLabel: "Annexe cartographique 150-49",
    timingLabel: "Surveillance",
  },
];

export const demoOpportunity: RadarOpportunity = {
  id: "opp-150-49-h609-4",
  title: "Densité conditionnelle — zone H-609-4 (règl. 150-49)",
  address: "Secteur Champlain / Saint-Jean-Baptiste / Salaberry, Salaberry-de-Valleyfield",
  score: 90,
  scoreLabel: "Potentiel élevé",
  nextMilestone: "Adoption du règlement 150-49 (en attente)",
  densityPotential:
    "0,5 → jusqu'à 50 log/ha si ≥30 % du boisé conservé (PIIA) ; nouvelle zone créée à même H-607/H-609/H-609-3.",
  constraints: [
    "Règlement 150-49 en attente d'adoption (non en vigueur en mai 2026)",
    "Conservation ≥30 % du boisé (dont 20 % continu) + analyse PIIA",
    "Données de lot (matricule, superficie, valeur) non disponibles — rôle d'évaluation bloqué (Cloudflare)",
  ],
  evidence: [
    { label: "Avis consultation 150-49/150-50 (Ville, PDF)", url: SRC.consult4950 },
    { label: "Zonage et ses amendements (Ville)", url: SRC.zonage },
    { label: "Plan d'urbanisme 450 (Ville)", url: SRC.plan450 },
  ],
};

export function getDashboardMetrics(
  signals: RadarSignal[],
  opportunity: RadarOpportunity,
): DashboardMetrics {
  return {
    activeSignals: signals.length,
    highPotentialSignals: signals.filter((signal) => signal.score >= 75).length,
    topScore: opportunity.score,
    nextMilestone: opportunity.nextMilestone,
  };
}

export function getSignalById(
  signals: RadarSignal[],
  signalId: string,
): RadarSignal | undefined {
  return signals.find((signal) => signal.id === signalId);
}
