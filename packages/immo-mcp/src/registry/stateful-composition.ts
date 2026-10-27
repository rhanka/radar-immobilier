import { convertInputShape, normalizeToolJsonSchema } from "../zod4-jsonschema.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createClusterMeshModules } from "@sentropic/cluster-mesh";
import { createMcpRegistry, computeManifestDigest, type RegistryDefinition } from "@sentropic/cluster-mesh/mcp/registry";
import { createStatefulMcpNamespace, type StatefulMcpHost, type VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ALL_TOOL_DEFINITIONS } from "../tool-definitions.js";
import { getInvocationContext } from "../invocation-context.js";
import { invokeTool } from "../tools.js";
import { AccountBindingUnavailable } from "../account-binding.js";
import { assertArtifactBinding, ARTIFACT_NATIVE_ADAPTER, type ArtifactMcpBinding } from "./artifact-provider.js";

// GeoJSON may contain 2,000 features; budgets must not impose a smaller semantic limit.
export const IMMO_WIRE_LIMITS = Object.freeze({
  maxSchemaBytes: 128 * 1024, maxSchemaDepth: 64,
  maxRequestBytes: 256 * 1024, maxArgumentBytes: 128 * 1024, maxArgumentDepth: 64,
  maxResultBytes: 32 * 1024 * 1024, maxResultDepth: 128,
});
export const ARTIFACT_WIRE_LIMITS = Object.freeze({ ...IMMO_WIRE_LIMITS,
  maxRequestBytes: 2 * 1024 * 1024, maxArgumentBytes: 2 * 1024 * 1024 });
export const IMMO_WIRE_TOOLS: readonly Tool[] = ALL_TOOL_DEFINITIONS.map((def) => {
  const schema = normalizeToolJsonSchema(def.name, convertInputShape(def.inputSchema));
  return { name: def.name, title: def.title, description: def.description,
    inputSchema: schema as Tool["inputSchema"], execution: { taskSupport: "forbidden" } };
});
const manifest: RegistryDefinition["manifest"] = {
  appId: "radar-immobilier", providerId: "immo", version: "0.0.1", displayName: "Immo",
  tools: IMMO_WIRE_TOOLS.map((tool, index) => ({
    kind: "tool", name: tool.name, description: tool.description!, inputSchema: tool.inputSchema,
    outputSchema: {}, requiredScopes: [ALL_TOOL_DEFINITIONS[index]!.scope], requiredClaims: [],
    redactionClass: "moderate", mutability: "read-only", mutatesExternalSystem: false,
    idempotency: { required: false }, gates: {
      requiresElicitation: false, requiresHumanConfirmation: false, requiresPrincipalGate: true,
    },
  })),
  resources: [], prompts: [], authz: { requiredClaims: [], scopes: ["immo:read"], tenantResolution: "app-org" },
  audit: { eventKinds: ["immo-mcp.tool"] }, durability: {},
};
const unavailable = async (): Promise<never> => { throw new Error("native_wire_dispatch_required"); };

/** Compile the digest-bound plan before exposing the single native SDK bridge. */
export async function composeStatefulImmo(
  host: StatefulMcpHost,
  authorize: (tool: string, request: VerifiedMcpRequest) => Promise<boolean>,
  artifacts?: ArtifactMcpBinding,
) {
  const unavailableAccounts = new WeakSet<VerifiedMcpRequest>();
  if (artifacts) assertArtifactBinding(artifacts);
  const modules = createClusterMeshModules();
  const registry = createMcpRegistry({ modules });
  registry.register({
    manifest, parameterSchema: { properties: {} }, requiredPorts: [],
    provenance: { approvalRef: "H4-P6-v3", revision: "1", manifestDigest: computeManifestDigest(manifest), reviewedBy: ["owner"] },
    handlers: Object.fromEntries(manifest.tools.map((tool) => [tool.name, {
      handlerId: tool.name, capabilityRef: tool.name, configSchema: { type: "object", additionalProperties: false },
    }])),
    toolValues: Object.fromEntries(manifest.tools.map((tool) => [tool.name, { handlerId: tool.name, values: {} }])),
    adapter: {
      appId: manifest.appId, connectorId: "immo", manifest,
      resolveTenant: unavailable, listCapabilities: unavailable, invokeTool: unavailable,
      readResource: unavailable, validateSecrets: unavailable,
    },
  });
  if (artifacts) {
    const artifactManifest = artifacts.manifest;
    registry.register({
      manifest: artifactManifest, requiredPorts: [], adapter: ARTIFACT_NATIVE_ADAPTER,
      parameterSchema: { properties: { storageScopeId: { type: "string" } }, required: ["storageScopeId"] },
      provenance: { approvalRef: "H4-P7-v3", revision: "1",
        manifestDigest: computeManifestDigest(artifactManifest), reviewedBy: ["owner"] },
      handlers: Object.fromEntries(artifactManifest.tools.map((tool) => [tool.name, {
        handlerId: tool.name, capabilityRef: tool.name, configSchema: { type: "object", additionalProperties: false },
      }])),
      toolValues: Object.fromEntries(artifactManifest.tools.map((tool) => [tool.name, { handlerId: tool.name, values: {} }])),
    });
  }
  registry.select(artifacts ? ["immo", artifacts.manifest.providerId] : ["immo"]);
  registry.configure("immo", {});
  if (artifacts) registry.configure(artifacts.manifest.providerId, artifacts.configuration);
  const compatibility = { immo: { manifestDigest: computeManifestDigest(manifest) },
    ...(artifacts ? { [artifacts.manifest.providerId]: { manifestDigest: computeManifestDigest(artifacts.manifest) } } : {}) };
  const compiled = await registry.compile({ bindings: {}, compatibility });
  if (!compiled.ok) throw new Error(`composition_invalid:${JSON.stringify(compiled.diagnostics)}`);
  return createStatefulMcpNamespace(modules, {
    host, registry: compiled.registry,
    tools: artifacts ? [...IMMO_WIRE_TOOLS, ...artifacts.tools] : IMMO_WIRE_TOOLS,
    limits: artifacts ? ARTIFACT_WIRE_LIMITS : IMMO_WIRE_LIMITS,
    async authorize(tool, request) {
      try { return await authorize(tool, request); }
      catch (error) {
        if (error instanceof AccountBindingUnavailable) unavailableAccounts.add(request);
        return false;
      }
    },
    async invoke(tool, args, request) {
      const snapshot = getInvocationContext();
      if (!snapshot || snapshot.auth.sub !== request.principal.sub) throw new Error("invocation_unavailable");
      if (artifacts?.tools.some((entry) => entry.name === tool)) return artifacts.invoke(tool, args, request);
      return invokeTool(tool, args, snapshot);
    },
    formatRefusal(tool, refusal, context) {
      const retriable = refusal.kind === "account" && unavailableAccounts.delete(context);
      const error = retriable ? "account_binding_unavailable"
        : refusal.kind === "scope" ? `scope_denied:${refusal.missingScopes.join(",")}` : `composition_${refusal.kind}`;
      return { isError: true, content: [{ type: "text", text: JSON.stringify({
        error, tool, correlationId: context.correlationId, ...(retriable ? { retriable: true } : {}),
      }, null, 2) }] };
    },
  });
}
