export const releaseAnchor = Object.freeze({
  packageName: "@sentropic/llm-mesh",
  version: null,
  publicationEvidence: null,
});

export const frozenInputs = Object.freeze({
  manifest: Object.freeze({
    path: "docs/reviews/refresh-benchmark/v3/manifest.json",
    sha256: "a9310deb5589aebb10502a40caf651af0f60db98cc7a818bec56f7a6b56c29f1",
  }),
  prompts: Object.freeze({
    path: "docs/reviews/refresh-benchmark/v3/prompt-freeze.json",
    sha256: "0685fc9e08408d3a88248493d29ed471a944ce8ac932d1022e82f7b24c32b5b0",
  }),
  documents: Object.freeze([
    ["lac-des-seize-iles-2026-09-agenda", "6bfd190a0aff3ea2679edf5bdf7e727161d24052ce08c0c385427b0ec3c07a96"],
    ["saint-etienne-de-bolton-2026-08-04", "27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d"],
    ["valcourt-2026-06-01-agenda", "31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d"],
    ["saint-barthelemy-2026-09-08", "ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845"],
    ["waterloo-2026-08-18", "c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd"],
  ]),
});

export const adapterBindings = Object.freeze({
  gemini: Object.freeze({ adapter: "GeminiAdapter", client: "CloudCodeRuntimeClient" }),
  openai: Object.freeze({ adapter: "OpenAIAdapter", client: "CodexRuntimeClient" }),
});

export const executionContract = Object.freeze({
  graphify: Object.freeze({ packageName: "@sentropic/graphify", version: "0.18.0" }),
  graphifyFactory: "createGraphifyMesh",
  systemPromptSha256: "bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461",
  maxOutputTokens: 16_384,
  transportTimeoutMs: 480_000,
  maxAttempts: 2,
  retryOnlyAfter: "transport_failure",
});
