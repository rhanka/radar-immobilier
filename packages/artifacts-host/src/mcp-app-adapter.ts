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
  const retryable = (response as HttpResponse & { retryable?: boolean }).retryable === true;
  return { ok: false, status, code, retryable, error: body };
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

function isValidCallerKey(value: unknown): value is string {
  // Original string preserved (whitespace included); length counts UTF-16
  // code units via String.length, matching the facade rule.
  return typeof value === "string" && value.trim() !== "" && value.length <= CALLER_KEY_MAX_LENGTH;
}

function hasForbiddenKey(args: Record<string, unknown>): boolean {
  return Object.keys(args).some((key) => FORBIDDEN_KEYS.has(key));
}

function hasOnlyAllowedKeys(args: Record<string, unknown>, op: McpArtifactOp): boolean {
  const allowed = ALLOWED_KEYS[op];
  return Object.keys(args).every((key) => allowed.includes(key));
}

function isEmptyRecord(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length === 0;
}

function isFlatPrimitiveRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") return false;
    if (typeof entry !== "string" && typeof entry !== "number" &&
      typeof entry !== "boolean" && entry !== null) return false;
  }
  return true;
}

function isValidFileShape(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  const keys = Object.keys(entry);
  if (!keys.includes("path") || !keys.includes("mimeType")) return false;
  const hasText = keys.includes("text");
  const hasBytes = keys.includes("bytes");
  if (hasText === hasBytes) return false;
  if (!keys.every((key) => ["path", "mimeType", "text", "bytes"].includes(key))) return false;
  if (typeof entry["path"] !== "string" || typeof entry["mimeType"] !== "string") return false;
  if (hasText && typeof entry["text"] !== "string") return false;
  if (hasBytes && !Array.isArray(entry["bytes"])) return false;
  return true;
}

function isValidFilesShape(files: unknown): boolean {
  if (!Array.isArray(files) || files.length === 0 || files.length > 32) return false;
  return files.every(isValidFileShape);
}

function isValidLimit(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100;
}

function isValidOffset(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function createMcpArtifactAdapter(control: ArtifactControl): McpArtifactAdapter {
  return {
    async execute(request: McpProviderRequest, authority: VerifiedMcpAuthority): Promise<McpResult> {
      if (!isRecord(request) || !isRecord(authority)) return invalidRequest();
      if (typeof request.method !== "string" || typeof request.path !== "string") return invalidRequest();
      if (typeof authority.actorId !== "string" || authority.actorId.trim() === "") return invalidRequest();
      const route = routeToOp(request.method, request.path);
      if (route === undefined) return unsupported();
      if (!isRecord(request.args)) return invalidRequest();
      const args = request.args;
      if (hasForbiddenKey(args) || !hasOnlyAllowedKeys(args, route.op)) return invalidRequest();

      let sanitized: Record<string, unknown>;
      if (route.op === "ensure") {
        const bindingName: unknown = args["bindingName"];
        if (typeof bindingName !== "string") return invalidRequest();
        if (validateBindingName(bindingName).length > 0) return invalidRequest();
        if (!isValidCallerKey(args["idempotencyKey"])) return invalidRequest();
        if (args["parameters"] !== undefined && !isEmptyRecord(args["parameters"])) return invalidRequest();
        sanitized = { bindingName: args["bindingName"], idempotencyKey: args["idempotencyKey"] };
        if (args["parameters"] !== undefined) sanitized["parameters"] = args["parameters"];
      } else if (route.op === "publish") {
        if (!isArtifactId(args["artifactId"])) return invalidRequest();
        if (!isValidCallerKey(args["idempotencyKey"])) return invalidRequest();
        if (!isValidFilesShape(args["files"])) return invalidRequest();
        if (args["profile"] !== undefined && !isFlatPrimitiveRecord(args["profile"])) return invalidRequest();
        sanitized = { artifactId: args["artifactId"], files: args["files"],
          idempotencyKey: args["idempotencyKey"] };
        if (args["profile"] !== undefined) sanitized["profile"] = args["profile"];
      } else if (route.op === "list") {
        if (args["limit"] !== undefined && !isValidLimit(args["limit"])) return invalidRequest();
        if (args["offset"] !== undefined && !isValidOffset(args["offset"])) return invalidRequest();
        sanitized = {};
        if (args["limit"] !== undefined) sanitized["limit"] = args["limit"];
        if (args["offset"] !== undefined) sanitized["offset"] = args["offset"];
      } else {
        const pathId = route.artifactId ?? "";
        if (!isArtifactId(pathId)) return invalidRequest();
        if (args["artifactId"] !== undefined && args["artifactId"] !== pathId) return invalidRequest();
        sanitized = { artifactId: pathId };
      }

      try {
        const response = await control.handle(route.op, authority.actorId, sanitized);
        return toMcpResult(response);
      } catch {
        return { ok: false, status: 500, code: "provider_error", retryable: false,
          error: { error: "provider_error" } };
      }
    },
  };
}
