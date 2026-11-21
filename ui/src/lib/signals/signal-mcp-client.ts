import { fetchJsonWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS } from "$lib/net/fetch-with-timeout.js";
import { scopedSignalFacetsPath } from "./graph-signal-detail-client.js";

export interface SignalNote {
  id: string; source: "mcp" | "manual"; source_tag?: string | null; sourceTag?: string | null;
  model: string | null;
  validation: "auto" | "human"; pending_human?: boolean; text?: string; created_at: string;
}
export interface SignalAnnotations {
  version: string;
  canConfirm?: boolean; moderateArchive?: boolean;
  current: { id?: string; source: string; source_tag?: string | null; sourceTag?: string | null;
    model: string | null; validation?: "auto" | "human";
    pending_human?: boolean; scope?: "personal" | "workspace"; linked_event_id?: string; reason_code?: string;
    elicitation_id?: string | null; elicitationId?: string | null;
    elicitation_accepted_at?: string | null; elicitationAcceptedAt?: string | null;
    classe?: "pertinent" | "a_surveiller" | "ecarte" | "non_classe"; reason?: string } | null;
  notes: SignalNote[];
}
export function isMcpElicitationHuman(value: {
  source?: string;
  validation?: "auto" | "human";
  source_tag?: string | null;
  sourceTag?: string | null;
  elicitation_id?: string | null;
  elicitationId?: string | null;
} | null | undefined): boolean {
  if (!value || value.validation !== "human") return false;
  const tag = value.sourceTag ?? value.source_tag;
  return tag === "mcp+elicitation" || Boolean(value.elicitationId ?? value.elicitation_id);
}
export function mcpBadge(value: {
  model: string | null;
  validation?: "auto" | "human";
  pending_human?: boolean;
  source_tag?: string | null;
  sourceTag?: string | null;
  elicitation_id?: string | null;
  elicitationId?: string | null;
}): string {
  if (isMcpElicitationHuman(value)) return "Humain · via MCP + élicitation";
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
