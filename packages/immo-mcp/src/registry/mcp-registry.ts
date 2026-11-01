/**
 * Local MCP composition registry for P3 embedded configuration.
 *
 * Pure synchronous validation over provider definitions and the artifact
 * activation request. Makes no network request: there is no central
 * registry and no fetch import in this module.
 */
import {
  ARTIFACT_DURABLE_IDENTITY,
  ARTIFACT_EFFECTIVE_REQUIRED,
  ARTIFACT_INVOCATION_SCOPES,
  ARTIFACT_PROFILE_REVISION,
  ARTIFACT_SELECTION,
  ARTIFACT_TOOL_SCOPES,
  REQUIRED_PROVIDER_CONTRACTS,
  isArtifactToolName,
  type ArtifactToolName,
} from "./artifact-profile.js";
import { IMMO_TOOL_BINDINGS, IMMO_TOOL_SCOPES, isImmoToolName } from "./immo-provider.js";
export const REGISTRY_NETWORK_POLICY = "no-central-registry-request" as const;
export const ARTIFACT_PROVIDER_ID = "sentropic.artifacts" as const;

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;
export const DEFAULT_ALLOWED_SCOPES: readonly string[] = ["immo:read", "immo:search", "immo:documents:read"];
/** Artifact tools never borrow an Immo data scope: each one requires its explicit artifact scope. */
export const ARTIFACT_ALLOWED_SCOPES: readonly string[] = [ARTIFACT_INVOCATION_SCOPES.read, ARTIFACT_INVOCATION_SCOPES.write];

export interface RegistryToolBinding {
  readonly context: string;
  readonly registeredBy: string;
}

export interface RegistryToolDefinition {
  readonly name: string;
  readonly scope: string;
  readonly binding: RegistryToolBinding;
}

export interface ProviderDefinition {
  readonly id: string;
  readonly version: string;
  readonly tools: readonly RegistryToolDefinition[];
}

export interface ArtifactSelectionRequest {
  readonly tool: string;
  readonly operation: string;
  readonly method: string;
  readonly path: string;
  readonly command: string;
}

export interface ArtifactActivationRequest {
  readonly providerId: string;
  readonly selection: readonly ArtifactSelectionRequest[];
  readonly invocationScopes: { readonly read: string; readonly write: string };
  readonly profileRevision: string;
  readonly finalizationContract: string | null;
  readonly errorContract: string | null;
}

export class RegistryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "RegistryError";
    this.code = code;
  }
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function checkEffectiveProfile(
  required: Record<string, readonly string[]> = ARTIFACT_EFFECTIVE_REQUIRED as Record<string, readonly string[]>,
  durableIdentity: { readonly payloadHashInKey: boolean } = ARTIFACT_DURABLE_IDENTITY,
  requiredContracts: {
    readonly effectiveProfile: string;
    readonly durableCommandIdentity: string;
  } = REQUIRED_PROVIDER_CONTRACTS,
): void {
  for (const { tool } of ARTIFACT_SELECTION.filter(({ tool }) => ARTIFACT_TOOL_SCOPES[tool] === ARTIFACT_INVOCATION_SCOPES.write)) {
    if (!required[tool]?.includes("idempotencyKey")) {
      throw new RegistryError("unavailable_capability", `artifact tool ${tool} must require idempotencyKey`);
    }
  }
  if (!required["artifacts_ensure"]?.includes("bindingName")) {
    throw new RegistryError("unavailable_capability", "artifact tool artifacts_ensure must require bindingName");
  }
  if (!required["artifacts_publish"]?.includes("artifactId") ||
    !required["artifacts_publish"]?.includes("files")) {
    throw new RegistryError("unavailable_capability", "artifact tool artifacts_publish must require artifactId and files");
  }
  if (!required["artifacts_get"]?.includes("artifactId")) {
    throw new RegistryError("unavailable_capability", "artifact tool artifacts_get must require artifactId");
  }
  for (const { tool } of ARTIFACT_SELECTION.filter(({ tool }) => tool !== "artifacts_ensure" && tool !== "artifacts_list")) {
    if (!required[tool]?.includes("artifactId")) throw new RegistryError("unavailable_capability", `artifact tool ${tool} must require artifactId`);
  }
  if (durableIdentity.payloadHashInKey !== false) {
    throw new RegistryError("unavailable_capability", "durable identity must not embed a payload hash in the key");
  }
  if (requiredContracts.effectiveProfile !== ARTIFACT_PROFILE_REVISION ||
    requiredContracts.durableCommandIdentity !== ARTIFACT_PROFILE_REVISION) {
    throw new RegistryError("incompatible_version", "effective profile and durable identity must track the profile revision");
  }
}

