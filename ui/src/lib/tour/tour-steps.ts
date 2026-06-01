import type { DemoView } from "$lib/demo/views.js";

export interface TourStep {
  id: string;
  view: DemoView;
  title: string;
  /** Corps de la bulle (HTML interdit ; texte brut en francais, sans tiret cadratain). */
  body: string;
}

/**
 * Parcours guide de la demo couvrant les 5 vues.
 * Ordre : Onboarding > Signaux > Opportunites > Grilles > Sources.
 * L'Automatisation est desormais un onglet de la vue Sources (ÉV14).
 *
 * Les ancres data-tour sont posees directement dans les composants views
 * (null => bulle centree).
 */
export const tourSteps: TourStep[] = [
  // ── 1. Onboarding ──────────────────────────────────────────────────────────
  {
    id: "onboarding-intro",
    view: "onboarding",
    title: "Bienvenue dans Radar immobilier",
    body: "Le radar detecte les opportunites de densification residentielles avant le marche. Cette visite guidee presente les 6 ecrans en 15 etapes.",
  },
  {
    id: "onboarding-municipalite",
    view: "onboarding",
    title: "Etape 1 : choisir la municipalite",
    body: "Selectionnez la ville cible (ex. Salaberry-de-Valleyfield). Chaque ville a son propre corpus de sources et de signaux historiques.",
  },
  {
    id: "onboarding-sources",
    view: "onboarding",
    title: "Etape 2 : activer les sources",
    body: "Choisissez quelles sources scanner : zonage, CPTAQ, PPCMOI, consultations publiques... Seules les sources activees alimenteront le fil de signaux.",
  },

  // ── 2. Signaux ─────────────────────────────────────────────────────────────
  {
    id: "signaux-intro",
    view: "signaux",
    title: "Fil de signaux de triage",
    body: "Chaque source detectee devient un signal. Le fil classe les signaux par priorite, pret pour le triage quotidien.",
  },
  {
    id: "signaux-score",
    view: "signaux",
    title: "Score /10 + confiance",
    body: "Chaque signal porte une valeur /10 (calibree par type de signal dans la VISION) et un niveau de confiance (Haute / Moyenne / Faible). Ces deux axes sont independants.",
  },
  {
    id: "signaux-tri",
    view: "signaux",
    title: "Deux tris distincts",
    body: "Triez par score /10 (importance metier) ou par priorite VISION (ordre Priorite 1 > 4). Le badge Simulation identifie les exemples illustratifs.",
  },
  {
    id: "signaux-approfondir",
    view: "signaux",
    title: "Approfondir un signal",
    body: "Le bouton Approfondir bascule vers l'ecran Opportunites et filtre sur le dossier correspondant pour demarrer l'analyse complete.",
  },

  // ── 3. Opportunites ────────────────────────────────────────────────────────
  {
    id: "opportunites-intro",
    view: "opportunity",
    title: "Du signal au dossier d'opportunite",
    body: "L'ecran Opportunites transforme un signal en dossier structure : master-detail, 6 phases de preuves, score /100.",
  },
  {
    id: "opportunites-phases",
    view: "opportunity",
    title: "6 phases : faisceau de preuves",
    body: "Signal > Ancrage foncier > Contraintes > Marche > Contexte > Scoring. Chaque phase accumule des preuves tagguees Fait / Hypothese / Non-disponible.",
  },
  {
    id: "opportunites-score",
    view: "opportunity",
    title: "Score /100 + bascule Reel / Simulation",
    body: "En mode Reel, seules les preuves verifiees comptent dans le score (axes potentiel 30%, risque 20%, timing 20%, faisabilite 15%, marche 15%). La simulation inclut les hypotheses.",
  },

  // ── 4. Grilles ─────────────────────────────────────────────────────────────
  {
    id: "grilles-intro",
    view: "grilles",
    title: "Grilles : le modele de score",
    body: "L'ecran Grilles documente les deux echelles : tri de signal /10 (VISION) et score d'opportunite /100 (PROCESS). Elles ne se confondent pas.",
  },
  {
    id: "grilles-detail",
    view: "grilles",
    title: "Grille par axe PROCESS",
    body: "Chaque axe (potentiel, risque, timing, faisabilite, marche) est decompose en criteres ponderes. Les resultats pilotes sur les dossiers Valleyfield sont affiches.",
  },

  // ── 5. Sources (Console) ───────────────────────────────────────────────────
  {
    id: "console-intro",
    view: "console",
    title: "Console sources et jobs",
    body: "Qualification du catalogue de sources (cadran valeur x complexite), approfondissement de chaque source, et supervision des jobs d'ingestion.",
  },
  {
    id: "console-qualification",
    view: "console",
    title: "Cadran valeur x complexite",
    body: "Chaque source est positionnee selon sa valeur metier (Y) et sa complexite d'acces (X). Les sources en haut a gauche sont les priorites immediates de connecteur.",
  },

  {
    id: "console-automatisation",
    view: "console",
    title: "Onglet Automatisation : cadences et benchmark",
    body: "Dans Sources, l'onglet Automatisation presente les cadences de traitement (initial, recurrent, approfondissement) et le benchmark des agents IA. Jobs = executions unitaires ; Automatisation = cadences qui planifient ces jobs.",
  },
];
