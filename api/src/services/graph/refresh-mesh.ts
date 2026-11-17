import type { TextJsonGenerationClient } from "@sentropic/engram";
import {
  createRefreshRoutedMesh,
  refreshTextJsonClient,
  type RefreshRoutedMesh,
} from "./refresh-routed-mesh.js";
import {
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  DEFAULT_ROUTE_POLICY,
  GeminiAdapter,
  InMemoryRoutePolicyProfiles,
  MuseAdapter,
  MuseRuntimeClient,
  OpenAIAdapter,
  type GenerateRequest,
  type GeminiAdapterClient,
  type MuseAdapterClient,
  type OpenAIAdapterClient,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh-refresh";
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type KeyringAdapter,
} from "@sentropic/llm-mesh-refresh/facade";

export type RefreshProvider = "gemini" | "openai" | "muse";
export const REFRESH_PROVIDERS: readonly RefreshProvider[] = ["openai", "gemini", "muse"];
export function isRefreshProvider(value: string): value is RefreshProvider {
  return (REFRESH_PROVIDERS as readonly string[]).includes(value);
}

export interface RefreshMeshOptions {
  readonly routingSubject: VerifiedRoutingSubject;
  readonly configResolver: ConfigResolver;
  readonly keyring?: KeyringAdapter;
  readonly provider: RefreshProvider;
  readonly model: string;
  readonly maximumAttempts: number;
  readonly reasoning?: GenerateRequest["reasoning"];
  readonly signal: AbortSignal;
  readonly geminiClient?: GeminiAdapterClient;
  readonly openAiClient?: OpenAIAdapterClient;
  readonly museClient?: MuseAdapterClient;
  readonly openAiFetch?: typeof fetch;
}

export interface RefreshMeshBundle {
  readonly mesh: RefreshRoutedMesh;
  readonly textClient: TextJsonGenerationClient;
}

export function createRefreshRoutePolicyProfiles(
  maximumAttempts: number,
): InMemoryRoutePolicyProfiles {
  const profiles = new InMemoryRoutePolicyProfiles([{
    name: "refresh-run-budget",
    revision: "1",
    policy: { ...DEFAULT_ROUTE_POLICY, maxAttempts: maximumAttempts, allowEquivalentModels: false },
  }]);
  profiles.activate("refresh-run-budget");
  return profiles;
}

export function bindRefreshFetchSignal(
  fetchFunction: typeof fetch,
  signal: AbortSignal,
): typeof fetch {
  const anySignal = (AbortSignal as unknown as {
    any(signals: readonly AbortSignal[]): AbortSignal;
  }).any;
  return ((input: URL | RequestInfo, init?: RequestInit) => fetchFunction(input, {
    ...init,
    signal: init?.signal ? anySignal([init.signal, signal]) : signal,
  })) as typeof fetch;
}

export function refreshErrorDiagnostic(error: unknown): Record<string, string | number | undefined> {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = record["cause"] && typeof record["cause"] === "object"
    ? record["cause"] as Record<string, unknown> : {};
  // A wrapper (Graphify34ApplyInterrupted) around a DrizzleQueryError keeps the
  // database code two levels down: follow the chain to its last object. A cause
  // already visited ends the walk, so a cyclic chain stops on its last new link.
  let root = cause;
  const visited = new Set<unknown>([record, cause]);
  for (let next = root["cause"]; next && typeof next === "object" && !visited.has(next); next = root["cause"]) {
    visited.add(next);
    root = next as Record<string, unknown>;
  }
  const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)
    ? value : undefined;
  const status = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : undefined;
  // RoutePlanError carries why no account was eligible (e.g. `reauth-required`).
  // Only its code and transport id are logged — never its message.
  const route = record["diagnostic"] && typeof record["diagnostic"] === "object"
    ? record["diagnostic"] as Record<string, unknown> : {};
  const internalFrame = error instanceof Error ? error.stack?.split("\n").slice(1)
    .map((line) => line.trim()).find((line) => /^at [A-Za-z0-9_.<>]+ \(?node:internal\//.test(line)) : undefined;
  return { errorName: token(record["name"]), errorCode: token(record["code"]),
    statusCode: status(record["statusCode"] ?? record["status"]), requestId: token(record["requestId"]),
    causeName: token(cause["name"]), causeCode: token(cause["code"]),
    causeStatusCode: status(cause["statusCode"] ?? cause["status"]),
    // Closed vocabulary only: the interrupted apply stage, never a message.
    stage: token(record["stage"]),
    rootCauseName: token(root["name"]), rootCauseCode: token(root["code"]),
    routeDiagnosticCode: token(route["code"]), routeTransportProviderId: token(route["transportProviderId"]),
    stackOrigin: internalFrame };
}

/** Muse Chat refuses reasoning controls (llm-mesh `unsupported_projection`):
 *  the effort of a muse route is the provider default, never forwarded. */
export function refreshRouteReasoning(
  provider: RefreshProvider,
  reasoning?: GenerateRequest["reasoning"],
): GenerateRequest["reasoning"] {
  return provider === "muse" ? undefined : reasoning;
}

export function bindRefreshAbortSignal(
  mesh: RefreshRoutedMesh,
  signal: AbortSignal,
  reasoning?: GenerateRequest["reasoning"],
): RefreshRoutedMesh {
  return {
    listProviders: mesh.listProviders,
    listModels: mesh.listModels,
    generate: (request) => mesh.generate({ ...request, ...(reasoning ? { reasoning } : {}), signal }),
    generateValidated: (request, validate) =>
      mesh.generateValidated({ ...request, ...(reasoning ? { reasoning } : {}), signal }, validate),
    stream: (request) => mesh.stream({ ...request, ...(reasoning ? { reasoning } : {}), signal }),
  };
}

export function createRefreshMesh(options: RefreshMeshOptions): RefreshMeshBundle {
  if (!options.routingSubject.principalRef || !options.routingSubject.ownerScopeRef) {
    throw new Error("Refresh mesh requires an explicit principal and owner scope");
  }
  if (!options.model.trim()) throw new Error("Refresh mesh requires an explicit model");

  const facade = createLlmMeshFacade({
    mode: "cli",
    configResolver: options.configResolver,
    ...(options.keyring ? { keyring: options.keyring } : {}),
  });
  const mesh = createRefreshRoutedMesh({
    routingSubject: options.routingSubject,
    adapters: {
      gemini: new GeminiAdapter({
        client: options.geminiClient ?? new CloudCodeRuntimeClient(bindRefreshFetchSignal(fetch, options.signal)),
      }),
      muse: new MuseAdapter({
        client: options.museClient ?? new MuseRuntimeClient({
          fetch: bindRefreshFetchSignal(fetch, options.signal),
        }),
      }),
      openai: new OpenAIAdapter({
        client: options.openAiClient ?? new CodexRuntimeClient({
          fetch: bindRefreshFetchSignal(options.openAiFetch ?? fetch, options.signal),
        }),
      }),
    },
    createRoutePlanner: (runtime) => facade.createRoutePlanner(runtime, {
      profiles: createRefreshRoutePolicyProfiles(options.maximumAttempts),
    }),
  });
  const abortable = bindRefreshAbortSignal(mesh, options.signal,
    refreshRouteReasoning(options.provider, options.reasoning));
  return {
    mesh: abortable,
    textClient: refreshTextJsonClient(abortable, {
      provider: options.provider,
      model: options.model,
    }),
  };
}
