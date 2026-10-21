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
}

export interface CompiledComposition {
  readonly providers: readonly string[];
  readonly toolScopes: Record<string, string>;
  readonly artifact: CompiledArtifact | null;
  readonly digest: string;
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
  const seen = new Set<string>();
  const toolScopes: Record<string, string> = Object.create(null);
  for (const provider of providers) {
    if (!provider.id || typeof provider.id !== "string") {
      throw new RegistryError("malformed_parameter", "provider id is malformed");
    }
    if (!["immo", "sentropic.artifacts"].includes(provider.id)) {
      throw new RegistryError("unknown_provider", `provider ${provider.id} is unknown`);
    }
    if (!/^\d+\.\d+\.\d+$/.test(provider.version)) {
      throw new RegistryError("incompatible_version", `provider ${provider.id} version is malformed`);
    }
    if (provider.id === IMMO_PROVIDER_ID && provider.version !== IMMO_PROVIDER_VERSION) {
      throw new RegistryError("incompatible_version", "Immo provider version is not supported");
    }
    const expected = options?.expectedVersions?.[provider.id];
    if (expected !== undefined && expected !== provider.version) {
      throw new RegistryError("incompatible_version", `provider ${provider.id} version mismatch`);
    }
    if (provider.tools.length === 0) {
      throw new RegistryError("malformed_parameter", `provider ${provider.id} declares no tools`);
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
  let artifact: CompiledArtifact | null = null;
  if (options?.artifact) {
    checkArtifact(options.artifact, providers);
    const request = options.artifact;
    artifact = Object.freeze({
      providerId: request.providerId,
      selection: Object.freeze(request.selection.map((entry) => Object.freeze({ ...entry }))),
      profileRevision: request.profileRevision,
      finalizationContract: request.finalizationContract,
      errorContract: request.errorContract,
    });
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize({
      providers: [...providers].map((p) => ({
        id: p.id,
        version: p.version,
        tools: [...p.tools].map((t) => ({ name: t.name, scope: t.scope, binding: t.binding }))
          .sort((a, b) => (a.name < b.name ? -1 : 1)),
      })).sort((a, b) => (a.id < b.id ? -1 : 1)),
      artifact,
    })), "utf8")
    .digest("hex");
  return Object.freeze({
    providers: Object.freeze(providers.map((p) => p.id)), toolScopes: Object.freeze(toolScopes), artifact, digest,
  });
}
