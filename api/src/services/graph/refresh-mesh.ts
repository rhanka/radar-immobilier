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
}

export interface RefreshMeshBundle {
  readonly mesh: GraphifyMesh;
  readonly textClient: TextJsonGenerationClient;
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
        client: options.openAiClient ?? new CodexRuntimeClient(),
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
