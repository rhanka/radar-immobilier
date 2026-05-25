import type {
  AccessMode,
  CostLevel,
  Quadrant,
  RecommendationKind,
  VisionAlignment,
} from "./source-evaluation-data";

export const recommendationLabels: Record<RecommendationKind, string> = {
  "build-now": "Construire maintenant",
  "build-later": "Construire plus tard",
  "qualify-access-now": "Qualifier l'acces",
  "manual-check": "Verification manuelle",
  "drop-phase-1": "Sortir Phase 1",
};

export const quadrantLabels: Record<Quadrant, string> = {
  "high-value-low-complexity": "Priorite immediate",
  "high-value-high-complexity": "Valeur forte, acces a qualifier",
  "low-value-low-complexity": "Contexte opportuniste",
  "low-value-high-complexity": "A eviter en Phase 1",
};

export const accessLabels: Record<AccessMode, string> = {
  "public-free": "Public gratuit",
  "public-api": "API publique",
  "account-free": "Compte gratuit",
  "paid-access": "Acces payant",
  "partner-feed": "Feed partenaire",
  "manual-paid": "Manuel payant",
  "client-or-municipal-access": "Acces client/municipal",
};

export const costLabels: Record<CostLevel, string> = {
  none: "0 abonnement",
  "low-variable": "Cout variable bas",
  "medium-variable": "Cout variable a cadrer",
  "quote-required": "Devis requis",
  "manual-fee": "Frais par verification",
};

export const visionLabels: Record<VisionAlignment, string> = {
  "regulatory-signal": "Signal reglementaire",
  "parcel-anchor": "Ancrage foncier",
  "constraint-filter": "Contrainte",
  "market-validation": "Validation marche",
  "strategic-context": "Contexte strategique",
  "history-learning": "Apprentissage historique",
  "false-positive-control": "Anti-faux-positif",
};
