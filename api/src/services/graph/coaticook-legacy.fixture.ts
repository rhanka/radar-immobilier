import type { GraphifyNode } from "./graph-store.js";

/** Real signal from graph/coaticook/latest.json (2026-07-15). */
export const COATICOOK_LEGACY_GRAPH_NODES: GraphifyNode[] = [
  {
    id: "signal-coaticook-densification-ppcmoi-rd104",
    type: "Signal",
    label: "",
    properties: {
      category: "ppcmoi",
      kind: "densification",
      date: "2026-02-09",
      municipality: "coaticook",
      status: "candidate",
      description: "PPCMOI pour construction d'un bâtiment résidentiel de 12 logements au 103-123 rue Saint-Marc (zone RD-104).",
      resolutionRef: "26-02-38263",
      nb_unites_min: 12,
      nb_unites_max: 12,
      etape: "projet_reglement",
      etape_date: "2026-02-09",
      zone_ref: "RD-104",
    },
  },
];

export const COATICOOK_A_IDS = [
  "signal-coaticook-densification-ppcmoi-rd104",
] as const;
