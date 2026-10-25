import { randomUUID } from "node:crypto";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest,
  createArtifactsToolExecutor, ArtifactProfileInputError, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext, AuthorizeCommit } from "@sentropic/artifacts/server/commit-contract";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { computeManifestDigest, type RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
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

export interface ArtifactMcpBinding {
  readonly manifest: RegistryDefinition["manifest"];
  readonly configuration: Readonly<{ storageScopeId: string }>;
  readonly tools: readonly Tool[];
  invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult>;
}

/** A trusted host injects its shared app; this constructor supplies no persistence or policy fallback. */
export function bindArtifactProvider(options: {
  readonly app: ArtifactsApp;
  readonly storageScopeId: string;
  readonly authorizeCommit: (request: VerifiedMcpRequest) => AuthorizeCommit;
}): ArtifactMcpBinding {
  if (!options.storageScopeId.trim() || typeof options.authorizeCommit !== "function") {
    throw new Error("artifact_binding_incomplete");
  }
  const executor = createArtifactsToolExecutor({ app: options.app, profile: IMMO_ARTIFACT_PROFILE });
  const scope = options.storageScopeId;
  const authorizeCommit = options.authorizeCommit;
  const binding: ArtifactMcpBinding = Object.freeze({
    manifest: IMMO_ARTIFACT_MANIFEST,
    configuration: Object.freeze({ storageScopeId: scope }),
    tools: Object.freeze(IMMO_ARTIFACT_MANIFEST.tools.map((tool: Tool) => freeze({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool["inputSchema"],
      execution: { taskSupport: "forbidden" as const },
    }))),
    async invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult> {
      // Selection/input refusal happens before minting any host authority.
      try { IMMO_ARTIFACT_PROFILE.validate(tool, args); }
      catch (error) {
        if (error instanceof ArtifactProfileInputError) return refusal(error.publicCode, error.retriable);
        throw error;
      }
      if (!request.principal.scopes.includes(ARTIFACT_INVOCATION_SCOPE)) throw new Error("artifact_scope_denied");
      let authority: AuthorizeCommit;
      try {
        authority = authorizeCommit(request);
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
