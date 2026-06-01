// "coordination" retiré du nav (stub ÉV5) : la coordination réelle arrive en ÉV9 (chat) + ÉV10 (h2a).
// "automation" retiré du nav (ÉV14) : l'Automatisation est désormais un onglet de la vue "console" (Sources).
// "backlog" ajouté (ÉV15) : tableau des évolutions (à faire / en cours / réalisé).
export type DemoView =
  | "onboarding"
  | "signaux"
  | "opportunity"
  | "grilles"
  | "console"
  | "backlog";
