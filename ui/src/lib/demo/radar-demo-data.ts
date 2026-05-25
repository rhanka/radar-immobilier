export type SignalKind = "ppcmoi" | "zoning" | "cptaq" | "derogation";
export type SignalStatus = "new" | "reviewing" | "watch";

export interface RadarSignal {
  id: string;
  title: string;
  kind: SignalKind;
  sourceLabel: string;
  detectedAt: string;
  score: number;
  confidence: number;
  status: SignalStatus;
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
  evidence: string[];
}

export interface DashboardMetrics {
  activeSignals: number;
  highPotentialSignals: number;
  topScore: number;
  nextMilestone: string;
}

export const demoSignals: RadarSignal[] = [
  {
    id: "sig-ppcmoi-2026-04",
    title: "PPCMOI - rue Victoria",
    kind: "ppcmoi",
    sourceLabel: "Avis publics",
    detectedAt: "2026-05-22",
    score: 82,
    confidence: 0.91,
    status: "new",
    summary:
      "Projet particulier permettant une densification residentielle pres du centre-ville.",
    evidenceLabel: "Avis public, conseil municipal, point 7.3",
    timingLabel: "Decision attendue sous 30 jours",
  },
  {
    id: "sig-zoning-2026-11",
    title: "Modification de zonage - secteur Bellerive",
    kind: "zoning",
    sourceLabel: "Reglements municipaux",
    detectedAt: "2026-05-19",
    score: 78,
    confidence: 0.84,
    status: "reviewing",
    summary:
      "Ouverture possible a des usages multifamiliaux dans une zone deja desservie.",
    evidenceLabel: "Projet de reglement 2026-11",
    timingLabel: "Consultation publique planifiee",
  },
  {
    id: "sig-cptaq-2026-02",
    title: "Demande CPTAQ adjacente",
    kind: "cptaq",
    sourceLabel: "CPTAQ",
    detectedAt: "2026-05-15",
    score: 61,
    confidence: 0.72,
    status: "watch",
    summary:
      "Demande voisine pouvant modifier les contraintes de developpement a moyen terme.",
    evidenceLabel: "Dossier CPTAQ 452911",
    timingLabel: "Surveillance mensuelle",
  },
  {
    id: "sig-derogation-2026-08",
    title: "Derogation mineure - lots contigus",
    kind: "derogation",
    sourceLabel: "Comite consultatif d'urbanisme",
    detectedAt: "2026-05-11",
    score: 56,
    confidence: 0.68,
    status: "reviewing",
    summary:
      "Ajustement de marge qui peut annoncer une consolidation fonciere locale.",
    evidenceLabel: "Ordre du jour CCU, point 4.2",
    timingLabel: "Compte rendu a valider",
  },
];

export const demoOpportunity: RadarOpportunity = {
  id: "opp-victoria-density-01",
  title: "Densification residentielle - rue Victoria",
  address: "Rue Victoria, Salaberry-de-Valleyfield",
  score: 82,
  scoreLabel: "Potentiel eleve",
  nextMilestone: "Conseil municipal - 2026-06-17",
  densityPotential: "12 a 24 logements selon assemblage foncier",
  constraints: ["Validation du PPCMOI requise", "Stationnement a documenter"],
  evidence: ["Avis public municipal", "Ordre du jour du conseil"],
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
