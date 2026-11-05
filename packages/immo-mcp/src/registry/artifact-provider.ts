import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { createArtifactsManifest,
  createArtifactsToolExecutor, ArtifactProfileInputError, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext, AuthorizeCommit } from "@sentropic/artifacts/server/commit-contract";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { computeManifestDigest, type RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
import { projectArtifactHttpOutcome } from "@sentropic/artifacts/http";
import { assertContentIdsDisjoint, checkAdmission, createArtifactControl, HOST_ARTIFACT_PROFILE, ARTIFACT_PROFILE_DESCRIPTOR, ARTIFACT_STRICT, ARTIFACT_PART1,
  artifactRefusalResponse, projectContentUrls, projectListVersionsAuthors, validateArtifactInput, type AdmissionAuthority, type ListVersionsDirectory } from "@radar/artifacts-host";
import { ARTIFACT_INVOCATION_SCOPES, ARTIFACT_TOOL_SCOPES, acceptedArtifactScopes, hasArtifactScope,
  isArtifactToolName, STRICT_ARTIFACT_SCOPE_POLICY, type ArtifactScopePolicy } from "./artifact-profile.js";
import { AUTHORING_GUIDE_SNIPPET, getAuthoringGuide } from "./artifact-authoring-guide.js";
import { ARTIFACT_LIST_ORDER, artifactReadOutputSchema } from "./artifact-read-schema.js";
import { assertArtifactAssembly } from "./artifact-config.js";

// Compile the complete versioned contract, including semantic rules, before registry admission.
export const IMMO_ARTIFACT_PROFILE = HOST_ARTIFACT_PROFILE;
function freeze<T extends object>(value: T): T {
  for (const entry of Object.values(value)) if (entry && typeof entry === "object") freeze(entry);
  return Object.freeze(value);
}
type ArtifactManifest = ReturnType<typeof createArtifactsManifest>;
type ArtifactManifestTool = ArtifactManifest["tools"][number];

/**
 * Per-tool scopes: writes require immo:artifacts:write, reads immo:artifacts:read.
 * Under the legacy-read transition the read tools declare no registry scope,
 * because the registry only expresses "all of"; the binding then enforces
 * "immo:artifacts:read or immo:read" itself. Writes are declared in every mode.
 */
/**
 * Tools whose description points at the versioned guide: ensure, publish
 * and publish_bundle_v2 (page creation path) plus get and get_source
 * (republication of an existing page must find the guide too). The full
 * contract ships in the `authoringGuide` response field of ensure and get;
 * get_source carries only a small guide reference (guideId/revision plus
 * the lifecycle hint) because the source payload itself must stay readable.
 */
const GUIDE_DESCRIPTION_TOOLS: ReadonlySet<string> = new Set(
  ["artifacts_ensure", "artifacts_publish", "artifacts_publish_bundle_v2", "artifacts_get", "artifacts_get_source"]);

/**
 * Short generic tool summaries, authored here and identical in every
 * profile. The upstream base descriptions embed the active profile and
 * envelope version, and claude.ai resets the owner's per-tool "Always
 * allow" grant whenever a description changes, so they cannot be reused.
 * Profile, contract and guide-revision detail lives in the guide and in
 * result fields (authoringGuide.descriptor, error details) instead.
 */
const STABLE_TOOL_SUMMARIES: Readonly<Record<string, string>> = {
  artifacts_ensure: "Create a Radar page and return its binding.",
  artifacts_publish: "Publish a full page bundle on an existing binding.",
  artifacts_list: `List visible Radar pages. Returns bindingName, content URLs, lifecycle and publication timestamps. Ordered by ${ARTIFACT_LIST_ORDER}, before offset/limit pagination.`,
  artifacts_get: "Read a Radar page's metadata and permissions.",
  artifacts_get_source: "Read a Radar page's retained source files for editing.",
  artifacts_set_access: "Grant or revoke named read access on a Radar page.",
  artifacts_delete: "Delete a Radar page after owner confirmation in the IMMO application.",
  // Files parity LOT 1 — outside-the-model bytes, then one atomic release.
  artifacts_create_upload: "Open an upload session and return the signed PUT URL for one file.",
  artifacts_commit_upload: "Verify staged bytes and pin one uploaded file to its manifest path.",
  artifacts_publish_bundle: "Publish one atomic release from inline files plus staged uploads.",
  // Files parity LOT 2 — browser page mint, asset listing, v2 bundle.
  artifacts_create_upload_page: "Mint a browser upload page so a human uploads large files without model bytes.",
  artifacts_list_assets: "List staged and released asset files of a Radar page.",
  artifacts_publish_bundle_v2: "Publish one atomic release from inline files plus copy, carry or keep assets.",
  // I2 on G2 — share tooling through the I2 seams.
  artifacts_lookup_people: "Find approved IMMO accounts by name or email; answers carry opaque userRef values.",
  artifacts_list_access: "List the access mode and per-principal grants of a Radar page.",
  // Reader consent — self-revocation of the caller's own persistent consent
  // (baskets scopes since R2). The served summary stays frozen: the
  // tool-definitions hash locks every served definition bit-identical, and
  // any wording change resets the owner's per-tool "Always allow" grants.
  artifacts_revoke_reader_consent: "Withdraw the caller's own persistent opening consent for a Radar page.",
  artifacts_list_versions: "List the retained releases of a Radar page.",
  artifacts_revert: "Republish a retained release as the current release.",
};

/**
 * Optimistic-concurrency guard description, identical in every profile.
 * The property is always present and always optional in the catalogue;
 * requiredness is enforced server-side with precondition_required, so a
 * profile switch never changes the schema.
 */
const EXPECTED_RELEASE_DESCRIPTION =
  "Concurrency guard: the currentReleaseId last observed with artifacts_get or artifacts_list " +
  "(null only for a first publication after a read that returned currentReleaseId null). " +
  "A missing or stale value is refused with precondition_required.";

/** Writes guarded by optimistic concurrency (see EXPECTED_RELEASE_DESCRIPTION). */
const CAS_GUARDED_TOOLS: ReadonlySet<string> = new Set(
  ["artifacts_publish", "artifacts_delete", "artifacts_revert"]);

/**
 * Catalogue input schema for one tool: upstream shape, except the
 * concurrency guard is always an optional property and never required.
 * The server still enforces it per profile (precondition_required with
 * the descriptor in the error details); the transport keeps its own
 * deferral for the same omission.
 *
 * `artifacts_get_source` additionally pins the `paths` property to its
 * qualified description-less shape: upstream 0.2.8 documents the text /
 * base64 encoding there, and claude.ai resets the owner's per-tool
 * "Always allow" grant whenever a served definition changes, so the
 * catalogue keeps the exact qualified surface instead.
 */
function stabilizeArtifactInputSchema(name: string, schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (name === "artifacts_get_source") return stabilizeGetSourceInputSchema(schema);
  if (!CAS_GUARDED_TOOLS.has(name)) return schema as Record<string, unknown>;
  const properties = { ...schema.properties as Record<string, unknown> };
  const guard = properties.expectedCurrentReleaseId;
  properties.expectedCurrentReleaseId = guard !== null && typeof guard === "object" && !Array.isArray(guard)
    ? { ...guard as Record<string, unknown>, description: EXPECTED_RELEASE_DESCRIPTION }
    : { type: ["string", "null"], format: "uuid", description: EXPECTED_RELEASE_DESCRIPTION };
  return { ...schema, properties,
    required: (schema.required as string[]).filter((key) => key !== "expectedCurrentReleaseId") };
}

/**
 * Pin `artifacts_get_source` inputs to the qualified surface: the `paths`
 * property keeps its qualified shape without the encoding description
 * upstream added in 0.2.8. Validation still runs against the upstream
 * profile; only the served catalogue stays bit-identical.
 */
function stabilizeGetSourceInputSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const properties = schema.properties as Record<string, unknown> | undefined;
  const paths = properties?.paths as Record<string, unknown> | undefined;
  if (!paths || typeof paths !== "object" || Array.isArray(paths) || !("description" in paths)) {
    return schema as Record<string, unknown>;
  }
  const { description: _dropped, ...rest } = paths;
  return { ...schema, properties: { ...properties, paths: rest } };
}

