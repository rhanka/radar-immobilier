import type { RecommendationKind } from "../source-review/source-evaluation-data.js";
import {
  RECOMMENDATION_LABELS_FR,
  groupByRecommendation,
} from "../onboarding/onboarding-data.js";

export interface QualStatusRow {
  recommendation: RecommendationKind;
  label: string;
  count: number;
}

export function qualificationStatus(): QualStatusRow[] {
  return groupByRecommendation().map((group) => ({
    recommendation: group.recommendation,
    label: RECOMMENDATION_LABELS_FR[group.recommendation] ?? group.recommendation,
    count: group.sources.length,
  }));
}
