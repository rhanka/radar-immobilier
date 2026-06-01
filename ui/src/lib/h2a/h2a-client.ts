// ÉV10 : h2a coordination journal API client (browser).
//
// Thin wrapper over the radar h2a API (`api/src/routes/h2a.ts`). The
// Coordination view loads the REAL signed, hash-chained `@sentropic/h2a`
// journal from `GET /api/h2a/journal`, and records decisions via
// `POST /api/h2a/decisions`. When the API is unreachable, the view shows an
// explicit "h2a non connecté" state; it never fabricates journal entries.

/** An h2a role as exposed by the server (PRINCIPAL human, CONDUCTOR AI, ...). */
export type H2ARoleLabel =
  | "PRINCIPAL"
  | "EXECUTIF"
  | "CONDUCTOR"
  | "AGENTS"
  | "CONTROL"
  | "MANDATAIRE";

/** A radar decision kind a human (PRINCIPAL) may take. */
export type DecisionKind = "qualifier" | "surveiller" | "approcher";

/** An ed25519 signature attached to a journal entry. */
export interface H2ASignatureView {
  by: string;
  alg: string;
  value: string;
}

/** A single h2a journal entry (frame + payload), as served by the API. */
export interface H2AJournalEntryView {
  protocol: string;
  version: string;
  sequence: number;
  prevHash?: string;
  contentHash: string;
  id: string;
  type: string;
  actor: { instance: string; role: H2ARoleLabel; scope: string };
  body: Record<string, unknown>;
  createdAt: string;
  policyIds?: string[];
  signatures?: H2ASignatureView[];
}

/** An entry plus its per-entry signature-verification outcome. */
export interface JournalEntryWithVerification {
  entry: H2AJournalEntryView;
  signatureValid: boolean;
}

/** The chain-verified journal snapshot returned by the API. */
export interface JournalSnapshot {
  protocol: string;
  version: string;
  scope: string;
  policyIds: string[];
  actors: Array<{ by: string; role: H2ARoleLabel }>;
  entries: JournalEntryWithVerification[];
  chainValid: boolean;
  chainReason?: string;
}

/** A radar POLICY artifact (real `@sentropic/h2a` POLICY). */
export interface PolicyArtifact {
  kind: "POLICY";
  id: string;
  scope: string;
  rule: string;
  sourceAuthority: string;
  adoptionMode: string;
  version?: string;
}

export interface PolicyResponse {
  scope: string;
  policies: PolicyArtifact[];
}

function resolveUrl(path: string, baseUrl = import.meta.env.VITE_API_BASE_URL): string {
  if (!baseUrl) return path;
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/** Fetch the chain-verified h2a journal. Throws on HTTP/network error. */
export async function fetchJournal(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<JournalSnapshot> {
  const res = await fetch(resolveUrl("/api/h2a/journal", baseUrl));
  if (!res.ok) throw new Error(`h2a journal HTTP ${res.status}`);
  return (await res.json()) as JournalSnapshot;
}

/** Fetch the radar POLICY artifacts. Throws on HTTP/network error. */
export async function fetchPolicy(
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<PolicyResponse> {
  const res = await fetch(resolveUrl("/api/h2a/policy", baseUrl));
  if (!res.ok) throw new Error(`h2a policy HTTP ${res.status}`);
  return (await res.json()) as PolicyResponse;
}

/** Record a PRINCIPAL decision + CONDUCTOR ack. Returns the new snapshot. */
export async function recordDecision(
  input: { kind: DecisionKind; entity: string; rationale?: string },
  baseUrl = import.meta.env.VITE_API_BASE_URL,
): Promise<JournalSnapshot> {
  const res = await fetch(resolveUrl("/api/h2a/decisions", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `h2a decision HTTP ${res.status}`);
  }
  return (await res.json()) as JournalSnapshot;
}
