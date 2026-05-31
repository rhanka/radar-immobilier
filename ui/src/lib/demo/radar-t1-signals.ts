// Demo signals for the Radar T1 feed.
// Rows marked mode:"simulation" are synthetic fixtures — see escalations log D4.
// The 3 real pilot signals (mode:"real") are derived from verified public consultation
// notices for bylaws 150-49, 150-49-1, and 150-51.
//
// S1.2: dérogation-relevant conservé pour la démo (6ᵉ signal, écarté) mais sa valeur est
//   fixée en dur (5) — SIGNAL_TYPE_VALUES["derogation-relevant"] vaut 0 (filtre pur VISION).

import { Signal, SIGNAL_TYPE_VALUES, type SignalT } from "@radar/domain";

export const demoSignalsT1: SignalT[] = [
  // --- Real pilot signals (mode: "real") ---
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

  // --- Synthetic signals (mode: "simulation") — escalations log D4 ---
  Signal.parse({
    id: "sig-sim-cptaq-a118",
    type: "cptaq",
    value: SIGNAL_TYPE_VALUES["cptaq"],
    confidence: "medium",
    status: "nouveau",
    sourceRefs: [],
    detectedAt: "2026-05-01",
    bylaw: "150-44",
    zone: "A-118",
    mode: "simulation",
  }),
  Signal.parse({
    id: "sig-sim-ppcmoi-c627",
    type: "ppcmoi",
    value: SIGNAL_TYPE_VALUES["ppcmoi"],
    confidence: "low",
    status: "surveillance",
    sourceRefs: [],
    detectedAt: "2026-05-10",
    zone: "C-627",
    mode: "simulation",
  }),
  Signal.parse({
    id: "sig-sim-derog-h516",
    type: "derogation-relevant",
    // S1.2: valeur fixée en dur — dérogation = filtre pur (SIGNAL_TYPE_VALUES vaut 0).
    value: 5,
    confidence: "medium",
    status: "écarté",
    sourceRefs: [],
    detectedAt: "2026-05-15",
    zone: "H-516",
    mode: "simulation",
  }),
];
