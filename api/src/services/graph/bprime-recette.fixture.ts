import type { GraphSignalProjectionRow } from "./graph-store.js";

/**
 * Fixtures DÉTERMINISTES de la recette B′ × Steve-30.
 *
 * Contrat d'acceptation : docs/reports/recette/RECETTE_VIVIER_BPRIME_STEVE30.md.
 * Chaque nœud reflète FIDÈLEMENT le signal décrit dans la table de recette et/ou
 * packages/radar-scoring/src/steve30/dataset.ts. Aucune valeur favorable inventée :
 * le texte du signal est terse (tel que capté par graphify), PAS l'analyse manuelle
 * de Steve (qui n'est jamais dans le nœud). Provenance notée par ville.
 *
 * Le compte de recette (colonne « B′ (cible) ») est mesuré via le VRAI chemin
 * serveur : `aggregateGraphSignalProjectionRows` → `vivierV2Counts`, puis le badge
 * par défaut de la vue B (`countForVivierCity`, axes {z,r,p}={✓,✓,✓}) =
 * `stageCounts.avis_motion + stageCounts.projet_reglement` (précoce).
 */

const props = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  properties: { ...extra },
});

/** Raccourci de construction d'une ligne de projection serveur. */
function row(
  citySlug: string,
  r: Omit<GraphSignalProjectionRow, "citySlug" | "props" | "sourceRef"> &
    Partial<Pick<GraphSignalProjectionRow, "props" | "sourceRef">>,
): GraphSignalProjectionRow {
  return {
    citySlug,
    props: props(),
    sourceRef: null,
    ...r,
  };
}

/**
 * Provenance des étapes/textes :
 * - Les 3× refontes (Saint-Stanislas, Sutton, Saint-Raphaël) : recette lignes 13-15
 *   + dataset (changeNature=refonte_complete). Émises en PAIRE DesignationEvent +
 *   Signal, comme la fixture réelle sutton-legacy.fixture.ts (graph/sutton/latest.json)
 *   → compte cible ✓2 = la paire. Texte terse « refonte complète », SANS marqueur
 *   résidentiel explicite → aujourd'hui `residentiel=indéterminé` (exclue de B).
 * - Étapes : recette (Saint-Stanislas=avis_motion, Sutton/Saint-Raphaël=projet_reglement).
 */
