import { afterEach, expect, it, vi } from "vitest";
import { FakeGraphStore } from "../services/graph/canonical-graph-store.fixture.js";
import type { RunPvRefreshOptions } from "../services/graph/refresh-run.js";

const f = vi.hoisted(() => ({ calls: [] as string[], modes: [] as boolean[],
  info: vi.fn(), end: vi.fn(), store: undefined as unknown }));
vi.mock("../config.js", () => ({ loadConfig: () => ({ LOG_LEVEL: "silent" }) }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info: f.info, warn: vi.fn() }) }));
vi.mock("../db/client.js", () => ({ createDb: () => ({ db: {}, pool: { end: f.end } }) }));
vi.mock("../storage/s3-object-store.js", () => ({ getScrapeObjectStore: () => f.store }));
vi.mock("@sentropic/llm-mesh-refresh/node", () => ({ EncryptedFileKeyring: class {} }));
vi.mock("../services/sources/live-scrape.js", () => ({ configOnlyCitySlugs: () => ["a", "b"] }));
vi.mock("../services/graph/refresh-profile.js", () => ({ loadRefreshProfileContext: () => ({
  profile: { profile_hash: "profile" }, registryExtraction: {} }) }));
vi.mock("../services/graph/refresh-mesh.js", () => ({ refreshErrorDiagnostic: () => ({}),
  createRefreshMesh: (model: { provider: string; model: string }) => ({ textClient: {
    mode: "mesh", ...model, async generateJson(input: { validateResponse?: (text: string) => void }) {
      f.calls.push(model.model);
      if (model.provider === "openai") throw new TypeError("fetch failed");
      await input.validateResponse?.('{"nodes":[{"id":"act"}]}');
      return { status: "completed", mode: "mesh", ...model, audit: {} };
    },
  } }) }));
vi.mock("../services/graph/refresh-run.js", async (original) => ({
  ...await original<typeof import("../services/graph/refresh-run.js")>(),
  runPvRefresh: async (options: RunPvRefreshOptions) => {
    f.modes.push(options.extract!);
    expect(options.classification).toBeUndefined();
    if (!options.extract) return { status: "deferred" };
    let rendered = "";
    await options.documentModels!.forDocument("doc", async (receipt) => {
      options.onModelReceipt?.("doc", "chunk", receipt);
    }).generateJson({ prompt: "unchanged detection B", schema: "{}", maxOutputTokens: 32_768,
      validateResponse: (text) => { rendered = text; } });
    await (f.store as FakeGraphStore).put("rendered.json", rendered);
    return { status: "published" };
  },
}));

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each([undefined, "off"])("should preserve main fallback, sweep stops and output with mode %s", async (mode) => {
  vi.clearAllMocks();
  f.calls = []; f.modes = []; f.store = new FakeGraphStore();
  const env = { REFRESH_CLASSIFY_MODE: mode, REFRESH_SINGLE_PASS: "0",
    REFRESH_PROVIDER: "openai", REFRESH_MODEL: "gpt-6-astra", REFRESH_REASONING_EFFORT: "medium",
    REFRESH_FALLBACK_PROVIDER: "gemini", REFRESH_FALLBACK_MODEL: "gemini-3.8-flash",
    REFRESH_FALLBACK_REASONING_EFFORT: "low", REFRESH_PRINCIPAL_REF: "test",
    REFRESH_OWNER_SCOPE_REF: "test", SENTROPIC_LLM_MESH_KEYRING_DIR: "/unused",
    REFRESH_SWEEP_MAX_SUBMISSIONS: "1", REFRESH_RUN_MAX_TOKENS: "invalid-ignored-at-off",
    REFRESH_TIMEOUT_MS: "1000", REFRESH_VERIFY_ENABLED: "0", REFRESH_FORCE_FALLBACK: "0",
    REFRESH_SAVED_PDF_PATH: "", REFRESH_OPS_TARGET: "" };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "test", "--all"]);
  const before = { SIGTERM: process.listeners("SIGTERM"), SIGINT: process.listeners("SIGINT") };
  try {
    const { main } = await import("./refresh-pv.js");
    await main();
    expect(f.calls).toEqual(["gpt-6-astra", "gemini-3.8-flash"]);
    expect(f.modes).toEqual([true, false]);
    expect(new TextDecoder().decode(await (f.store as FakeGraphStore).get("rendered.json")))
      .toBe('{"nodes":[{"id":"act"}]}');
    expect(f.info).toHaveBeenCalledWith(expect.objectContaining({ submissions: 2,
      extractionHaltedBy: "submission-budget", stoppedBy: "exhausted" }), "refresh-pv: sweep completed");
    expect(f.end).toHaveBeenCalledOnce();
  } finally {
    for (const name of ["SIGTERM", "SIGINT"] as const) {
      for (const listener of process.listeners(name)) if (!before[name].includes(listener)) process.removeListener(name, listener);
    }
  }
});
