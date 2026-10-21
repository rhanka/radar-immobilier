import { isArtifactId } from "@sentropic/artifacts/contracts";
import type { HttpResponse } from "@sentropic/artifacts/http";
import type { ArtifactControl } from "./facade.js";
import { validateBindingName } from "./publish-policy.js";

/**
 * H4 P2 preparation: shared artifact command adapter (unexposed).
 *
 * Translates the four selected provider operations to the same
 * `ArtifactControl` facade as HTTP. No MCP tool is registered here and no
 * transport is wired; this module exports only pure translation.
 *
 * Preparation notes:
 * - Actor comes from verified request authority, never from arguments.
 * - Storage scope stays server-bound inside the facade; caller scope fields
 *   are refused before dispatch. A future provider host-context field must be
 *   bound from trusted configuration, not from caller input.
 * - Internal idempotency keys and effective parameter hashes use the shared
 *   server derivation in `facade.ts`/`idempotency.ts`; array order stays
 *   significant and the payload hash is never added to the internal key.
 * - Publication limits, defaults, fixed `inline-original` provenance and URL
 *   policy are preserved by delegating sanitized bodies to the facade.
 * - Requested `profile`/`parameters` are request data, not granted
 *   permissions; no grant is issued here.
 * - H3 admission travels with the injected facade (entry plus pre-dispatch
 *   and post-settle rereads). Provider finalization authorization after waits
 *   stays BLOCKED pending the upstream mechanism, same as H3 P2 unit 7.
 * - Typed provider outcomes are consumed via the facade sanitized response;
 *   internal causes are never serialized to MCP results.
 */

export interface VerifiedMcpAuthority {
  readonly actorId: string;
}

export interface McpProviderRequest {
  readonly method: string;
  readonly path: string;
  readonly args: unknown;
}

export type McpArtifactOp = "ensure" | "publish" | "list" | "meta";

export interface McpSuccess {
  readonly ok: true;
  readonly status: number;
  readonly data: unknown;
}

export interface McpFailure {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly error: unknown;
}

export type McpResult = McpSuccess | McpFailure;

export interface McpArtifactAdapter {
  execute(request: McpProviderRequest, authority: VerifiedMcpAuthority): Promise<McpResult>;
}

const ENSURE_PATH = "/ensure";
const PUBLISH_PATH = "/publish";
const LIST_PATH = "/list";
const META_PREFIX = "/meta/";

const ALLOWED_KEYS: Record<McpArtifactOp, readonly string[]> = {
  ensure: ["bindingName", "idempotencyKey", "parameters"],
  publish: ["artifactId", "files", "idempotencyKey", "profile"],
  list: ["limit", "offset"],
  meta: ["artifactId"],
};

const FORBIDDEN_KEYS = new Set([
  "actor",
  "actorId",
  "owner",
  "ownerId",
  "tenant",
  "tenantId",
  "storageScope",
  "storageScopeId",
  "paramsHash",
  "source",
  "releaseId",
  "manifest",
  "digest",
  "stableUrl",
  "pinnedUrl",
  "replayed",
]);

const CALLER_KEY_MAX_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidRequest(): McpFailure {
  return { ok: false, status: 400, code: "invalid_request", retryable: false,
    error: { error: "invalid_request" } };
}

function unsupported(): McpFailure {
  // Same stable code as provider unavailability but never retryable: the
  // capability itself is unselected, not temporarily unavailable.
  return { ok: false, status: 503, code: "capability_unavailable", retryable: false,
    error: { error: "capability_unavailable" } };
}

function toMcpResult(response: HttpResponse): McpResult {
  const status = response.status;
  const body = response.body;
  if (status >= 200 && status < 300) return { ok: true, status, data: body };
  const raw = isRecord(body) ? body["error"] : undefined;
  const code = typeof raw === "string" ? raw : "provider_error";
  // Only a facade 503 (provider unavailability) is retryable; adapter-level
  // refusals above already returned with retryable false.
  return { ok: false, status, code, retryable: status === 503, error: body };
}

function routeToOp(method: string, path: string):
  | { readonly op: McpArtifactOp; readonly artifactId?: string }
  | undefined {
  if (path.includes("?") || path.includes("#")) return undefined;
  if (method === "POST" && path === ENSURE_PATH) return { op: "ensure" };
  if (method === "POST" && path === PUBLISH_PATH) return { op: "publish" };
  if (method === "POST" && path === LIST_PATH) return { op: "list" };
  if (method === "GET" && path.startsWith(META_PREFIX)) {
    const artifactId = path.slice(META_PREFIX.length);
    if (artifactId.length === 0 || artifactId.includes("/")) return undefined;
    return { op: "meta", artifactId };
  }
  return undefined;
}
