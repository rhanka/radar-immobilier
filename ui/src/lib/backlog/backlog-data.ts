// ÉV15 — Backlog seed.
//
// The seed is faithful to what actually shipped: each item is derived from a
// real evolution (`docs/spec/SPEC_EVOL_*.md` + `PLAN.md`) and the merged Git
// history (PR numbers verified via `gh pr list --state merged`). No fictional
// item is invented. Future / not-yet-started UAT-round-5 items sit in "a-faire".
//
// The Backlog view loads dynamic items from `GET /api/backlog` (added through
// the "Ajouter une demande" affordance) and merges them with this static seed,
// de-duplicated by `id`.

/** Lifecycle status of a backlog item (board column). */
export type BacklogStatut = "a-faire" | "en-cours" | "realise";

/** A single backlog item (evolution). */
export interface BacklogItem {
  /** Stable identifier (kebab-case slug). */
  id: string;
  /** Short evolution code, e.g. "ÉV11". */
  code: string;
  /** French title. */
  titre: string;
  /** French description (shown in the accordion). */
  description: string;
  /** Board column. */
  statut: BacklogStatut;
  /** Merged PR number, when the work shipped through a known PR. */
  pr?: number;
}

/**
 * Static seed derived from the real evolution track.
 *
 * Realised (merged): ÉV1–ÉV9, ÉV11, ÉV12, the chat shortlist fix, the chat
 * model selector, and ÉV14. (ÉV10 / h2a real adapter is deferred, so it sits in
 * "a-faire".)
 * In progress: ÉV15 (this very branch).
 * To do: remaining UAT-round-5 / future items.
 */
