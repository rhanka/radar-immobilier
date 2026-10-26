import { describe, expect, it } from "vitest";
import { EXCHANGE_DEFAULT_POLICY_REVISION, loadExchangeConfig } from "./exchange-config.js";

describe("scoped search exchange policy", () => {
  const config = { IMMO_MCP_EXCHANGE_ISSUER: "https://auth.test.local",
    IMMO_MCP_API_AUDIENCE: "https://api.test.local", IMMO_MCP_OAUTH_RESOURCE: "https://api.test.local/mcp",
    IMMO_MCP_WORKLOAD_SUB: "synthetic-workload", IMMO_MCP_WORKLOAD_CLIENT_ID: "synthetic-workload" };
  it("pins a fresh cache policy and refuses an explicitly stale deployment value", () => {
    expect(loadExchangeConfig(config)?.policyRevision).toBe(EXCHANGE_DEFAULT_POLICY_REVISION);
    expect(() => loadExchangeConfig({ ...config, IMMO_MCP_EXCHANGE_POLICY_REV: "p4-v1" }))
      .toThrow("exchange_policy_revision_refused");
  });
});
