import { filterRealMode, type MaybeSimulated } from "@radar/scoring";
import type { EvidenceItemT, OpportunityDossierT, PhaseT } from "@radar/domain";
import type { AppMode } from "../state/mode.js";

export const PHASE_ORDER: PhaseT[] = [
  "signal",
  "ancrage",
  "contraintes",
  "marche",
  "contexte",
  "scoring",
];

const PHASE_LABELS: Record<PhaseT, string> = {
  signal: "Signal",
  ancrage: "Ancrage",
  contraintes: "Contraintes",
  marche: "Marché",
  contexte: "Contexte",
  scoring: "Scoring",
};

export interface PhaseGroup {
  phase: PhaseT;
  label: string;
  items: EvidenceItemT[];
}

export function groupEvidenceByPhase(dossier: OpportunityDossierT): PhaseGroup[] {
  const byPhase = new Map<PhaseT, EvidenceItemT[]>();
  for (const item of dossier.evidence) {
    const bucket = byPhase.get(item.phase) ?? [];
    bucket.push(item);
    byPhase.set(item.phase, bucket);
  }

  return PHASE_ORDER.filter((ph) => (byPhase.get(ph)?.length ?? 0) > 0).map((ph) => ({
    phase: ph,
    label: PHASE_LABELS[ph],
    items: byPhase.get(ph) ?? [],
  }));
}

export interface TimelineItem {
  date: string;
  phase: PhaseT;
  label: string;
}

export function deriveTimeline(dossier: OpportunityDossierT): TimelineItem[] {
  return dossier.evidence
    .map((e) => ({ date: e.date, phase: e.phase, label: e.label }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function filterDossiersBySignalId(
  dossiers: OpportunityDossierT[],
  signalId?: string,
): OpportunityDossierT[] {
  if (signalId === undefined) return [...dossiers];
  return dossiers.filter((d) => d.signalId === signalId);
}

export function applyMode<T extends MaybeSimulated>(
  items: readonly T[],
  mode: AppMode,
): T[] {
  if (mode === "real") return filterRealMode(items);
  return [...items];
}
