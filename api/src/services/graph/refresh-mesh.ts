import type { TextJsonGenerationClient } from "@sentropic/graphify";
import {
  createGraphifyMesh,
  meshTextJsonClient,
  type GraphifyMesh,
} from "@sentropic/graphify/llm-mesh";
import {
  CloudCodeRuntimeClient,
  CodexRuntimeClient,
  GeminiAdapter,
  OpenAIAdapter,
  type GenerateRequest,
  type GeminiAdapterClient,
  type OpenAIAdapterClient,
  type VerifiedRoutingSubject,
} from "@sentropic/llm-mesh-refresh";
import {
  createLlmMeshFacade,
  type ConfigResolver,
  type KeyringAdapter,
} from "@sentropic/llm-mesh-refresh/facade";

export type RefreshProvider = "gemini" | "openai";

export interface RefreshMeshOptions {
  readonly routingSubject: VerifiedRoutingSubject;
  readonly configResolver: ConfigResolver;
  readonly keyring?: KeyringAdapter;
  readonly provider: RefreshProvider;
  readonly model: string;
  readonly reasoning?: GenerateRequest["reasoning"];
  readonly signal: AbortSignal;
  readonly geminiClient?: GeminiAdapterClient;
  readonly openAiClient?: OpenAIAdapterClient;
  readonly openAiFetch?: typeof fetch;
}

export interface RefreshMeshBundle {
  readonly mesh: GraphifyMesh;
  readonly textClient: TextJsonGenerationClient;
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
  const token = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,120}$/.test(value)
    ? value : undefined;
  const status = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : undefined;
  const internalFrame = error instanceof Error ? error.stack?.split("\n").slice(1)
    .map((line) => line.trim()).find((line) => /^at [A-Za-z0-9_.<>]+ \(?node:internal\//.test(line)) : undefined;
  return { errorName: token(record["name"]), errorCode: token(record["code"]),
    statusCode: status(record["statusCode"] ?? record["status"]), requestId: token(record["requestId"]),
    causeName: token(cause["name"]), causeCode: token(cause["code"]),
    causeStatusCode: status(cause["statusCode"] ?? cause["status"]), stackOrigin: internalFrame };
}

export function bindRefreshAbortSignal(
  mesh: GraphifyMesh,
  signal: AbortSignal,
  reasoning?: GenerateRequest["reasoning"],
): GraphifyMesh {
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
  const mesh = createGraphifyMesh({
    routingSubject: options.routingSubject,
    adapters: {
      gemini: new GeminiAdapter({
        client: options.geminiClient ?? new CloudCodeRuntimeClient(),
      }),
      openai: new OpenAIAdapter({
        client: options.openAiClient ?? new CodexRuntimeClient({
          fetch: bindRefreshFetchSignal(options.openAiFetch ?? fetch, options.signal),
        }),
      }),
    },
    createRoutePlanner: (runtime) => facade.createRoutePlanner(runtime),
  });
  const abortable = bindRefreshAbortSignal(mesh, options.signal, options.reasoning);
  return {
    mesh: abortable,
    textClient: meshTextJsonClient(abortable, {
      provider: options.provider,
      model: options.model,
    }),
  };
}
