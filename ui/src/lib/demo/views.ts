// "coordination" réintroduit (ÉV10) : journal h2a réel (signé/chaîné) ; remplace le stub ÉV5.
// "automation" retiré du nav (ÉV14) : l'Automatisation est désormais un onglet de la vue "console" (Sources).
// "backlog" ajouté (ÉV15) : tableau des évolutions (à faire / en cours / réalisé).
// "ontologie" ajouté (WP5) : studio de réconciliation graphify (état du projet par ville).
// "ciblage" ajouté (WP4) : pipeline étape 1 — plans de ciblage (quoi collecter, sans I/O).
// "sources" ajouté (WP A.1.4) : carte maturité recueil par ville × source.
export type DemoView =
  | "onboarding"
  | "ciblage"
  | "signaux"
  | "opportunity"
  | "grilles"
  | "console"
  | "ontologie"
  | "coordination"
  | "backlog"
  | "sources";
