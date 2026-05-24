export interface ProbePayload {
  ok: boolean;
  detail?: string;
}

export interface HealthPayload {
  status: "ok" | "degraded";
  db: ProbePayload;
  objectStore: ProbePayload;
}

export type HealthView =
  | {
      kind: "ok";
      label: string;
      detail: string;
    }
  | {
      kind: "degraded";
      label: string;
      detail: string;
    }
  | {
      kind: "offline";
      label: string;
      detail: string;
    };

export function mapHealthPayload(payload: HealthPayload): HealthView {
  if (payload.status === "ok" && payload.db.ok && payload.objectStore.ok) {
    return {
      kind: "ok",
      label: "API connectee",
      detail: "Postgres et stockage objet OK",
    };
  }

  return {
    kind: "degraded",
    label: "API degradee",
    detail:
      payload.db.detail ??
      payload.objectStore.detail ??
      "Une dependance API ne repond pas correctement",
  };
}

export async function readHealth(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<HealthView> {
  try {
    const response = await fetch(`${baseUrl}/health`);
    const payload = (await response.json()) as HealthPayload;
    return mapHealthPayload(payload);
  } catch (error) {
    return {
      kind: "offline",
      label: "API hors ligne",
      detail: error instanceof Error ? error.message : "Connexion impossible",
    };
  }
}
