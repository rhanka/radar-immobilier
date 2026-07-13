/**
 * Steve-30 calibration dataset.
 *
 * Verbatim encoding of Steve Chaperon's 30-city review (cahier §3), sourced
 * from:
 *   - docs/reports/steve-eval-analyse-plan_2026-07-10.md (§A.3 table, the
 *     city→note→verdict grid)
 *   - docs/reports/steve-analyse-complete-planifiee_2026-07-11.md (§4)
 *
 * Every `note`, `verdict` and `pourquoi` is quoted/condensed from those
 * documents. Features are the MEASURABLE encoding of Steve's verdicts; a
 * feature he did not state is `null` (never invented). The note measures
 * ACQUISITION INTEREST, not detection quality (§3 intro).
 *
 * Mont-Saint-Hilaire has two distinct signals with two distinct notes (0 and
 * 7); they are kept as two rows. The 9 "Signaux indisponibles" cities carry
 * no note and no usable features (bug S1). The 6 "—" cities carry no note
 * (noise or precedent-only) but keep their features.
 */

import type { SteveFeatures } from "./features.js";

export type LabelStatus = "scored" | "no_note" | "signal_unavailable";

export interface SteveCityLabel {
  /** Stable id (city slug, plus a signal suffix when a city has several). */
  id: string;
  city: string;
  /** Distinguishes multiple signals of the same city; null otherwise. */
  signalLabel: string | null;
  /** Steve's /10 note, or null when he gave none. */
  note: number | null;
  /** Short verbatim verdict. */
  verdict: string;
  /** Condensed verbatim "why". */
  pourquoi: string;
  /** § references in the cahier / analysis. */
  sources: string[];
  status: LabelStatus;
  features: SteveFeatures;
}

/** All-null feature vector (unstated features stay null). */
const NULL_FEATURES: SteveFeatures = {
  residentialRelevance: null,
  changeNature: null,
  earliness: null,
  regulatoryExploitability: null,
  landExploitability: null,
  zonePrecedent: null,
  ownerType: null,
  projectScale: null,
  distanceMtl: null,
};

const feat = (partial: Partial<SteveFeatures>): SteveFeatures => ({
  ...NULL_FEATURES,
  ...partial,
});

