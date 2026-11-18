import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SESSION_MAX_LIFETIME_MS,
  createImmoHttpApp,
  signalWriteState,
  type ImmoHttpConfig,
} from "./server-http.js";

const config: ImmoHttpConfig = {
  issuer: "https://auth.test.local",
  resource: "https://immo.test.local/mcp",
  requiredScopes: ["immo:read"],
  scopesSupported: ["immo:read"],
  port: 0,
  dataMode: "simulation",
  sessionIdleTimeoutMs: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  sessionMaxLifetimeMs: DEFAULT_SESSION_MAX_LIFETIME_MS,
};

const savedFlag = process.env.IMMO_MCP_SIGNALS_WRITE_ENABLED;
afterEach(() => {
  if (savedFlag === undefined) delete process.env.IMMO_MCP_SIGNALS_WRITE_ENABLED;
  else process.env.IMMO_MCP_SIGNALS_WRITE_ENABLED = savedFlag;
});

describe("signal-write state endpoint", () => {
  it("derives the state from binding presence and the flag", () => {
    expect(signalWriteState({}, {})).toBe("disabled");
    expect(signalWriteState({}, { IMMO_MCP_SIGNALS_WRITE_ENABLED: "0" })).toBe("disabled");
    expect(signalWriteState({}, { IMMO_MCP_SIGNALS_WRITE_ENABLED: "1" })).toBe("read-only");
    expect(signalWriteState({ signals: { query: async () => ({ rows: [] }) } },
      { IMMO_MCP_SIGNALS_WRITE_ENABLED: "1" })).toBe("active");
  });

  it("answers unauthenticated with only the state enum", async () => {
    delete process.env.IMMO_MCP_SIGNALS_WRITE_ENABLED;
    const app = createImmoHttpApp(config, {});
    const response = await app.request("/mcp/.well-known/signal-write");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signalWrite: "disabled" });
  });

  it("reports read-only when the flag is on without a binding", async () => {
    process.env.IMMO_MCP_SIGNALS_WRITE_ENABLED = "1";
    const app = createImmoHttpApp(config, {});
    const response = await app.request("/mcp/.well-known/signal-write");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signalWrite: "read-only" });
  });

  it("reports active when a binding is wired", async () => {
    const app = createImmoHttpApp(config, { signals: { query: async () => ({ rows: [] }) } });
    const response = await app.request("/mcp/.well-known/signal-write");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signalWrite: "active" });
  });
});