export const BPRIME_RECETTE_ROWS: readonly GraphSignalProjectionRow[] = [
  // ── #1 Saint-Stanislas-de-Kostka — refonte 451-2025 (avis_motion). R2. ──────
  // Recette : « refonte 451-2025 = avis_motion (précoce ✓) ; exclue car
  // résidentiel=indéterminé ». B actuel ✗0 → B′ ✓2 (R2 repêche la refonte).
  row("saint-stanislas-de-kostka", {
    id: "event-saint-stanislas-refonte-451-2025",
    type: "DesignationEvent",
    label: "Refonte réglementaire complète — projet 451-2025 (Saint-Stanislas-de-Kostka)",
    description: "Refonte complète du plan de zonage; remplace le règlement 330-2018.",
    etapeAnnote: "avis_motion",
  }),
  row("saint-stanislas-de-kostka", {
    id: "signal-saint-stanislas-refonte-451-2025",
    type: "Signal",
    category: "rezonage",
    label: "Refonte du zonage — projet 451-2025",
    description: "Refonte complète du zonage municipal.",
    etapeAnnote: "avis_motion",
  }),

  // ── #2 Sutton — refonte 358 (projet_reglement). R1 + R2. ───────────────────
  // Recette : « refonte 358 = projet_reglement (précoce ✓) ; double verrou :
  // résidentiel=indéterminé + dérive d'étape → consultation ». La dérive vient du
  // texte « Adoption des premiers projets… » qui pousse l'étape dérivée à
  // `adoption` alors que l'étape ANNOTÉE est `projet_reglement` (R1 la restaure).
  // Texte fidèle à sutton-legacy.fixture.ts (graph/sutton/latest.json 2026-07-14).
  row("sutton", {
    id: "event-sutton-refonte-reglementaire-2026-05-27",
    type: "DesignationEvent",
    label: "Refonte réglementaire complète — Sutton (séance extraordinaire 27 mai 2026)",
    description: "Adoption des premiers projets de règlements 358 à 363.",
    etapeAnnote: "projet_reglement",
  }),
  row("sutton", {
    id: "signal-sutton-refonte-zonage-2026",
    type: "Signal",
    category: "rezonage",
    intensite: "haute",
    label: "Signal : refonte réglementaire complète Sutton — nouveau zonage et lotissement (2026)",
    description: "Refonte totale du zonage et du lotissement.",
    etapeAnnote: "projet_reglement",
  }),
  // Bruit Sutton correctement exclu (agricole) — non-régression.
  row("sutton", {
    id: "signal-sutton-cptaq-terres-agricoles-2026",
    type: "Signal",
    category: "rezonage",
    label: "Signal : demandes CPTAQ — dézonage agricole chemin Mudgett/Woodard et Jordan",
    description: "Demandes CPTAQ pour utilisation non-agricole de lots.",
    etapeAnnote: "inconnu",
  }),

  // ── #3 Saint-Raphaël — refonte 2026-244 (projet_reglement). R2. ────────────
  // Recette : « refonte 2026-244 = projet_reglement (précoce ✓) ; exclue car
  // résidentiel=indéterminé ». B actuel ✗0 → B′ ✓2.
  row("saint-raphael", {
    id: "event-saint-raphael-refonte-2026-244",
    type: "DesignationEvent",
    label: "Refonte réglementaire complète — projet 2026-244 (Saint-Raphaël)",
    description: "Refonte complète; nouveaux cadastres et grilles.",
    etapeAnnote: "projet_reglement",
  }),
  row("saint-raphael", {
    id: "signal-saint-raphael-refonte-2026-244",
    type: "Signal",
    category: "rezonage",
    label: "Refonte du zonage — projet 2026-244",
    description: "Refonte complète du zonage et du lotissement.",
    etapeAnnote: "projet_reglement",
  }),

  // ── #13 Rosemère — REFONTE à densification COMMERCIALE (règl. 801-71). R3>R2.
  // Recette ligne 25 : « dans B via "densification commerciale" lu comme
  // résidentiel | R3+R4 le sortent ». Dataset : refonte_complete. Garde-fou clé :
  // c'est une REFONTE (R2 voudrait la repêcher) mais franchement COMMERCIALE →
  // R3 doit PRIMER sur R2 et l'exclure. Le marqueur faible « densification » ne
  // suffit pas à la garder. B′ ✗0.
  row("rosemere", {
    id: "signal-rosemere-801-71",
    type: "Signal",
    category: "rezonage",
    label: "Avis de motion — refonte règlement 801-71 (Rosemère)",
    description: "Refonte : densification commerciale des zones visées; nouvelles grilles.",
    etapeAnnote: "avis_motion",
  }),

  // ── #18 Saint-Charles-Borromée — résidentiel → commercial (C-17). R3. ──────
  // Recette ligne 30 : « dans B via "densification commerciale" = le faux positif
  // exact que Steve dénonce | R3 le sort ». Dataset : « Résidentiel → commercial
  // (C-17) ». B actuel ✓1 → B′ ✗0. « résidentielle » (marqueur FAIBLE, c'est
  // l'usage SOURCE) le garde résidentiel aujourd'hui ; R3 (destination commerciale
  // franche) l'exclut.
  row("saint-charles-borromee", {
    id: "signal-saint-charles-borromee-c17",
    type: "Signal",
    category: "rezonage",
    label: "Modification de zonage — zone C-17 (Saint-Charles-Borromée)",
    description: "Requalification d'une zone résidentielle en zone commerciale (C-17).",
    etapeAnnote: "projet_reglement",
  }),

  // ── #29 Rimouski — SPAR 328 log. (garde) + pôle commercial régional (retire). R4.
  // Recette ligne 41 : « SPAR 328 log. + "pôle commercial régional" | R4 retire le
  // "pôle" ; SPAR reste ». B actuel ✓2 → B′ ✓1.
  row("rimouski", {
    id: "signal-rimouski-spar-328-logements",
    type: "Signal",
    category: "densification",
    label: "Projet SPAR — 328 logements (Rimouski)",
    description: "Densification résidentielle, 328 logements.",
    etapeAnnote: "projet_reglement",
  }),
  row("rimouski", {
    id: "signal-rimouski-pole-commercial-regional",
    type: "Signal",
    category: "rezonage",
    label: "Pôle commercial régional — secteur est (Rimouski)",
    description: "Densification du pôle commercial régional.",
    etapeAnnote: "avis_motion",
  }),

  // ── #10 Saint-Gilbert — U-161 (garde) + 2e projet perdu par dérive. R1. ────
  // Recette ligne 22 : « U-161 rés=oui ; 2ᵉ signal avis motion perdu par dérive
  // d'étape | R1 récupère le 2ᵉ ». B actuel ✓1 → B′ ✓2. Le 2ᵉ signal est ANNOTÉ
  // avis_motion mais son texte « second projet » pousse l'étape dérivée à
  // second_projet (tardive) → perdu du filtre précoce sans R1.
  row("saint-gilbert", {
    id: "signal-saint-gilbert-u161-2026",
    type: "Signal",
    category: "densification",
    label: "Projet U-161-2026 (Saint-Gilbert)",
    description: "Unifamilial vers duplex.",
    etapeAnnote: "projet_reglement",
  }),
  row("saint-gilbert", {
    id: "signal-saint-gilbert-second-reglement",
    type: "Signal",
    category: "rezonage",
    label: "Zonage résidentiel — règlement (Saint-Gilbert)",
    description: "Second projet de règlement modifiant le zonage résidentiel.",
    etapeAnnote: "avis_motion",
  }),

  // ── #6 Coaticook — PPCMOI 12 logements (projet). Non-régression (inchangé). ─
  // Texte fidèle à coaticook-legacy.fixture.ts (graph/coaticook/latest.json).
  // Recette ✓2 = 2 nœuds en production ; ici 1 nœud modélisé qualifié précoce,
  // inchangé par R1–R4 (lacune de compte assumée : le 2e nœud prod n'est pas modélisé).
  row("coaticook", {
    id: "signal-coaticook-densification-ppcmoi-rd104",
    type: "Signal",
    category: "ppcmoi",
    nbUnitesMax: "12",
    label: "",
    description:
      "PPCMOI pour construction d'un bâtiment résidentiel de 12 logements au 103-123 rue Saint-Marc (zone RD-104).",
    etapeAnnote: "projet_reglement",
  }),

  // ── #11 Neuville — CPTAQ agricole. Non-régression (exclu, souhaité ✗0). ─────
  // Recette ligne 23 : « CPTAQ rés=non (agricole) ». R2 ne doit PAS le repêcher.
  row("neuville", {
    id: "signal-neuville-cptaq-lot-3507503",
    type: "Signal",
    category: "cptaq",
    label: "Demande CPTAQ — lot 3 507 503 (Neuville)",
    description: "Exploitation agricole; utilisation à des fins autres qu'agricoles.",
    etapeAnnote: "projet_reglement",
  }),
];

