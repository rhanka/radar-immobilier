import { randomUUID } from "node:crypto";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest,
  createArtifactsToolExecutor, ArtifactProfileInputError, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext, AuthorizeCommit } from "@sentropic/artifacts/server/commit-contract";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { computeManifestDigest, type RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
import { checkAdmission, type AdmissionAuthority } from "@radar/artifacts-host";
import { ARTIFACT_TOOL_NAMES, ARTIFACT_INVOCATION_SCOPE } from "./artifact-profile.js";

// Compile the complete versioned contract, including semantic rules, before registry admission.
export const IMMO_ARTIFACT_PROFILE = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...ARTIFACT_TOOL_NAMES] });
function freeze<T extends object>(value: T): T {
  for (const entry of Object.values(value)) if (entry && typeof entry === "object") freeze(entry);
  return Object.freeze(value);
}
export const IMMO_ARTIFACT_MANIFEST = freeze(createArtifactsManifest({
  profile: IMMO_ARTIFACT_PROFILE, invocationScope: ARTIFACT_INVOCATION_SCOPE,
}));
export const IMMO_ARTIFACT_MANIFEST_DIGEST = computeManifestDigest(IMMO_ARTIFACT_MANIFEST);
const bindings = new WeakSet<object>();
const unavailable = async (): Promise<never> => { throw new Error("native_wire_dispatch_required"); };
const refusal = (error: string, retryable: boolean): CallToolResult => ({ isError: true,
  content: [{ type: "text", text: JSON.stringify({ error, retryable }) }] });

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
}): ArtifactMcpBinding {
  if (!options.storageScopeId.trim() || typeof options.authorizeCommit !== "function") {
    throw new Error("artifact_binding_incomplete");
  }
  const executor = createArtifactsToolExecutor({ app: options.app, profile: IMMO_ARTIFACT_PROFILE });
  const scope = options.storageScopeId;
  const authorizeCommit = options.authorizeCommit;
  const admission = options.admission;
  const binding: ArtifactMcpBinding = Object.freeze({
    manifest: IMMO_ARTIFACT_MANIFEST,
    configuration: Object.freeze({ storageScopeId: scope }),
    tools: Object.freeze(IMMO_ARTIFACT_MANIFEST.tools.map((tool: Tool) => freeze({
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
      if (!request.principal.scopes.includes(ARTIFACT_INVOCATION_SCOPE)) throw new Error("artifact_scope_denied");
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
      return { content: [{ type: "text", text: JSON.stringify(outcome.result.body) }] };
    },
  });
  bindings.add(binding);
  return binding;
}

export function assertArtifactBinding(value: ArtifactMcpBinding): void {
  if (!bindings.has(value)) throw new Error("artifact_binding_unrecognized");
}

/** The stateful bridge is the only active dispatcher, just like the twelve Immo tools. */
export const ARTIFACT_NATIVE_ADAPTER = Object.freeze({
  appId: IMMO_ARTIFACT_MANIFEST.appId, connectorId: IMMO_ARTIFACT_MANIFEST.providerId,
  manifest: IMMO_ARTIFACT_MANIFEST, resolveTenant: unavailable,
  listCapabilities: async () => [...IMMO_ARTIFACT_MANIFEST.tools],
  invokeTool: unavailable, readResource: unavailable, validateSecrets: unavailable,
});