export function checkTool(def: RegistryToolDefinition, allowedScopes: readonly string[]): void {
  if (typeof def.name !== "string" || !TOOL_NAME_RE.test(def.name)) {
    throw new RegistryError("malformed_parameter", `tool name ${JSON.stringify(def.name)} is malformed`);
  }
  if (!def.binding || typeof def.binding.context !== "string" || !def.binding.context.trim() ||
    def.binding.registeredBy !== "registerTools" ||
    (isImmoToolName(def.name) && def.binding.context !== IMMO_TOOL_BINDINGS[def.name].context)) {
    throw new RegistryError("missing_binding", `tool ${def.name} has no handler binding`);
  }
  const scopeAllowed = isArtifactToolName(def.name)
    ? ARTIFACT_ALLOWED_SCOPES.includes(def.scope) && def.scope === ARTIFACT_TOOL_SCOPES[def.name]
    : DEFAULT_ALLOWED_SCOPES.includes(def.scope) && allowedScopes.includes(def.scope) &&
      !(isImmoToolName(def.name) && def.scope !== IMMO_TOOL_SCOPES[def.name]);
  if (!scopeAllowed) {
    throw new RegistryError("generic_scope", `tool ${def.name} scope ${def.scope} is not an Immo scope`);
  }
}

export function checkArtifact(request: ArtifactActivationRequest, providers: readonly ProviderDefinition[]): void {
  const matchingProviders = providers.filter(({ id }) => id === request.providerId);
  if (matchingProviders.length > 1) {
    throw new RegistryError("duplicate_tool", `artifact provider ${request.providerId} is declared twice`);
  }
  const provider = matchingProviders[0];
  if (request.providerId !== ARTIFACT_PROVIDER_ID || !provider) {
    throw new RegistryError("unknown_provider", `artifact provider ${request.providerId} is not registered`);
  }
  if (request.invocationScopes?.read !== ARTIFACT_INVOCATION_SCOPES.read ||
    request.invocationScopes?.write !== ARTIFACT_INVOCATION_SCOPES.write) {
    throw new RegistryError("generic_scope",
      `artifact invocation scopes must be ${ARTIFACT_INVOCATION_SCOPES.read} and ${ARTIFACT_INVOCATION_SCOPES.write}`);
  }
  if (request.profileRevision !== ARTIFACT_PROFILE_REVISION) {
    throw new RegistryError("incompatible_version", `artifact profile ${request.profileRevision} is not supported`);
  }
  if (request.selection.length !== ARTIFACT_SELECTION.length) {
    throw new RegistryError("unavailable_capability", `artifact selection must list exactly ${ARTIFACT_SELECTION.length} tools`);
  }
  checkEffectiveProfile();
  const selected = new Set<string>();
  for (const entry of request.selection) {
    if (selected.has(entry.tool)) {
      throw new RegistryError("duplicate_tool", `artifact tool ${entry.tool} is selected twice`);
    }
    selected.add(entry.tool);
    const expected = ARTIFACT_SELECTION.find((item) => item.tool === (entry.tool as ArtifactToolName));
    const matchingTools = provider.tools.filter(({ name }) => name === entry.tool);
    if (matchingTools.length > 1) {
      throw new RegistryError("duplicate_tool", `artifact tool ${entry.tool} is declared twice`);
    }
    const declared = matchingTools[0];
    if (!expected || !declared) {
      throw new RegistryError("unavailable_capability", `artifact tool ${entry.tool} is not selectable`);
    }
    if (declared.scope !== ARTIFACT_TOOL_SCOPES[entry.tool as ArtifactToolName]) {
      throw new RegistryError("generic_scope",
        `artifact tool ${entry.tool} scope must be ${ARTIFACT_TOOL_SCOPES[entry.tool as ArtifactToolName]}`);
    }
    if (expected.operation !== entry.operation || expected.method !== entry.method ||
      expected.path !== entry.path || expected.command !== entry.command) {
      throw new RegistryError("unavailable_capability", `artifact tool ${entry.tool} mapping is not supported`);
    }
  }
  if (typeof request.finalizationContract !== "string" || !request.finalizationContract.trim() ||
    request.finalizationContract === "pending-upstream") {
    throw new RegistryError("missing_finalization_binding", "finalization authorization contract is required");
  }
  if (typeof request.errorContract !== "string" || !request.errorContract.trim() ||
    request.errorContract === "pending-upstream") {
    throw new RegistryError("missing_error_binding", "typed-failure contract is required");
  }
}