export function createImmoArtifactManifest(policy: ArtifactScopePolicy = STRICT_ARTIFACT_SCOPE_POLICY): ArtifactManifest {
  assertArtifactAssembly();
  if (!isDeepStrictEqual(getAuthoringGuide().descriptor, ARTIFACT_PROFILE_DESCRIPTOR)) {
    throw new Error("artifact_guide_assembly_incoherent");
  }
  const base = createArtifactsManifest({ profile: IMMO_ARTIFACT_PROFILE });
  const tools = base.tools.map((tool: ArtifactManifestTool) => {
    const name: string = tool.name;
    if (!isArtifactToolName(name)) throw new Error("artifact_tool_unselected");
    const accepted = acceptedArtifactScopes(name, policy);
    const summary = STABLE_TOOL_SUMMARIES[name];
    if (!summary) throw new Error("artifact_tool_summary_missing");
    const description = GUIDE_DESCRIPTION_TOOLS.has(name) ? `${summary} ${AUTHORING_GUIDE_SNIPPET}` : summary;
    return { ...tool, description,
      inputSchema: stabilizeArtifactInputSchema(name, tool.inputSchema as Readonly<Record<string, unknown>>),
      outputSchema: ARTIFACT_PART1 ? tool.outputSchema : artifactReadOutputSchema(name) ?? tool.outputSchema,
      requiredScopes: accepted.length === 1 ? [ARTIFACT_TOOL_SCOPES[name]] : [] };
  });
  const scopes = [ARTIFACT_INVOCATION_SCOPES.read, ARTIFACT_INVOCATION_SCOPES.write]
    .filter((scope) => tools.some((tool: ArtifactManifestTool) => tool.requiredScopes.includes(scope)));
  return freeze({ ...base, tools, authz: { ...base.authz, scopes } });
}
export const IMMO_ARTIFACT_MANIFEST = createImmoArtifactManifest(STRICT_ARTIFACT_SCOPE_POLICY);
export const IMMO_ARTIFACT_MANIFEST_DIGEST = computeManifestDigest(IMMO_ARTIFACT_MANIFEST);
const bindings = new WeakSet<object>();
const unavailable = async (): Promise<never> => { throw new Error("native_wire_dispatch_required"); };
export const artifactRefusal = (error: string, retryable: boolean, extra: Record<string, unknown> = {}): CallToolResult => ({
  isError: true, content: [{ type: "text", text: JSON.stringify(ARTIFACT_PART1
    ? artifactRefusalResponse(400, error, retryable, extra).body : { error, retryable, ...extra }) }] });
