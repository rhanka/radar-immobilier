import type {
  RecommendationKind,
  SourceEvaluation,
  VisionAlignment,
} from "../source-review/source-evaluation-data";
import { sourceEvaluations } from "../source-review/source-evaluation-data";

export { sourceEvaluations };

export const RETRO_WINDOW_MONTHS_DEFAULT = 24;

// --- Label maps ---

export const RECOMMENDATION_LABELS_FR: Record<RecommendationKind, string> = {
  "build-now": "Construire maintenant",
  "qualify-access-now": "Qualifier l'accès maintenant",
  "build-later": "Construire plus tard",
  "manual-check": "Vérification manuelle",
  "drop-phase-1": "Exclure phase 1",
};

export const VISION_ALIGNMENT_LABELS_FR: Record<VisionAlignment, string> = {
  "regulatory-signal": "Signal réglementaire",
  "parcel-anchor": "Ancrage parcellaire",
  "constraint-filter": "Filtre de contrainte",
  "market-validation": "Validation marché",
  "strategic-context": "Contexte stratégique",
  "history-learning": "Apprentissage historique",
  "false-positive-control": "Contrôle faux positifs",
};

// --- groupByRecommendation ---

const RECOMMENDATION_ORDER: RecommendationKind[] = [
  "build-now",
  "qualify-access-now",
  "build-later",
  "manual-check",
  "drop-phase-1",
];

export interface RecommendationGroup {
  recommendation: RecommendationKind;
  label: string;
  sources: SourceEvaluation[];
}

export function groupByRecommendation(
  sources: SourceEvaluation[] = sourceEvaluations,
): RecommendationGroup[] {
  const map = new Map<RecommendationKind, SourceEvaluation[]>();

  for (const source of sources) {
    const existing = map.get(source.recommendation);
    if (existing) {
      existing.push(source);
    } else {
      map.set(source.recommendation, [source]);
    }
  }

  // Build ordered list: known order first, then any unknown kinds
  const ordered: RecommendationKind[] = [
    ...RECOMMENDATION_ORDER.filter((k) => map.has(k)),
    ...[...map.keys()].filter((k) => !RECOMMENDATION_ORDER.includes(k)),
  ];

  return ordered.map((recommendation) => ({
    recommendation,
    label: RECOMMENDATION_LABELS_FR[recommendation] ?? recommendation,
    sources: map.get(recommendation) ?? [],
  }));
}

// --- defaultSelection ---

export function defaultSelection(
  sources: SourceEvaluation[] = sourceEvaluations,
): string[] {
  return sources
    .filter((s) => s.recommendation === "build-now")
    .map((s) => s.id);
}

// --- summarize ---

export interface OnboardingSummary {
  total: number;
  byRecommendation: Record<string, number>;
}

export function summarize(
  selectedIds: string[],
  sources: SourceEvaluation[] = sourceEvaluations,
): OnboardingSummary {
  const idSet = new Set(selectedIds);
  const selected = sources.filter((s) => idSet.has(s.id));

  const byRecommendation: Record<string, number> = {};
  for (const s of selected) {
    const key = s.recommendation;
    byRecommendation[key] = (byRecommendation[key] ?? 0) + 1;
  }

  return { total: selected.length, byRecommendation };
}
