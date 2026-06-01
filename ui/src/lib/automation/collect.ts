// REAL automation collector client (ÉV11). Calls the API endpoint
// POST /api/automation/collect/:source which fetches a live public source
// server-side and returns parsed items. No fabricated data: a missing field
// arrives from the API as "non-disponible".

export const NON_DISPONIBLE = "non-disponible";

/** One parsed notice as returned by the API (mirror of the server schema). */
export interface CollectItem {
  title: string;
  dateLabel: string;
  dateIso: string;
  url: string;
  type: string;
  bylaws: string[];
}

export interface CollectSuccess {
  ok: true;
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  count: number;
  items: CollectItem[];
}

export interface CollectFailure {
  ok: false;
  source?: string;
  sourceUrl?: string;
  error: string;
  detail: string;
}

/** UI-facing view of a collection run. */
export type CollectView =
  | { kind: "success"; result: CollectSuccess }
  | { kind: "error"; label: string; detail: string };

/** French labels for the inferred notice kinds (see server AvisType). */
export const AVIS_TYPE_LABELS_FR: Record<string, string> = {
  "derogation-mineure": "Dérogation mineure",
  ppcmoi: "PPCMOI",
  consultation: "Consultation publique",
  "registre-referendaire": "Registre référendaire",
  "entree-en-vigueur": "Entrée en vigueur",
  "projet-reglement": "Projet de règlement",
  alienation: "Aliénation",
  "vente-pour-taxes": "Vente pour taxes",
  autre: "Autre avis",
};

export function avisTypeLabel(type: string): string {
  return AVIS_TYPE_LABELS_FR[type] ?? type;
}

/** French label for a typed API failure. */
export function collectErrorLabel(error: string): string {
  switch (error) {
    case "timeout":
      return "Source injoignable (délai dépassé)";
    case "network":
      return "Source injoignable (réseau)";
    case "http":
      return "Réponse en erreur de la source";
    case "parse":
      return "Réponse illisible (format inattendu)";
    case "unknown-source":
      return "Source inconnue côté serveur";
    default:
      return "Échec de la collecte";
  }
}

export function resolveCollectUrl(
  source: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): string {
  const path = `/api/automation/collect/${encodeURIComponent(source)}`;
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * Map a raw API payload to a CollectView. Pure (unit-tested) so the Svelte
 * component stays declarative.
 */
export function mapCollectPayload(
  payload: CollectSuccess | CollectFailure,
): CollectView {
  if (payload.ok) {
    return { kind: "success", result: payload };
  }
  return {
    kind: "error",
    label: collectErrorLabel(payload.error),
    detail: payload.detail,
  };
}

/** Run a real collection against the API. Never throws. */
export async function runCollect(
  source: string,
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<CollectView> {
  try {
    const response = await fetch(resolveCollectUrl(source, baseUrl), {
      method: "POST",
    });
    const payload = (await response.json()) as CollectSuccess | CollectFailure;
    return mapCollectPayload(payload);
  } catch (error) {
    return {
      kind: "error",
      label: "API hors ligne",
      detail: error instanceof Error ? error.message : "Connexion impossible",
    };
  }
}