export const backlogSeed: readonly BacklogItem[] = [
  // ── Réalisé (merged) ──────────────────────────────────────────────────────
  {
    id: "ev1-socle-states-scoring",
    code: "ÉV1",
    titre: "Socle : modèle d'états + grilles de score",
    description:
      "Modèle d'états (signal→N opportunités) + @radar/scoring (grilles 0-5 + agrégat tenant compte de la disponibilité) + calibration sur les 3 pilotes Valleyfield + vue Grilles.",
    statut: "realise",
    pr: 18,
  },
  {
    id: "ev2-radar-t1-signals",
    code: "ÉV2",
    titre: "Radar T1 : flux de signaux",
    description:
      "Flux de signaux avec valeur et confiance triables séparément (/10 par type), filtre statut + réel/simulation, action « Approfondir » vers les Opportunités.",
    statut: "realise",
    pr: 19,
  },
  {
    id: "ev3-opportunites-t2-funnel",
    code: "ÉV3",
    titre: "Opportunités T2 : entonnoir 6 phases",
    description:
      "Entonnoir progressif en 6 phases (faisceau de preuves) + score d'opportunité honnête (agrégat, partiel/plafonné) + bascule globale réel/simulation + relation signal→N opportunités.",
    statut: "realise",
    pr: 20,
  },
  {
    id: "ev4-onboarding-sources",
    code: "ÉV4",
    titre: "Onboarding T0 : catalogue de sources",
    description:
      "Vue Onboarding T0 : checklist du catalogue de sources (groupé par recommandation) + panneau de rétro-analyse sur 2 ans + CTA de démonstration « Lancer l'onboarding ».",
    statut: "realise",
    pr: 21,
  },
  {
    id: "ev5-coordination-chat-stub",
    code: "ÉV5",
    titre: "Coordination humain↔agents (concepts h2a)",
    description:
      "Spike h2a : interface de coordination découplée (rôle / POLICY anti-triche / journal append-only en mémoire) + vue chat « Coordination » stub. L'adaptateur h2a réel reste différé.",
    statut: "realise",
    pr: 22,
  },
  {
    id: "ev6-consoles-t3-t4",
    code: "ÉV6",
    titre: "Console T3/T4 : qualification + jobs",
    description:
      "Vue Console : qualification des sources (groupées par recommandation) + approfondissement par source + tableau de suivi des jobs (T4).",
    statut: "realise",
    pr: 23,
  },
  {
    id: "ev7-automation-benchmark",
    code: "ÉV7",
    titre: "Automatisation + benchmark par étape",
    description:
      "Cadences de traitement (initial / récurrent / approfondissement) + liste de connecteurs + récapitulatif de benchmark agent honnête par étape (règle Fair Benchmarking).",
    statut: "realise",
    pr: 24,
  },
  {
    id: "ev8-recadrage-demo",
    code: "ÉV8",
    titre: "Recadrage démo : app-shell + 100% design-system",
    description:
      "App-shell dense + registre des bugs UAT résolus + passage à 100% design-system. Inclut les clôtures de bugs UAT (réel-mode honnête, acronymes, visite guidée, contribution par source).",
    statut: "realise",
    pr: 26,
  },
  {
    id: "ev9-chat-reel",
    code: "ÉV9",
    titre: "Chat réel multi-fournisseurs",
    description:
      "Chat-ui réel (@sentropic/chat-ui + chat-core + llm-mesh), multi-fournisseurs et neutre, tokens streamés via SSE. Branché sur les vrais fournisseurs configurés par variables d'environnement.",
    statut: "realise",
    pr: 34,
  },
  {
    id: "chat-shortlist-fix",
    code: "Fix chat",
    titre: "Correctif chat : shortlist de modèles réelle",
    description:
      "Câble la shortlist de modèles réelle de sentropic dans le chat (le chat ne fonctionnait pas auparavant), puis sélecteur de modèle groupé par fournisseur (design sentropic).",
    statut: "realise",
    pr: 35,
  },
  {
    id: "ev11-automation-reelle",
    code: "ÉV11",
    titre: "Collecte RÉELLE d'une source publique",
    description:
      "Collecte réelle, côté serveur et sans clé, d'une source publique de Valleyfield (avis publics) : POST /api/automation/collect/:source renvoie des items parsés. Aucune donnée fabriquée.",
    statut: "realise",
    pr: 32,
  },
  {
    id: "ev12-uat-round4",
    code: "ÉV12",
    titre: "UI round 4 : nav horizontale + accordéons + master-detail",
    description:
      "Navigation horizontale + accordéon Signaux + libellé de filtre lisible (lot 1), puis Opportunités master-detail + Sources en accordéon + refonte Grilles (lot 2).",
    statut: "realise",
    pr: 31,
  },
  {
    id: "ev14-uat-round5",
    code: "ÉV14",
    titre: "UAT round 5 : bande latérale uniforme + Automatisation→Sources",
    description:
      "Bande latérale standardisée (w-72) sur les 5 vues via ViewLayout + Automatisation déplacée comme onglet de Sources (Jobs vs Automatisation clarifié) + sélection Opportunités renforcée.",
    statut: "realise",
    pr: 37,
  },

  // ── En cours ──────────────────────────────────────────────────────────────
  {
    id: "ev15-backlog",
    code: "ÉV15",
    titre: "Vue Backlog pilotée par le chat",
    description:
      "Vue Backlog (À faire / En cours / Réalisé) seedée des évolutions réelles + API add/process (in-memory) + affordance « Ajouter une demande ». Les outils chat ajouter_demande/traiter_demande sont documentés en suivi (voir verdict de faisabilité).",
    statut: "en-cours",
  },

  // ── À faire (UAT round 5 restant + futur) ─────────────────────────────────
  {
    id: "ev10-h2a-real-adapter",
    code: "ÉV10",
    titre: "Adaptateur h2a réel (coordination signée)",
    description:
      "Adaptateur @sentropic/h2a réel avec signature cryptographique et journal/timeline persistés (SQL), au-delà du spike découplé d'ÉV5. Différé en escalade côté build serveur.",
    statut: "a-faire",
  },
  {
    id: "chat-backlog-tools",
    code: "ÉV15+",
    titre: "Outils chat ajouter_demande / traiter_demande",
    description:
      "Câbler le tool-calling dans le pipeline chat pour piloter le backlog conversationnellement. Bloqué en une passe : le client mesh radar (RadarProviderMeshClient) n'envoie pas de payload `tools` aux fournisseurs et ses parseurs SSE n'extraient que le texte ; le chat-ui packagé ne rend pas les événements tool_call. Suivi documenté.",
    statut: "a-faire",
  },
  {
    id: "uat-round5-accordeons-reaudit",
    code: "UAT5",
    titre: "Réaudit des accordéons (retour UAT round 5)",
    description:
      "Revérifier et réappliquer le motif accordéon là où il manque, une fois le lot 2 et l'uniformisation de bande en place (retour verbatim UAT round 5).",
    statut: "a-faire",
  },
];

/**
 * Merge the static seed with dynamic items (from the API), de-duplicated by id.
 * Dynamic items win over the seed when ids collide so that a "process" update
 * (statut → en-cours) is reflected.
 */
export function mergeBacklog(
  seed: readonly BacklogItem[],
  dynamic: readonly BacklogItem[],
): BacklogItem[] {
  const byId = new Map<string, BacklogItem>();
  for (const item of seed) byId.set(item.id, item);
  for (const item of dynamic) byId.set(item.id, item);
  return [...byId.values()];
}

/** Ordered board columns with their French labels. */
export const BACKLOG_COLUMNS: readonly { statut: BacklogStatut; label: string }[] = [
  { statut: "a-faire", label: "À faire" },
  { statut: "en-cours", label: "En cours" },
  { statut: "realise", label: "Réalisé" },
];

/** French label for a status. */
export function statutLabel(statut: BacklogStatut): string {
  return BACKLOG_COLUMNS.find((c) => c.statut === statut)?.label ?? statut;
}

/** Design-system Badge tone for a status. */
export function statutTone(statut: BacklogStatut): "neutral" | "info" | "success" {
  switch (statut) {
    case "realise":
      return "success";
    case "en-cours":
      return "info";
    default:
      return "neutral";
  }
}
