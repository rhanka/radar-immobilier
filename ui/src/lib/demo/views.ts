// Navigation réduite à 4 vues principales (WP A.1 réorientation §4).
// Les vues internes (admin/dev) restent accessibles via le menu "admin/dev"
// mais ne font plus partie de la navigation principale.
//
// 4 vues principales :
//   "signaux"     : Carte Québec/villes — aplats colorés, nb changements de zonage / 6 mois
//   "opportunity" : Opportunités ville/zones — classement dossiers
//   "evaluation"  : Évaluation zone/lots — grilles de scoring (fusion "carte-evaluation" + "grilles")
//   "sources"     : Sources — maturité recueil par ville
//
// Vues admin/dev (hors nav principale — code intact) :
//   "onboarding", "ciblage", "ontologie", "coordination", "backlog", "console", "geo"
// Legacy (conservés pour compatibilité deep-links) :
//   "grilles", "carte-signaux", "carte-opportunites", "carte-evaluation"
export type DemoView =
  // ── 4 vues principales ────────────────────────────────────────────────────
  | "signaux"
  | "opportunity"
  | "evaluation"
  | "sources"
  // ── Admin/dev (hors nav principale) ──────────────────────────────────────
  | "onboarding"
  | "ciblage"
  | "grilles"
  | "console"
  | "ontologie"
  | "coordination"
  | "backlog"
  // ── WP6 — Kanban WorkPackages (projection 4 niveaux) ───────────────────────
  | "kanban"
  // ── G3 — Vue géo intégration ───────────────────────────────────────────────
  | "geo"
  // ── Legacy (conservé pour compatibilité deep-links) ───────────────────────
  | "carte-signaux"
  | "carte-opportunites"
  | "carte-evaluation"
  | "admin";
