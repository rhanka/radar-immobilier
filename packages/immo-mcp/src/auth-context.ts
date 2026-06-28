import { createHash } from "node:crypto";

/**
 * Auth context for the immo MCP provider.
 *
 * IMPORTANT: every field here is derived from a validated token/session,
 * NEVER from LLM/tool arguments. Tools must read scopes/tenant from this
 * object and treat tool arguments as untrusted query parameters only.
 */
export interface ImmoMcpAuthContext {
  sub: string;
  userId?: string;
  tenantId: string;
  orgId?: string;
  roles: string[];
  scopes: string[];
  workspaces: string[];
  dataMode: "real" | "simulation";
  audience: string;
}

/** Scopes recognised by the immo provider (cf. cadrage v0). */
export const IMMO_SCOPES = {
  read: "immo:read",
  search: "immo:search",
  documentsRead: "immo:documents:read",
  notesWrite: "immo:notes:write",
  decisionsPropose: "immo:decisions:propose",
  admin: "immo:admin",
} as const;

const DEFAULT_SCOPES = `${IMMO_SCOPES.read} ${IMMO_SCOPES.search} ${IMMO_SCOPES.documentsRead}`;

/**
 * v0 stub: claims come from environment variables, NEVER from tool arguments.
 *
 * OAuth-ready: phase 2 swaps the body of this function to validate a bearer
 * token / resource-server claims (via the future `@sentropic/mcp` layer) and
 * returns the same `ImmoMcpAuthContext`. The tool layer never changes.
 */
export function resolveAuthContext(env: NodeJS.ProcessEnv): ImmoMcpAuthContext {
  const scopes = (env.IMMO_MCP_AUTH_STUB_SCOPES ?? DEFAULT_SCOPES)
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tenantId = env.IMMO_MCP_AUTH_STUB_TENANT ?? "radar";
  const sub = env.IMMO_MCP_AUTH_STUB_SUB ?? "demo-user";
  return {
    sub,
    userId: sub,
    tenantId,
    roles: ["viewer"],
    scopes,
    workspaces: (env.IMMO_MCP_AUTH_STUB_WORKSPACES ?? "default")
      .split(/\s+/)
      .filter(Boolean),
    dataMode: env.IMMO_MCP_DATA_MODE === "http" ? "real" : "simulation",
    audience: "mcp/immo",
  };
}

/** Throws `scope_denied:<scope>` if the auth context lacks the required scope. */
export function assertScope(auth: ImmoMcpAuthContext, scope: string): void {
  if (!auth.scopes.includes(scope)) {
    throw new Error(`scope_denied:${scope}`);
  }
}

/** Short, stable hash of tool input — logged instead of the raw payload. */
export function hashInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex")
    .slice(0, 12);
}

/**
 * Audit hook: writes a single structured line to STDERR (never STDOUT — that
 * channel carries the MCP protocol). No raw sensitive payload is logged, only
 * tenant/user/tool/input-hash/correlationId.
 */
export function auditToolCall(
  auth: ImmoMcpAuthContext,
  tool: string,
  inputHash: string,
  correlationId: string,
): void {
  const record = {
    at: new Date().toISOString(),
    kind: "immo-mcp.audit",
    tenant: auth.tenantId,
    sub: auth.sub,
    audience: auth.audience,
    dataMode: auth.dataMode,
    tool,
    inputHash,
    correlationId,
  };
  process.stderr.write(`${JSON.stringify(record)}\n`);
}

/**
 * Anti-PII redaction for free text that may transit through documents.
 *
 * Provisional PII profiles (cf. cadrage v0): owner_contact, user_identity,
 * commercial_note, property_owner_identity_if_private, auth_invite_token,
 * session_identifier, precise_user_action_trace. v0 scrubs the structurally
 * detectable ones (emails, phones, invite/session tokens) defensively so that
 * no obviously-sensitive token leaves the provider, even from mock fixtures.
 */
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[redacted:email]")
    .replace(/\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[redacted:phone]")
    .replace(/\b(?:invite|invitation|enroll)[_-]?token[=:]\s*\S+/gi, "[redacted:invite_token]")
    .replace(/\b(?:session|sid)[=:]\s*\S+/gi, "[redacted:session]");
}
