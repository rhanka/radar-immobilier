// Automation data: treatment cadences, stub connectors, benchmark recap.
// benchmark-data.ts is imported READ-ONLY — values are never fabricated here.

import { benchmarkTracks } from "../demo/benchmark-data.js";
import type { TrackScore } from "../demo/benchmark-data.js";

// ---------------------------------------------------------------------------
// Treatment cadences
// ---------------------------------------------------------------------------

export type TreatmentKind = "initial" | "recurrent" | "approfondissement";

export interface Treatment {
  kind: TreatmentKind;
  title: string;
  cadence: string;
  description: string;
  trigger: string;
}

export const TREATMENTS: Treatment[] = [
  {
    kind: "initial",
    title: "Traitement initial",
    cadence: "Au démarrage (one-shot)",
    description:
      "Rétro-analyse sur 2 ans : collecte et structuration de l'historique des signaux réglementaires, des mutations foncières et des projets autorisés pour constituer la base de référence de la municipalité.",
    trigger: "Onboarding d'une municipalité",
  },
  {
    kind: "recurrent",
    title: "Traitement récurrent",
    cadence: "Quotidien",
    description:
      "Scan automatisé des sources connectées et manuelles pour détecter les nouveaux signaux de densification (avis publics, modifications de zonage, dépôts de permis). Enrichissement et déduplication incrémentaux.",
    trigger: "Planificateur quotidien",
  },
  {
    kind: "approfondissement",
    title: "Approfondissement",
    cadence: "À la demande",
    description:
      "Deep-dive d'une opportunité en 6 phases : vérification réglementaire, analyse parcellaire, contraintes (CPTAQ/PPCMOI), évaluation de marché, synthèse actionnable et rapport exportable.",
    trigger: "Action « Approfondir » sur un signal/opportunité",
  },
];

// ---------------------------------------------------------------------------
// Source/MCP connectors (stub — demo, nothing really connected)
// ---------------------------------------------------------------------------

export type ConnectorStatus = "connecte" | "a-venir" | "manuel" | "reel";

export interface Connector {
  id: string;
  label: string;
  status: ConnectorStatus;
  note?: string;
  /**
   * When set, this connector is REALLY wired: the id of the server-side
   * collector exposed at POST /api/automation/collect/:source. The UI shows a
   * « Lancer la collecte » action that fetches the live public source.
   */
  realCollectSource?: string;
}

export const STATUS_LABELS_FR: Record<ConnectorStatus, string> = {
  connecte: "Connecté",
  "a-venir": "À venir",
  manuel: "Manuel",
  reel: "Réel",
};

/**
 * Honest action-column hint for a connector that has no live-collect button.
 * A connector without `realCollectSource` is NOT "simulated" — it is either a
 * manual feed (CSV/registre fourni à l'onboarding) or a planned integration.
 * Returning the real status label avoids the misleading « simulé » wording.
 */
export function connectorActionHint(connector: Connector): string {
  switch (connector.status) {
    case "manuel":
      return "Apport manuel";
    case "a-venir":
      return "À venir";
    case "connecte":
    case "reel":
      // A wired connector renders its own action button, not a hint.
      return "";
    default:
      return "";
  }
}

export const CONNECTORS: Connector[] = [
  {
    id: "avis-publics",
    label: "Avis publics municipaux",
    status: "reel",
    note: "Collecte LIVE : page publique des avis publics de Salaberry-de-Valleyfield (HTML, sans clé). Extraction titre + date + lien PDF côté serveur.",
    realCollectSource: "avis-publics-valleyfield",
  },
  {
    id: "role-evaluation",
    label: "Rôle d'évaluation foncière",
    status: "manuel",
    note: "Export CSV fourni manuellement à l'onboarding",
  },
  {
    id: "cadastre",
    label: "Cadastre (BDNI/MERN)",
    status: "a-venir",
    note: "API Données Québec — accès à qualifier",
  },
  {
    id: "bdzi-grhq",
    label: "BDZI / GRHQ (zones inondables)",
    status: "a-venir",
    note: "Couche WMS MELCCFP — intégration planifiée",
  },
  {
    id: "statcan",
    label: "StatCan — données démographiques",
    status: "a-venir",
    note: "API StatCan recensement et projections",
  },
  {
    id: "youtube",
    label: "YouTube — séances de conseil",
    status: "a-venir",
    note: "Transcription automatique des séances publiques enregistrées",
  },
  {
    id: "permis-construire",
    label: "Permis de construire (municipal)",
    status: "manuel",
    note: "Registre transmis manuellement ou via export du système de la ville",
  },
];

// ---------------------------------------------------------------------------
// Benchmark recap — derived from benchmark-data.ts, no fabricated values
// ---------------------------------------------------------------------------

export interface BenchmarkRecapEntry {
  id: string;
  name: string;
  operator: TrackScore["operator"];
  total: number;
  rank: number;
  fabrication: TrackScore["fabrication"];
}

/**
 * Returns a compact projection of benchmarkTracks sorted by rank ascending.
 * All values come directly from the source data; nothing is invented.
 */
export function benchmarkRecap(): BenchmarkRecapEntry[] {
  return benchmarkTracks
    .map(
      (t): BenchmarkRecapEntry => ({
        id: t.id,
        name: t.name,
        operator: t.operator,
        total: t.total,
        rank: t.rank,
        fabrication: t.fabrication,
      }),
    )
    .sort((a, b) => a.rank - b.rank);
}
