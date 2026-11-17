/**
 * One real call through the refresh mesh on a Muse seat (operator smoke test).
 * Env: REFRESH_PRINCIPAL_REF, REFRESH_OWNER_SCOPE_REF, SENTROPIC_LLM_MESH_KEYRING_DIR,
 * MUSE_SMOKE_MODEL (default muse-wonder-1.0, effort low). Prints no credential.
 */
import { EncryptedFileKeyring } from "@sentropic/llm-mesh-refresh/node";
import { MuseRuntimeClient } from "@sentropic/llm-mesh-refresh";
import { createRefreshMesh, refreshErrorDiagnostic } from "../services/graph/refresh-mesh.js";

const mask = (text: string) => text.replace(/[A-Za-z0-9_-]{24,}/g, "[masqué]").slice(0, 600);
const tracingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  if (process.env.MUSE_SMOKE_DEBUG === "1") {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    console.error(JSON.stringify({ trace: "muse-http", url, status: response.status, model: body["model"],
      bodyKeys: Object.keys(body), headerNames: Object.keys((init?.headers ?? {}) as Record<string, string>) }));
    if (!response.ok) console.error(JSON.stringify({ trace: "muse-body", text: mask(await response.clone().text()) }));
  }
  return response;
};

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const model = process.env.MUSE_SMOKE_MODEL?.trim() || "muse-wonder-1.0";
const controller = new AbortController();
const { textClient } = createRefreshMesh({
  routingSubject: { principalRef: required("REFRESH_PRINCIPAL_REF"), ownerScopeRef: required("REFRESH_OWNER_SCOPE_REF") },
  configResolver: { async resolveConfig() { return {}; } },
  keyring: new EncryptedFileKeyring(required("SENTROPIC_LLM_MESH_KEYRING_DIR")),
  maximumAttempts: 1,
  provider: "muse",
  model,
  reasoning: { effort: "low" },
  signal: controller.signal,
  museClient: new MuseRuntimeClient({ fetch: tracingFetch }),
});
const started = Date.now();
try {
  const out = await textClient.generateJson({
    schema: '{"ok": boolean, "city": string}',
    prompt: 'Réponds {"ok": true, "city": "Montréal"}.',
    validateResponse: (text: string) => { JSON.parse(text); },
  } as never);
  console.log(JSON.stringify({ status: "ok", model, provider: (out as { provider?: string }).provider, ms: Date.now() - started }));
} catch (error) {
  const message = error instanceof Error ? error.message.replace(/[A-Za-z0-9_-]{24,}/g, "[masqué]").slice(0, 300) : "";
  console.log(JSON.stringify({ status: "failed", model, ms: Date.now() - started, message, ...refreshErrorDiagnostic(error) }));
  process.exitCode = 1;
}
