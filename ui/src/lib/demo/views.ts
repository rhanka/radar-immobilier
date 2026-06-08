// "coordination" réintroduit (ÉV10) : journal h2a réel (signé/chaîné) ; remplace le stub ÉV5.
// "automation" retiré du nav (ÉV14) : l'Automatisation est désormais un onglet de la vue "console" (Sources).
// "backlog" ajouté (ÉV15) : tableau des évolutions (à faire / en cours / réalisé).
// "ontologie" ajouté (WP5) : studio de réconciliation graphify (état du projet par ville).
export type DemoView =
  | "onboarding"
  | "signaux"
  | "opportunity"
  | "grilles"
  | "console"
  | "ontologie"
  | "coordination"
  | "backlog";
