/**
 * Candidate compilation over validated provider definitions.
 *
 * Pure and side-effect free: never mutates its inputs, performs no I/O and
 * freezes the selection plus effective profile into a digest before any
 * manifest, handler or digest consumer could observe them.
 */
import { createHash } from "node:crypto";
import { IMMO_PROVIDER_ID, IMMO_PROVIDER_VERSION, IMMO_TOOL_NAMES } from "./immo-provider.js";
import {
  artifactEffectiveProfile,
  ARTIFACT_DURABLE_IDENTITY,
  ARTIFACT_EFFECTIVE_REQUIRED,
  ARTIFACT_PROVIDER_VERSION,
  REQUIRED_PROVIDER_CONTRACTS,
  type ArtifactToolName,
} from "./artifact-profile.js";
import {
  ARTIFACT_PROVIDER_ID,
  canonicalize,
  checkArtifact,
  checkTool,
  DEFAULT_ALLOWED_SCOPES,
  RegistryError,
  type ArtifactActivationRequest,
  type ProviderDefinition,
} from "./mcp-registry.js";

export interface CompiledArtifact {
  readonly providerId: string;
  readonly selection: ArtifactActivationRequest["selection"];
  readonly profileRevision: string;
  readonly finalizationContract: string | null;
  readonly errorContract: string | null;
  readonly effectiveRequired: Record<ArtifactToolName, readonly string[]>;
  readonly effectiveProfile: ReturnType<typeof artifactEffectiveProfile>;
  readonly durableIdentity: typeof ARTIFACT_DURABLE_IDENTITY;
  readonly requiredContracts: typeof REQUIRED_PROVIDER_CONTRACTS;
}

export interface CompiledComposition {
  readonly providers: readonly string[];
  readonly toolScopes: Record<string, string>;
  readonly artifact: CompiledArtifact | null;
  readonly digest: string;
}

function freezeProfile<T extends object>(value: T): T {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === "object") freezeProfile(child);
  }
  return Object.freeze(value);
}

