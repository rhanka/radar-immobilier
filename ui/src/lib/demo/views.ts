// "coordination" réintroduit (ÉV10) : journal h2a réel (signé/chaîné) ; remplace le stub ÉV5.
// "automation" retiré du nav (ÉV14) : l'Automatisation est désormais un onglet de la vue "console" (Sources).
// "backlog" ajouté (ÉV15) : tableau des évolutions (à faire / en cours / réalisé).
// "ontologie" ajouté (WP5) : studio de réconciliation graphify (état du projet par ville).
// "ciblage" ajouté (WP4) : pipeline étape 1 — plans de ciblage (quoi collecter, sans I/O).
// "sources" ajouté (WP A.1.4) : carte maturité recueil par ville × source.
// "carte-signaux" ajouté : carte QC villes avec compteur signaux 6 mois.
// "carte-opportunites" ajouté : carte ville/zones avec signaux à approfondir.
// "carte-evaluation" ajouté : évaluation zone/lots + grilles de scoring.
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
  | "sources"
  | "carte-signaux"
  | "carte-opportunites"
  | "carte-evaluation";