/**
 * Attendu de recette par ville (colonne « B′ (cible) »), métrique = badge B par
 * défaut (précoce). `bActuel` = colonne « B actuel » de la recette FIGÉE (baseline
 * production). `provable` = false quand le compte prod dépend de nœuds hors fixture.
 *
 * NOTE HONNÊTE (état de cette branche) : R3/R4 sont DÉJÀ actifs dans le chemin B
 * serveur (via `applyBPrimeExclusion`/`classifyBPrime` dans `classifyVivierSignal`).
 * Mesuré sur ces fixtures, Rosemère/Saint-Charles-Borromée/pôle-Rimouski sont donc
 * DÉJÀ exclus AVANT R1/R2. L'écart ROUGE réel de cette recette = R1 (dérive d'étape)
 * + R2 (refontes indéterminées). R3/R4 sont ici VÉRIFIÉES tenir (vert), pas
 * nouvellement corrigées ; le garde-fou Rosemère prouve que R3 PRIME sur R2.
 */
export interface RecetteExpectation {
  citySlug: string;
  label: string;
  bActuel: number;
  bPrime: number;
  rule: string;
  provable: boolean;
}

export const BPRIME_RECETTE_EXPECTATIONS: readonly RecetteExpectation[] = [
  { citySlug: "saint-stanislas-de-kostka", label: "Saint-Stanislas-de-Kostka", bActuel: 0, bPrime: 2, rule: "R2", provable: true },
  { citySlug: "sutton", label: "Sutton", bActuel: 0, bPrime: 2, rule: "R1+R2", provable: true },
  { citySlug: "saint-raphael", label: "Saint-Raphaël", bActuel: 0, bPrime: 2, rule: "R2", provable: true },
  { citySlug: "rosemere", label: "Rosemère", bActuel: 1, bPrime: 0, rule: "R3", provable: true },
  { citySlug: "saint-charles-borromee", label: "Saint-Charles-Borromée", bActuel: 1, bPrime: 0, rule: "R3", provable: true },
  { citySlug: "rimouski", label: "Rimouski", bActuel: 2, bPrime: 1, rule: "R4", provable: true },
  { citySlug: "saint-gilbert", label: "Saint-Gilbert", bActuel: 1, bPrime: 2, rule: "R1", provable: true },
  { citySlug: "coaticook", label: "Coaticook", bActuel: 1, bPrime: 1, rule: "—", provable: true },
  { citySlug: "neuville", label: "Neuville", bActuel: 0, bPrime: 0, rule: "—", provable: true },
];
