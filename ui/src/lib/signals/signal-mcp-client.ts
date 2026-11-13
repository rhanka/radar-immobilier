import { fetchJsonWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from "$lib/net/fetch-with-timeout.js";
import { scopedSignalFacetsPath } from "./graph-signal-detail-client.js";

export interface SignalNote {
  id: string; source: "mcp" | "manual"; model: string | null;
  validation: "auto" | "human"; text?: string; created_at: string;
}
export interface SignalAnnotations {
  version: string;
  current: { source: string; model: string | null; validation?: "auto" | "human";
    classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe"; reason?: string } | null;
  notes: SignalNote[];
}
export function mcpBadge(value: { model: string | null; validation?: "auto" | "human" }): string {
  return `MCP · ${value.model ?? "modèle inconnu"} · validé ${value.validation === "human" ? "humain" : "auto"}`;
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
