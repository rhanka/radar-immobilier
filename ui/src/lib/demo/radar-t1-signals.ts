// Signaux pilotes RÉELS du fil Radar T1.
// Ces 3 signaux proviennent des vrais avis publics de consultation et
// d'approbation référendaire de Salaberry-de-Valleyfield (règlements 150-49,
// 150-49-1, 150-51). Aucun signal synthétique/inventé dans ce tableau.
//
// Note : le fil live (SignalsT1View.svelte) charge désormais les signaux via
// GET /api/signals/by-city. Ce tableau sert de référence pour la carte
// d'évaluation (EvaluationMapView.svelte) et les tests unitaires.

import { Signal, SIGNAL_TYPE_VALUES, type SignalT } from "@radar/domain";

export const demoSignalsT1: SignalT[] = [
  // --- Signaux pilotes réels (mode: "real") ---
  Signal.parse({
    id: "sig-h609-4",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "high",
    status: "à-approfondir",
    sourceRefs: ["avis-consultation-150-49"],
    detectedAt: "2026-02-25",
    bylaw: "150-49",
    zone: "H-609-4",
    mode: "real",
  }),
  Signal.parse({
    id: "sig-u521-h521",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "high",
    status: "à-approfondir",
    sourceRefs: ["avis-approbation-referendaire-150-51"],
    detectedAt: "2026-04-22",
    bylaw: "150-51",
    zone: "H-521",
    mode: "real",
  }),
  Signal.parse({
    id: "sig-h143",
    type: "residential-rezoning",
    value: SIGNAL_TYPE_VALUES["residential-rezoning"],
    confidence: "medium",
    status: "à-approfondir",
    sourceRefs: ["avis-consultation-150-49-1"],
    detectedAt: "2026-04-22",
    bylaw: "150-49-1",
    zone: "H-143/H-143-1",
    mode: "real",
  }),
];