export function compileComposition(
  providers: readonly ProviderDefinition[],
  options?: {
    readonly artifact?: ArtifactActivationRequest | undefined;
    readonly expectedVersions?: Record<string, string> | undefined;
    readonly allowedScopes?: readonly string[] | undefined;
  },
): CompiledComposition {
  const allowedScopes = options?.allowedScopes ?? DEFAULT_ALLOWED_SCOPES;
  const providerIds = new Set<string>();
  const seen = new Set<string>();
  const toolScopes: Record<string, string> = Object.create(null);
  const hasArtifactProvider = providers.some((provider) => provider.id === ARTIFACT_PROVIDER_ID);
  for (const provider of providers) {
    if (!provider.id || typeof provider.id !== "string") {
      throw new RegistryError("malformed_parameter", "provider id is malformed");
    }
    if (providerIds.has(provider.id)) {
      throw new RegistryError("duplicate_tool", `provider ${provider.id} is declared twice`);
    }
    providerIds.add(provider.id);
    if (provider.id !== IMMO_PROVIDER_ID && provider.id !== ARTIFACT_PROVIDER_ID) {
      throw new RegistryError("unknown_provider", `provider ${provider.id} is unknown`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(provider.version)) {
      throw new RegistryError("incompatible_version", `provider ${provider.id} version is malformed`);
    }
    if (provider.id === IMMO_PROVIDER_ID && provider.version !== IMMO_PROVIDER_VERSION) {
      throw new RegistryError("incompatible_version", "Immo provider version is not supported");
    }
    if (provider.id === ARTIFACT_PROVIDER_ID && provider.version !== ARTIFACT_PROVIDER_VERSION) {
      throw new RegistryError("incompatible_version", "Artifact provider version is not supported");
    }
    const expected = options?.expectedVersions?.[provider.id];
    if (expected !== undefined && expected !== provider.version) {
      throw new RegistryError("incompatible_version", `provider ${provider.id} version mismatch`);
    }
    if (provider.tools.length === 0) {
      throw new RegistryError("malformed_parameter", `provider ${provider.id} declares no tools`);
    }
    if (provider.id === ARTIFACT_PROVIDER_ID) {
      continue;
    }
    for (const tool of provider.tools) {
      checkTool(tool, allowedScopes);
      if (seen.has(tool.name)) {
        throw new RegistryError("duplicate_tool", `tool ${tool.name} is declared twice`);
      }
      seen.add(tool.name);
      toolScopes[tool.name] = tool.scope;
    }
  }
  const immoTools = providers.find((p) => p.id === IMMO_PROVIDER_ID)?.tools.map((t) => t.name) ?? [];
  const locked = new Set<string>(IMMO_TOOL_NAMES as readonly string[]);
  if (immoTools.length !== locked.size || immoTools.some((name) => !locked.has(name))) {
    throw new RegistryError("immutable_toolset", "Immo provider must expose exactly the twelve locked tools");
  }
  if (hasArtifactProvider && !options?.artifact) {
    throw new RegistryError("unavailable_capability", "artifact provider requires a validated selection");
  }
  let artifact: CompiledArtifact | null = null;
  if (options?.artifact) {
    checkArtifact(options.artifact, providers);
    const request = options.artifact;
    const provider = providers.find(({ id }) => id === request.providerId);
    if (!provider) {
      throw new RegistryError("unknown_provider", `artifact provider ${request.providerId} is not registered`);
    }
    for (const entry of request.selection) {
      const declared = provider.tools.find(({ name }) => name === entry.tool);
      if (!declared) {
        throw new RegistryError("unavailable_capability", `artifact tool ${entry.tool} is not selectable`);
      }
      checkTool(declared, allowedScopes);
      if (seen.has(declared.name)) {
        throw new RegistryError("duplicate_tool", `tool ${declared.name} is declared twice`);
      }
      seen.add(declared.name);
      toolScopes[declared.name] = declared.scope;
    }
    artifact = Object.freeze({
      providerId: request.providerId,
      selection: Object.freeze(request.selection.map((entry) => Object.freeze({
        tool: entry.tool,
        operation: entry.operation,
        method: entry.method,
        path: entry.path,
        command: entry.command,
      }))),
      profileRevision: request.profileRevision,
      finalizationContract: request.finalizationContract,
      errorContract: request.errorContract,
      effectiveRequired: Object.freeze({
        artifacts_ensure: Object.freeze([...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_ensure]),
        artifacts_publish: Object.freeze([...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_publish]),
        artifacts_list: Object.freeze([...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_list]),
        artifacts_get: Object.freeze([...ARTIFACT_EFFECTIVE_REQUIRED.artifacts_get]),
      }) as Record<ArtifactToolName, readonly string[]>,
      effectiveProfile: freezeProfile(artifactEffectiveProfile()),
      durableIdentity: Object.freeze({ ...ARTIFACT_DURABLE_IDENTITY }),
      requiredContracts: Object.freeze({ ...REQUIRED_PROVIDER_CONTRACTS }),
    });
  }
  const digestProviders = [...providers].map((provider) => {
    if (provider.id === ARTIFACT_PROVIDER_ID && artifact !== null) {
      const declaredByName = new Map(provider.tools.map((tool) => [tool.name, tool]));
      return {
        id: provider.id,
        version: provider.version,
        tools: [...artifact.selection].map((entry) => {
          const declared = declaredByName.get(entry.tool);
          return { name: entry.tool, scope: declared?.scope, binding: declared?.binding };
        }).sort((a, b) => (a.name < b.name ? -1 : 1)),
      };
    }
    return {
      id: provider.id,
      version: provider.version,
      tools: [...provider.tools].map((t) => ({ name: t.name, scope: t.scope, binding: t.binding }))
        .sort((a, b) => (a.name < b.name ? -1 : 1)),
    };
  }).sort((a, b) => (a.id < b.id ? -1 : 1));
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize({
      providers: digestProviders,
      artifact,
    })), "utf8")
    .digest("hex");
  return Object.freeze({
    providers: Object.freeze(providers.map((p) => p.id)), toolScopes: Object.freeze(toolScopes), artifact, digest,
  });
}
