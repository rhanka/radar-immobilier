import { randomUUID } from "node:crypto";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createArtifactsManifest,
  createArtifactsToolExecutor, type ArtifactsApp } from "@sentropic/artifacts/mcp-core";
import type { ArtifactInvocationContext, AuthorizeCommit } from "@sentropic/artifacts/server/commit-contract";
import type { VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import type { RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
import { ARTIFACT_TOOL_NAMES, ARTIFACT_INVOCATION_SCOPE } from "./artifact-profile.js";

// Compile the complete versioned contract, including semantic rules, before registry admission.
export const IMMO_ARTIFACT_PROFILE = compileArtifactsProfile({ ...RADAR_ARTIFACTS_PROFILE,
  selectedCapabilities: [...ARTIFACT_TOOL_NAMES] });
export const IMMO_ARTIFACT_MANIFEST = createArtifactsManifest({
  profile: IMMO_ARTIFACT_PROFILE, invocationScope: ARTIFACT_INVOCATION_SCOPE,
});
const bindings = new WeakSet<object>();
const unavailable = async (): Promise<never> => { throw new Error("native_wire_dispatch_required"); };

export interface ArtifactMcpBinding {
  readonly manifest: RegistryDefinition["manifest"];
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
    tools: Object.freeze(IMMO_ARTIFACT_MANIFEST.tools.map((tool) => Object.freeze({
      name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Tool["inputSchema"],
      execution: { taskSupport: "forbidden" as const },
    }))),
    async invoke(tool: string, args: unknown, request: VerifiedMcpRequest): Promise<CallToolResult> {
      // Selection/input refusal happens before minting any host authority.
      IMMO_ARTIFACT_PROFILE.validate(tool, args);
      if (!request.principal.scopes.includes(ARTIFACT_INVOCATION_SCOPE)) throw new Error("artifact_scope_denied");
      const invocation: ArtifactInvocationContext = Object.freeze({
        invocationId: randomUUID(), actorId: request.principal.sub, storageScopeId: scope,
        authorizeCommit: authorizeCommit(request),
      });
      const outcome = await executor.execute({ tool, args, invocation });
      const payload = outcome.ok ? outcome.result.body : {
        error: outcome.failure.publicCode, retryable: outcome.failure.retriable,
      };
      return { ...(outcome.ok ? {} : { isError: true }),
        content: [{ type: "text", text: JSON.stringify(payload) }] };
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
  manifest: IMMO_ARTIFACT_MANIFEST, resolveTenant: unavailable, listCapabilities: unavailable,
  invokeTool: unavailable, readResource: unavailable, validateSecrets: unavailable,
});