const refusal = artifactRefusal;

/** Typed refusal shared by the binding and the composed namespace: the scope the call lacks. */
export const ARTIFACT_SCOPE_DENIED = "artifact_scope_denied" as const;
export function artifactScopeDenied(tool: string): CallToolResult {
  const requiredScope = isArtifactToolName(tool) ? ARTIFACT_TOOL_SCOPES[tool] : undefined;
  return refusal(ARTIFACT_SCOPE_DENIED, false, requiredScope ? { requiredScope } : {});
}

/**
 * Caller-supplied identity fields are never honored (L12): the actor, owner
 * and storage scope always come from the verified request and the server
 * configuration. Rejected before profile validation so the refusal is stable
 * whatever the upstream profile accepts.
 */
const FORGED_ARTIFACT_CALLER_FIELDS = new Set([
  "actor",
  "actorId",
  "owner",
  "ownerId",
  "tenant",
  "tenantId",
  "storageScope",
  "storageScopeId",
  "paramsHash",
  "internalIdempotencyKey",
  "source",
]);

export function hasForgedArtifactCallerFields(args: unknown): boolean {
  if (typeof args !== "object" || args === null || Array.isArray(args)) return false;
  return Object.keys(args).some((key) => FORGED_ARTIFACT_CALLER_FIELDS.has(key));
}

export interface ArtifactMcpBinding {
  readonly manifest: RegistryDefinition["manifest"];
  readonly adapter: typeof ARTIFACT_NATIVE_ADAPTER;
  readonly scopePolicy: ArtifactScopePolicy;
  readonly configuration: Readonly<{ storageScopeId: string }>;
  readonly tools: readonly Tool[];
  invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult>;
}

export interface FrozenCallAuthority {
  readonly workspaceId: string;
  readonly scope: string;
}

