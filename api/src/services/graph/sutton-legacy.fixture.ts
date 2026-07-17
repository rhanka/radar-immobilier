import type { GraphifyNode } from "./graph-store.js";

/** Five signal-bearing nodes from graph/sutton/latest.json (2026-07-14). */
export const SUTTON_LEGACY_GRAPH_NODES: GraphifyNode[] = [
  {
    id: "event-sutton-refonte-reglementaire-2026-05-27",
    type: "DesignationEvent",
    label: "Refonte réglementaire complète — Sutton (séance extraordinaire 27 mai 2026)",
    properties: {
      description: "Adoption des premiers projets de règlements 358 à 363.",
      etape: "projet_reglement",
    },
  },
  {
    id: "event-sutton-ppcmoi-sentiers-maple-2026-06",
    type: "DesignationEvent",
    label: "PPCMOI — implantation sentiers/piste secteur rue Maple (juin 2026)",
    properties: { description: "PPCMOI pour de nouveaux sentiers.", etape: "ppcmoi" },
  },
  {
    id: "event-sutton-usage-conditionnel-santerre-2026-06",
    type: "DesignationEvent",
    label: "Usage conditionnel — lot 6418623 chemin Santerre (modification 2025-08-313)",
    properties: { description: "Modification d'une résolution d'usage conditionnel.", etape: "usage_conditionnel" },
  },
  {
    id: "signal-sutton-refonte-zonage-2026",
    type: "Signal",
    label: "Signal : refonte réglementaire complète Sutton — nouveau zonage et lotissement (2026)",
    properties: {
      category: "rezonage",
      intensite: "haute",
      description: "Refonte totale du zonage et du lotissement.",
      etape: "projet_reglement",
    },
  },
  {
    id: "signal-sutton-cptaq-terres-agricoles-2026",
    type: "Signal",
    label: "Signal : demandes CPTAQ — dézonage agricole chemin Mudgett/Woodard et Jordan",
    properties: {
      category: "rezonage",
      description: "Demandes CPTAQ pour utilisation non-agricole de lots.",
      etape: "inconnu",
    },
  },
];

export const SUTTON_A_IDS = ["signal-sutton-refonte-zonage-2026"] as const;
export const SUTTON_TRANSITION_IDS = [
  "event-sutton-refonte-reglementaire-2026-05-27",
  "signal-sutton-refonte-zonage-2026",
] as const;
