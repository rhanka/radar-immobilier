import { describe, expect, it } from "vitest";
import { SuccessorSearchSignalsInputSchema } from "../../../packages/immo-mcp/src/status/successor-schemas.js";
import { MCP_SIGNAL_SEARCH_PATH, decodeMcpSignalSearch } from "../../src/routes/mcp-signal-search.js";
import { SUCCESSOR_SEARCH_ENDPOINT } from "../../../packages/immo-mcp/src/status/successor-contract.js";

describe("API contract against inert S0", () => {
  it("reserves the same GET endpoint without importing MCP into API runtime", () => {
    expect(SUCCESSOR_SEARCH_ENDPOINT).toMatchObject({ method: "GET", path: MCP_SIGNAL_SEARCH_PATH });
  });
  it.each([
    { city: "quebec" },
    { city: "saint-stanislas--des-chenaux" },
    { city: "salaberry-de-valleyfield", etape: "adoption", query: "zone", limit: 100, showDiscarded: true },
    { city: "quebec", workspaceId: "12345678-1234-4234-9234-123456789abc", limit: 1, showDiscarded: false },
  ])("preserves S0 normalized search arguments %j", (input) => {
    const s0 = SuccessorSearchSignalsInputSchema.parse(input);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      params.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
    }
    expect(decodeMcpSignalSearch(params)).toEqual({ ...s0, showDiscarded: s0.showDiscarded ?? false });
  });
  it.each([0, 101, 1.5])("rejects the same out-of-bounds limit %s", (limit) => {
    expect(SuccessorSearchSignalsInputSchema.safeParse({ city: "quebec", limit }).success).toBe(false);
    expect(() => decodeMcpSignalSearch(new URLSearchParams({ city: "quebec", limit: String(limit) }))).toThrow();
  });
});