/** A trusted host injects its shared app; this constructor supplies no persistence or policy fallback. */
export function bindArtifactProvider(options: {
  readonly app: ArtifactsApp;
  readonly storageScopeId: string;
  readonly authorizeCommit: (request: VerifiedMcpRequest, frozen?: FrozenCallAuthority) => AuthorizeCommit;
  readonly admission?: AdmissionAuthority | undefined;
  /** Transition policy; defaults to strict (explicit artifact scopes only). */
  readonly scopePolicy?: ArtifactScopePolicy | undefined;
  readonly prepareDelete?: (actorId: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  readonly directory?: ListVersionsDirectory | undefined;
}): ArtifactMcpBinding {
  if (!options.storageScopeId.trim() || typeof options.authorizeCommit !== "function") {
    throw new Error("artifact_binding_incomplete");
  }
  const executor = createArtifactsToolExecutor({ app: options.app, profile: IMMO_ARTIFACT_PROFILE });
  const scope = options.storageScopeId;
  const authorizeCommit = options.authorizeCommit;
  const admission = options.admission;
  const sourceControl = createArtifactControl({ app: options.app }, scope, undefined, admission,
    options.directory ? { directory: options.directory } : undefined);
  const scopePolicy: ArtifactScopePolicy = Object.freeze({ legacyReadScope: options.scopePolicy?.legacyReadScope === true });
  const manifest = scopePolicy.legacyReadScope ? createImmoArtifactManifest(scopePolicy) : IMMO_ARTIFACT_MANIFEST;
  const binding: ArtifactMcpBinding = Object.freeze({
    manifest,
    adapter: nativeAdapter(manifest),
    scopePolicy,
    configuration: Object.freeze({ storageScopeId: scope }),
    // No per-tool _meta on purpose: claude.ai resets the owner's per-tool
    // "Always allow" grant whenever a tool definition changes, and the
    // profile descriptor used to ride here. It was not proven that claude.ai
    // ignores _meta, so the descriptor now travels only in results
    // (authoringGuide.descriptor, error details) and the guide.
    tools: Object.freeze(manifest.tools.map((tool: ArtifactManifestTool) => freeze({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool["inputSchema"],
      ...(ARTIFACT_PART1 ? { outputSchema: tool.outputSchema as Tool["outputSchema"] }
        : artifactReadOutputSchema(tool.name) ? { outputSchema: artifactReadOutputSchema(tool.name)! } : {}),
      annotations: { readOnlyHint: tool.mutability === "read-only", destructiveHint: tool.name === "artifacts_delete",
        openWorldHint: false, idempotentHint: tool.mutability === "read-only" || tool.idempotency.required },
      execution: { taskSupport: "forbidden" as const },
    }))),
    async invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult> {
      // Selection/input refusal happens before minting any host authority.
      if (hasForgedArtifactCallerFields(args)) return refusal("invalid_request", false);
      try { validateArtifactInput(tool, args); }
      catch (error) {
        if (error instanceof ArtifactProfileInputError) return refusal(error.publicCode, error.retriable);
        throw error;
      }
      // Defense in depth behind the registry: the namespace already refuses a
      // declared scope, and only this check expresses the legacy-read "or".
      if (!isArtifactToolName(tool) || !hasArtifactScope(tool, request.principal.scopes, scopePolicy)) {
        return artifactScopeDenied(tool);
      }
      let frozen: FrozenCallAuthority | undefined;
      if (admission) {
        let decision;
        try {
          decision = await checkAdmission(admission, request.principal.sub, scope);
        } catch {
          return refusal("capability_unavailable", true);
        }
        if (!decision.allowed) return refusal(decision.body.error, false);
        // General opening reports no workspace: nothing is frozen, so the
        // commit guard below cannot diverge from it.
        if (decision.workspaceId !== "") frozen = Object.freeze({ workspaceId: decision.workspaceId, scope });
      }
      let authority: AuthorizeCommit;
      try {
        authority = authorizeCommit(request, frozen);
        if (typeof authority !== "function") throw new Error("artifact_authority_unavailable");
      } catch { return refusal("capability_unavailable", true); }
      const invocation: ArtifactInvocationContext = Object.freeze({
        invocationId: randomUUID(), actorId: request.principal.sub, storageScopeId: scope,
        authorizeCommit: authority,
      });
      if (!ARTIFACT_STRICT && tool === "artifacts_delete" && args && typeof args === "object" && !Array.isArray(args) &&
        !Object.hasOwn(args, "expectedCurrentReleaseId")) {
        if (!options.prepareDelete) return refusal("capability_unavailable", true);
        try { args = await options.prepareDelete(request.principal.sub, args as Record<string, unknown>); }
        catch { return refusal("capability_unavailable", true); }
      }
      let body: unknown;
      if (tool === "artifacts_get_source" || tool === "artifacts_list_versions") {
        // The shared facade rereads IMMO admission after every source blob has been read.
        const response = await sourceControl.handle(tool.slice("artifacts_".length), request.principal.sub, args);
        if (response.status < 200 || response.status >= 300) {
          if (ARTIFACT_PART1) return { isError: true, content: [{ type: "text", text: JSON.stringify(projectContentUrls(response.body)) }] };
          const error = response.body as { error: string; details?: unknown };
          return refusal(error.error, (response as { retryable?: boolean }).retryable === true,
            error.details ? { details: error.details } : {});
        }
        body = projectContentUrls(response.body);
        if (tool === "artifacts_list_versions" && options.directory) {
          await projectListVersionsAuthors(body, scope, options.directory);
        }
      } else {
        const outcome = await executor.execute({ tool, args, invocation });
        if (!outcome.ok) {
          if (admission && outcome.failure.conflict?.currentSource !== undefined) {
            try {
              const current = await checkAdmission(admission, request.principal.sub, scope);
              if (!current.allowed) return refusal(current.body.error, false);
            } catch { return refusal("capability_unavailable", true); }
          }
          const projected = projectArtifactHttpOutcome(outcome, true).body as { error: { message: string; details?: unknown } };
          if (ARTIFACT_PART1) return { isError: true, content: [{ type: "text", text: JSON.stringify(projectContentUrls(projectArtifactHttpOutcome(outcome, true).body)) }] };
          const details = ARTIFACT_STRICT || outcome.failure.details || outcome.failure.conflict || outcome.failure.edit || outcome.failure.release
            ? projected.error.details : undefined;
          return refusal(outcome.failure.publicCode, outcome.failure.retriable, {
            ...(outcome.failure.publicCode === "precondition_required" ? { message: projected.error.message } : {}),
            ...(details ? { details } : {}),
          });
        }
        body = projectContentUrls(projectArtifactHttpOutcome(outcome, ARTIFACT_PART1).body);
        if (tool === "artifacts_publish" || tool === "artifacts_revert" || tool === "artifacts_publish_bundle" ||
          tool === "artifacts_publish_bundle_v2") {
          const payload = (body as { output?: unknown }).output ?? body;
          const record = payload as { artifactId?: unknown; releaseId?: unknown };
          const requestArgs = args as { artifactId?: unknown };
          try {
            assertContentIdsDisjoint(requestArgs.artifactId ?? record.artifactId, record.releaseId);
          } catch {
            return refusal("provider_error", false);
          }
        }
      }
      // The durable receipt is untouched: the guide rides the MCP response
      // only, so tool selection and republication both surface it. Source
      // files are projected to text first so a page read stays editable.
      const result = withAuthoringGuide(tool,
        tool === "artifacts_get_source" ? projectSourceBody(body) : body);
      return { content: [{ type: "text", text: JSON.stringify(result) }],
        ...(!ARTIFACT_PART1 && artifactReadOutputSchema(tool) ? { structuredContent: result as Record<string, unknown> } : {}) };
    },
  });
  bindings.add(binding);
  return binding;
}

/**
 * MIME types the MCP source projection decodes to `text`. The publish
 * contract accepts exactly one of `text` or `bytes` per file; `text/*`
 * plus `application/json` covers every MIME type the profile admits, and
 * any future non-text type (or undecodable payload) keeps `bytes`.
 */
const SOURCE_TEXT_MIME_TYPES: ReadonlySet<string> = new Set(
  ["text/html", "text/css", "text/javascript", "application/json"]);

function isSourceTextMime(mimeType: unknown): boolean {
  if (typeof mimeType !== "string") return false;
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return base.startsWith("text/") || SOURCE_TEXT_MIME_TYPES.has(base);
}

function decodeStrictUtf8(bytes: readonly number[]): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

/**
 * Project one retained source file from the upstream 0.2.9 wire form to the
 * publish-compatible #982 form. Upstream 0.2.7+ encodes verified bytes as
 * `{ text, encoding: "utf8" }` for valid UTF-8 text or `{ base64,
 * encoding: "base64" }` otherwise (never an integer array, which blows the
 * tool-result budget). The publish contract accepts exactly one of `text`
 * or `bytes` per file and rejects `encoding`/`base64`, so the projection
 * drops `encoding`, keeps `text` as-is and decodes `base64` back to `bytes`.
 * Every other field (path, mimeType, digest/size when present) is preserved
 * so integrity can still be checked and the file republishes as-is.
 *
 * BOM handling is explicit: upstream decodes without `ignoreBOM` and strips
 * `U+FEFF`, so a retained BOM arrives already stripped in `text`. The
 * projection preserves the stripped text (no FEFF); re-encoding is therefore
 * not byte-identical for BOM files, unlike the legacy `bytes` path below
 * which keeps FEFF via `ignoreBOM: true`.
 *
 * The legacy 0.2.6 `bytes` form is still accepted for fixtures: non-text
 * MIME types, missing MIME types, non-byte arrays and invalid UTF-8 keep
 * `bytes` untouched.
 */
export function projectSourceFile(file: unknown): unknown {
  if (typeof file !== "object" || file === null || Array.isArray(file)) return file;
  const entry = file as Record<string, unknown>;
  if (typeof entry.encoding === "string") {
    const { encoding: _encoding, ...withoutEncoding } = entry;
    if (entry.encoding === "utf8" && typeof entry.text === "string") {
      const { base64: _base64, bytes: _bytes, ...rest } = withoutEncoding;
      return { ...rest, text: entry.text };
    }
    if (entry.encoding === "base64" && typeof entry.base64 === "string") {
      try {
        const bytes = Array.from(Buffer.from(entry.base64, "base64"));
        const { base64: _base64, text: _text, bytes: _oldBytes, ...rest } = withoutEncoding;
        return { ...rest, bytes };
      } catch {
        return file;
      }
    }
    const { base64: _droppedBase64, ...rest } = withoutEncoding;
    return rest;
  }
  if (!Array.isArray(entry.bytes) || entry.text !== undefined) return file;
  const bytes = entry.bytes as unknown[];
  if (!bytes.every((byte) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255)) return file;
  if (!isSourceTextMime(entry.mimeType)) return file;
  const text = decodeStrictUtf8(bytes as number[]);
  if (text === undefined) return file;
  const { bytes: _dropped, ...rest } = entry;
  return { ...rest, text };
}

/**
 * Project a get_source response body (v1 root `files` or v2
 * `output.files`) from the 0.2.9 wire form to the publish-compatible form
 * per {@link projectSourceFile}. Unknown shapes pass through unchanged.
 */
export function projectSourceBody(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return body;
  const root = body as Record<string, unknown>;
  const output = root.output;
  if (output !== null && typeof output === "object" && !Array.isArray(output)) {
    const out = output as Record<string, unknown>;
    if (Array.isArray(out.files)) return { ...root, output: { ...out, files: out.files.map(projectSourceFile) } };
    return body;
  }
  if (Array.isArray(root.files)) return { ...root, files: root.files.map(projectSourceFile) };
  return body;
}

/**
 * Small guide reference attached to get_source responses instead of the
 * full authoring guide: identity (guideId/revision) plus the lifecycle
 * hint the edit journey needs. Anything else (starter files, components,
 * checklist) stays on ensure/get, where the model reads it once.
 */
export function getSourceGuideReference(): {
  readonly guideId: string; readonly revision: string;
  readonly lifecycle: unknown; readonly artifactLifecycle: unknown;
} {
  const guide = getAuthoringGuide();
  return { guideId: guide.guideId, revision: guide.revision,
    lifecycle: guide.lifecycle, artifactLifecycle: guide.artifactLifecycle };
}

/**
 * Ensure and get responses carry the full authoring guide alongside the
 * durable receipt fields. Source responses carry only the small guide
 * reference so the file payload stays within the model tool-result
 * budget. Anything else passes through unchanged.
 */
export function withAuthoringGuide(tool: string, body: unknown): unknown {
  if ((tool === "artifacts_ensure" || tool === "artifacts_get" || tool === "artifacts_get_source") &&
    typeof body === "object" && body !== null && !Array.isArray(body)) {
    const guide = tool === "artifacts_get_source" ? getSourceGuideReference() : getAuthoringGuide();
    if (ARTIFACT_PART1) {
      const envelope = body as { ok: boolean; output?: object };
      if (!envelope.ok || !envelope.output) return body;
      return { ...envelope, output: { ...envelope.output, authoringGuide: guide } };
    }
    return { ...body, authoringGuide: guide };
  }
  return body;
}

export function assertArtifactBinding(value: ArtifactMcpBinding): void {
  if (!bindings.has(value)) throw new Error("artifact_binding_unrecognized");
}

/** The stateful bridge is the only active dispatcher, just like the twelve Immo tools. */
function nativeAdapter(manifest: ArtifactManifest) {
  return Object.freeze({
    appId: manifest.appId, connectorId: manifest.providerId,
    manifest, resolveTenant: unavailable,
    listCapabilities: async () => [...manifest.tools],
    invokeTool: unavailable, readResource: unavailable, validateSecrets: unavailable,
  });
}
export const ARTIFACT_NATIVE_ADAPTER = nativeAdapter(IMMO_ARTIFACT_MANIFEST);
