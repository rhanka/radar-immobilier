import { fetchJsonWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from "$lib/net/fetch-with-timeout.js";
import { scopedSignalFacetsPath } from "./graph-signal-detail-client.js";

export interface SignalNote {
  id: string; source: "mcp" | "manual"; model: string | null;
  validation: "auto" | "human"; pending_human?: boolean; text?: string; created_at: string;
}
export interface SignalAnnotations {
  version: string;
  canConfirm?: boolean; moderateArchive?: boolean;
  current: { id?: string; source: string; model: string | null; validation?: "auto" | "human";
    pending_human?: boolean; scope?: "personal" | "workspace"; linked_event_id?: string; reason_code?: string;
    classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe"; reason?: string } | null;
  notes: SignalNote[];
}
export function mcpBadge(value: { model: string | null; validation?: "auto" | "human"; pending_human?: boolean }): string {
  return `MCP · ${value.model ?? "modèle inconnu"} · ${value.pending_human ? "à confirmer" : value.validation === "human" ? "validé humain" : "validé auto"}`;
}
export async function appendSignalNote(workspaceId: string,
  target: { citySlug: string; type: string; id: string }, text: string, version: string): Promise<SignalAnnotations> {
  const response = await fetchJsonWithTimeout(scopedSignalFacetsPath({ workspaceId }, "annotations"), {
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    init: { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: { ...target, scope: "personal" }, text, version }) },
  });
  if (!response.ok) throw new Error("La note n’a pas été enregistrée. Rechargez la carte puis réessayez.");
  return (response.json as { state: SignalAnnotations }).state;
}
