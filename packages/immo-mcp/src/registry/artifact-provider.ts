import { randomUUID } from "node:crypto";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest,
  createArtifactsToolExecutor, ArtifactProfileInputError, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext, AuthorizeCommit } from "@sentropic/artifacts/server/commit-contract";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { computeManifestDigest, type RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
import { checkAdmission, type AdmissionAuthority } from "@radar/artifacts-host";
import { ARTIFACT_INVOCATION_SCOPES, ARTIFACT_TOOL_NAMES, ARTIFACT_TOOL_SCOPES, acceptedArtifactScopes, hasArtifactScope,
  isArtifactToolName, STRICT_ARTIFACT_SCOPE_POLICY, type ArtifactScopePolicy } from "./artifact-profile.js";
import { AUTHORING_GUIDE_SNIPPET, getAuthoringGuide } from "./artifact-authoring-guide.js";

// Compile the complete versioned contract, including semantic rules, before registry admission.
export const IMMO_ARTIFACT_PROFILE = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...ARTIFACT_TOOL_NAMES] });
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
 * Tools whose description carries the imperative DS + H5 core: ensure and
 * publish (page creation path) plus get (republication of an existing
 * page must find the guide too). The full contract ships in the
 * `authoringGuide` response field of ensure and get.
 */
const GUIDE_DESCRIPTION_TOOLS: ReadonlySet<string> = new Set(
  ["artifacts_ensure", "artifacts_publish", "artifacts_get"]);

export function createImmoArtifactManifest(policy: ArtifactScopePolicy = STRICT_ARTIFACT_SCOPE_POLICY): ArtifactManifest {
  const base = createArtifactsManifest({ profile: IMMO_ARTIFACT_PROFILE });
  const tools = base.tools.map((tool: ArtifactManifestTool) => {
    const name: string = tool.name;
    if (!isArtifactToolName(name)) throw new Error("artifact_tool_unselected");
    const accepted = acceptedArtifactScopes(name, policy);
    const description = GUIDE_DESCRIPTION_TOOLS.has(name)
      ? `${tool.description} ${AUTHORING_GUIDE_SNIPPET}` : tool.description;
    return { ...tool, description, requiredScopes: accepted.length === 1 ? [ARTIFACT_TOOL_SCOPES[name]] : [] };
  });
  const scopes = [ARTIFACT_INVOCATION_SCOPES.read, ARTIFACT_INVOCATION_SCOPES.write]
    .filter((scope) => tools.some((tool: ArtifactManifestTool) => tool.requiredScopes.includes(scope)));
  return freeze({ ...base, tools, authz: { ...base.authz, scopes } });
}
export const IMMO_ARTIFACT_MANIFEST = createImmoArtifactManifest(STRICT_ARTIFACT_SCOPE_POLICY);
export const IMMO_ARTIFACT_MANIFEST_DIGEST = computeManifestDigest(IMMO_ARTIFACT_MANIFEST);
const bindings = new WeakSet<object>();
const unavailable = async (): Promise<never> => { throw new Error("native_wire_dispatch_required"); };
const refusal = (error: string, retryable: boolean, extra: Record<string, unknown> = {}): CallToolResult => ({
  isError: true, content: [{ type: "text", text: JSON.stringify({ error, retryable, ...extra }) }] });

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
}): ArtifactMcpBinding {
  if (!options.storageScopeId.trim() || typeof options.authorizeCommit !== "function") {
    throw new Error("artifact_binding_incomplete");
  }
  const executor = createArtifactsToolExecutor({ app: options.app, profile: IMMO_ARTIFACT_PROFILE });
  const scope = options.storageScopeId;
  const authorizeCommit = options.authorizeCommit;
  const admission = options.admission;
  const scopePolicy: ArtifactScopePolicy = Object.freeze({ legacyReadScope: options.scopePolicy?.legacyReadScope === true });
  const manifest = scopePolicy.legacyReadScope ? createImmoArtifactManifest(scopePolicy) : IMMO_ARTIFACT_MANIFEST;
  const binding: ArtifactMcpBinding = Object.freeze({
    manifest,
    adapter: nativeAdapter(manifest),
    scopePolicy,
    configuration: Object.freeze({ storageScopeId: scope }),
    tools: Object.freeze(manifest.tools.map((tool: Tool) => freeze({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool["inputSchema"],
      execution: { taskSupport: "forbidden" as const },
    }))),
    async invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult> {
      // Selection/input refusal happens before minting any host authority.
      if (hasForgedArtifactCallerFields(args)) return refusal("invalid_request", false);
      try { IMMO_ARTIFACT_PROFILE.validate(tool, args); }
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
      const outcome = await executor.execute({ tool, args, invocation });
      if (!outcome.ok) return refusal(outcome.failure.publicCode, outcome.failure.retriable);
      // The durable receipt is untouched: the guide rides the MCP response
      // text only, so tool selection and republication both surface it.
      return { content: [{ type: "text", text: JSON.stringify(withAuthoringGuide(tool, outcome.result.body)) }] };
    },
  });
  bindings.add(binding);
  return binding;
}

/**
 * Ensure and get responses carry the full authoring guide alongside the
 * durable receipt fields. Anything else passes through unchanged.
 */
export function withAuthoringGuide(tool: string, body: unknown): unknown {
  if ((tool === "artifacts_ensure" || tool === "artifacts_get") &&
    typeof body === "object" && body !== null && !Array.isArray(body)) {
    return { ...body, authoringGuide: getAuthoringGuide() };
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