export const STEVE30: SteveCityLabel[] = [
  // ── Scored rows (note != null) ────────────────────────────────────────
  {
    id: "rosemere",
    city: "Rosemère",
    signalLabel: null,
    note: 2,
    verdict: "Captation exemplaire; projet trop massif pour un petit développeur.",
    pourquoi:
      "Avis de motion règl. 801-71 capté dès la 1re étape; le projet publié identifie toutes les zones affectées et les nouvelles grilles. Suivre l'adoption.",
    sources: ["§2.1", "§3", "§4"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "refonte_complete",
      earliness: "avis_de_motion",
      projectScale: "trop_massif",
    }),
  },
  {
    id: "saint-mathieu-de-beloeil",
    city: "Saint-Mathieu-de-Beloeil",
    signalLabel: null,
    note: 7,
    verdict: "Ville mise sous alerte.",
    pourquoi:
      "Signal capté secondaire; le vrai élément (point 5.9, annexe L, cibles d'habitation, règl. 22.09.05.26, horizon 0-10 ans) trouvé manuellement. Un zonage de 2024 densifiait déjà deux zones résidentielles vacantes.",
    sources: ["§2.2", "§3", "§4", "§5"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      earliness: "projet",
    }),
  },
  {
    id: "saint-amable",
    city: "Saint-Amable",
    signalLabel: null,
    note: 7,
    verdict: "Cas nominal alimentant le processus manuel.",
    pourquoi:
      "Modification de zonage forte densité (règl. 712-46-2026). Recherches à faire: plan de zonage et projet de règlement.",
    sources: ["§3", "§5"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      earliness: "projet",
    }),
  },
  {
    id: "mont-saint-hilaire-s1",
    city: "Mont-Saint-Hilaire",
    signalLabel: "Signal 1",
    note: 0,
    verdict: "Règlement sur mesure pour un promoteur (non exploitable).",
    pourquoi: "Modification de zonage taillée pour un promoteur unique.",
    sources: ["§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      projectScale: "sur_mesure_promoteur",
    }),
  },
  {
    id: "mont-saint-hilaire-s2",
    city: "Mont-Saint-Hilaire",
    signalLabel: "Signal 2",
    note: 7,
    verdict: "Second projet capté; premier manqué.",
    pourquoi:
      "Règl. 1230-8 capté, mais le 1er projet de règlement (un mois plus tôt) manqué. Règlement introuvable en ligne; courriel au greffe.",
    sources: ["§2.2", "§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      earliness: "projet",
      regulatoryExploitability: "aucune",
    }),
  },
  {
    id: "saint-stanislas-de-kostka",
    city: "Saint-Stanislas-de-Kostka",
    signalLabel: null,
    note: 10,
    verdict: "Refonte complète captée au stade projet.",
    pourquoi:
      "Comparaison IA des grilles H (projet 451-2025 vs ancien 330-2018): zones H passant de l'unifamilial au multilogement. Petite municipalité à distance raisonnable de Montréal. Localiser les lots, valider la correspondance anciennes/nouvelles zones, suivre l'adoption.",
    sources: ["§2.1", "§3", "§4"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "refonte_complete",
      earliness: "projet",
      regulatoryExploitability: "grille_ou_zone",
      distanceMtl: "proche",
    }),
  },
  {
    id: "sutton",
    city: "Sutton",
    signalLabel: null,
    note: 10,
    verdict: "Refonte complète + levée du RCI dans le même PV.",
    pourquoi:
      "Règl. 358; levée du RCI en place depuis 2023 qui débloque la construction. Comparaison IA: grilles H, plan de zonage (fourni dans le projet, contrairement à Saint-Stanislas) et assouplissements généraux (stationnement, marges).",
    sources: ["§2.1", "§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "refonte_complete",
      earliness: "projet",
      regulatoryExploitability: "grille_ou_zone",
    }),
  },
  {
    id: "saint-boniface",
    city: "Saint-Boniface",
    signalLabel: null,
    note: 8,
    verdict: "Zone 317: 2 → 4 logements.",
    pourquoi:
      "Règl. 337 → 603. Plan et grille H-317 trouvés en ligne. Analyser les cadastres pour 4 logements, en commençant par la plus basse évaluation municipale.",
    sources: ["§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      earliness: "adopte",
      regulatoryExploitability: "grille_ou_zone",
      landExploitability: "lots_candidats",
    }),
  },
  {
    id: "coaticook",
    city: "Coaticook",
    signalLabel: null,
    note: 8,
    verdict: "PPCMOI 12 logements au lieu de 9; ouvre la porte à toute la zone.",
    pourquoi:
      "Zone RD-104 identifiée directement. Pas un projet direct, mais crée un précédent pour toute la zone. Lots manquants sur la carte du radar → recours à la carte interactive de la ville. Analyser la grille RD-104.",
    sources: ["§2.1", "§2.2", "§3", "§4"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "ppcmoi",
      earliness: "projet",
      regulatoryExploitability: "zone_seule",
      landExploitability: "lots_manquants",
      zonePrecedent: true,
    }),
  },
  {
    id: "saint-gilbert",
    city: "Saint-Gilbert",
    signalLabel: null,
    note: 6,
    verdict: "Unifamilial → duplex en îlot déstructuré (zone agricole).",
    pourquoi:
      "Projet U-161-2026. Un second projet de règlement existe, non capté. Valider les droits (démolition/reconstruction vs terrain vacant); repérer les lots subdivisables.",
    sources: ["§2.2", "§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_mineure",
      earliness: "projet",
      landExploitability: "lots_candidats",
    }),
  },
  {
    id: "neuville",
    city: "Neuville",
    signalLabel: null,
    note: 4,
    verdict: "Suivi informatif.",
    pourquoi:
      "CPTAQ, lot 3 507 503, capté dans l'ordre du jour avant le PV. Propriétaire: société de portefeuille d'un constructeur (depuis 2006), faible chance de vente.",
    sources: ["§2.1", "§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "cptaq",
      earliness: "ordre_du_jour",
      ownerType: "societe_portefeuille",
    }),
  },
  {
    id: "saint-raymond",
    city: "Saint-Raymond",
    signalLabel: null,
    note: 9,
    verdict: "Contacter les 2 propriétaires.",
    pourquoi:
      "3 zones haute densité HC-13/14/15 (règl. 921-26 à 923-26); HC-15: 12-24 logements; HC-14 renvoie à la section 23.6 (question en suspens). Propriétaires identifiés: une ferme (un seul propriétaire, approche possible) et un investisseur (depuis 2021).",
    sources: ["§3", "§4"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      earliness: "projet",
      regulatoryExploitability: "grille_ou_zone",
      ownerType: "ferme",
    }),
  },
  {
    id: "saint-come-liniere",
    city: "Saint-Côme-Linière",
    signalLabel: null,
    note: 3,
    verdict: "Dossier fermé.",
    pourquoi:
      "Pétition demandant une modification de zonage (pas de numéro de règlement capté). La ville est propriétaire et en processus de vente du terrain.",
    sources: ["§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "petition",
      ownerType: "ville",
    }),
  },
  {
    id: "saint-raphael",
    city: "Saint-Raphaël",
    signalLabel: null,
    note: 10,
    verdict: "Zones et lots déjà découpés par la ville: gros atout si le radar les affiche.",
    pourquoi:
      "Refonte complète (projet 2026-244); résumé et projet trouvés en ligne. Analyser les nouveaux cadastres.",
    sources: ["§2.1", "§3", "§4"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "refonte_complete",
      earliness: "projet",
      regulatoryExploitability: "grille_et_lot",
      landExploitability: "lots_confirmes",
    }),
  },
  {
    id: "petite-riviere-saint-francois",
    city: "Petite-Rivière-Saint-François",
    signalLabel: null,
    note: 2,
    verdict: "Terrain détenu par une firme immobilière — non exploitable.",
    pourquoi: "Densification zone U-24 (logements, étages).",
    sources: ["§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_mineure",
      ownerType: "firme_immobiliere",
    }),
  },
  {
    id: "stratford",
    city: "Stratford",
    signalLabel: null,
    note: 0,
    verdict: "Extension d'un terrain de camping — non pertinent.",
    pourquoi: "Règl. 1257, zone RU-13.",
    sources: ["§3"],
    status: "scored",
    features: feat({
      residentialRelevance: "non_residential",
      changeNature: "non_residentiel",
    }),
  },

  // ── No-note "—" rows (noise or precedent-only) ────────────────────────
  {
    id: "mont-tremblant",
    city: "Mont-Tremblant",
    signalLabel: null,
    note: null,
    verdict: "Pas de densification — non pertinent.",
    pourquoi: "2 signaux environnementaux (PIIA bassins versants; calcul des espaces naturels).",
    sources: ["§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "non_residential",
      changeNature: "non_residentiel",
    }),
  },
  {
    id: "saint-frederic",
    city: "Saint-Frédéric",
    signalLabel: null,
    note: null,
    verdict: "Non résidentiel — non pertinent.",
    pourquoi: "Zone industrielle I-93; zone aéroportuaire → agricole (A-16).",
    sources: ["§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "non_residential",
      changeNature: "non_residentiel",
    }),
  },
  {
    id: "saint-charles-borromee",
    city: "Saint-Charles-Borromée",
    signalLabel: null,
    note: null,
    verdict: "Non pertinent, mais découpage zones/lots impeccable sur la carte.",
    pourquoi: "Résidentiel → commercial (C-17).",
    sources: ["§2.2", "§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "non_residential",
      changeNature: "non_residentiel",
    }),
  },
  {
    id: "sainte-cecile-de-milton",
    city: "Sainte-Cécile-de-Milton",
    signalLabel: null,
    note: null,
    verdict: "Pas d'opportunité immédiate, mais crée un précédent dans la zone.",
    pourquoi: "3 → 4 logements (lot 6 367 606).",
    sources: ["§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_mineure",
      zonePrecedent: true,
    }),
  },
  {
    id: "cowansville",
    city: "Cowansville",
    signalLabel: null,
    note: null,
    verdict: "Bon signal, mais terrains détenus par un promoteur.",
    pourquoi: "Densification zone Rc-23.",
    sources: ["§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "densification_multi",
      ownerType: "promoteur",
    }),
  },
  {
    id: "champlain",
    city: "Champlain",
    signalLabel: null,
    note: null,
    verdict: "Signal d'assouplissement, pas une opportunité directe.",
    pourquoi: "Demande d'autorisation: 64 terrains résidentiels.",
    sources: ["§3"],
    status: "no_note",
    features: feat({
      residentialRelevance: "residential",
      changeNature: "assouplissement",
    }),
  },

  // ── "Signaux indisponibles" rows (bug S1, no note, no features) ────────
  ...(
    [
      "Sainte-Catherine",
      "Hemmingford",
      "Plaisance",
      "Notre-Dame-de-Lourdes",
      "Chelsea",
      "Alma",
      "Preissac",
      "Rimouski",
      "La Sarre",
    ] as const
  ).map(
    (city): SteveCityLabel => ({
      // These 9 city names are accent-free, so a plain slug is sufficient.
      id: city.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      city,
      signalLabel: null,
      note: null,
      verdict: "Signaux indisponibles malgré un signal annoncé — bogue à corriger (S1).",
      pourquoi:
        "Le radar affirme un signal mais affiche « Signaux indisponibles »; aucune feature exploitable tant que le bug n'est pas corrigé.",
      sources: ["§2.2", "§3"],
      status: "signal_unavailable",
      features: { ...NULL_FEATURES },
    }),
  ),
];

/** Rows with a numeric note — the labelled subset used for convergence. */
export const STEVE30_SCORED: SteveCityLabel[] = STEVE30.filter(
  (r): r is SteveCityLabel & { note: number } => r.note !== null,
);
