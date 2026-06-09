# `@sentropic/llm-mesh` — radar consumer boundary (WP5)

Radar is a **consumer** of `@sentropic/llm-mesh`, not a fork of its catalogue.
This note records the clean module boundary radar relies on, what radar imports
today, and what the sentropic **architect** is asked to modularize on the mesh
side so radar can drop its local glue. It is the durable capture of the parallel
**h2a request to `sentropic:architect`** (the deeper module-boundary
modularization runs on the sentropic side; radar built the consumer here).

## What radar consumes today

Two radar features call the same mesh, both off the single application mesh
wired in `api/src/services/chat/mesh-runtime.ts`:

1. **Chat (ÉV9)** — streaming, tool-calling (`streamChatTurns`).
2. **Semantic mention extraction (WP5, this branch)** — single-shot
   `radarLlmMesh.generate()` in `api/src/services/exploitation/semantic-extract.ts`,
   **off by default** (`RADAR_LLM_EXTRACTION=1` + a provider key).

From the published `@sentropic/llm-mesh` entry, radar imports only:

- **Mesh assembly**: `createLlmMesh`, `createProviderRegistry`.
- **Provider adapters**: `AnthropicAdapter`, `OpenAIAdapter`, `MistralAdapter`,
  `GeminiAdapter`, `CohereAdapter`.
- **Capability metadata**: `providerProfiles` (per-provider capability matrix).
- **Auth helper**: `getSecretAuthMaterial`.
- **Types**: `GenerateRequest`, `GenerateResponse`, `StreamRequest`,
  `StreamResult`, `StreamEvent`, `LlmMeshMessage`, `ModelProfile`,
  `ProviderAdapter`, `ProviderAdapterClient`, `ProviderRuntimeContext`,
  `ProviderId`, `ToolDefinition`.

The mesh ships the **adapter contract but not the concrete provider HTTP
clients**, so radar injects a single `ProviderAdapterClient`
(`RadarProviderMeshClient`) that dispatches to each provider's native streaming
HTTP API. The semantic extractor reuses this same client transparently via
`mesh.generate()` (which collects the stream into `response.text`).

## What radar still has to glue locally (the modularization target)

These live in `mesh-runtime.ts` only because the published package does not yet
expose them cleanly. They are the candidates for the architect to modularize:

1. **A reusable provider-HTTP client.** `RadarProviderMeshClient` (the SSE
   readers + per-provider request serializers for Anthropic / OpenAI / Mistral /
   Gemini / Cohere) is a verbatim mirror of sentropic's
   `ApplicationProviderMeshClient`. **Ask:** publish a first-class
   `ProviderAdapterClient` implementation (or a factory) from `@sentropic/llm-mesh`
   (or a sibling `@sentropic/llm-mesh-clients`) so radar deletes its copy and
   only configures keys + model shortlist.

2. **The model catalogue / shortlist.** `PROVIDER_META` (default model + model
   ids per provider) is hand-copied from sentropic's `catalog.ts`. **Ask:**
   re-export the catalogue (or a `defaultModelFor(providerId)` / model-shortlist
   helper) from the package entry so radar stops duplicating model ids that
   drift when the catalogue updates.

3. **Env-driven provider discovery.** `listConfiguredProviders(env)` /
   `apiKeyFor(providerId, env)` (read `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
   `MISTRAL_API_KEY`, `GEMINI_API_KEY`|`GOOGLE_API_KEY`, `COHERE_API_KEY`) is
   generic glue. **Ask:** expose an env-discovery helper from the package so the
   key-name → provider mapping is owned by the mesh, not each consumer.

A clean boundary lets radar's `semantic-extract.ts` and `mesh-runtime.ts` shrink
to: pick a provider from the published discovery helper, build a `GenerateRequest`,
call `mesh.generate()`. No HTTP, no catalogue copy, no key-name table.

## Neutrality + provenance invariants radar enforces (must survive any refactor)

- **No provider favoritism.** Provider selection is the first *configured*
  provider in neutral **alphabetical** order; no provider is hardcoded as a
  default. Any mesh-side helper radar adopts must preserve neutral selection.
- **Off-by-default, deterministic-first.** Semantic extraction is gated and
  returns `[]` on disable / mis-config / error — it never throws and never
  weakens the deterministic, anti-invention path (`mentions.ts`).
- **Provenance tagging.** Every semantic mention carries
  `provenance: { kind: "llm", provider, model }`; deterministic mentions carry
  none. A semantic mention is never silently mistaken for a parsed one.
