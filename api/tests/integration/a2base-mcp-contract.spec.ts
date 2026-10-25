import { describe, expect, it } from "vitest";
import { MCP_SIGNAL_SEARCH_PATH, McpSignalSearchResponse } from "../../src/routes/mcp-signal-search.js";
import { STRICT_RECEIVER_POLICY_REVISION } from "../../src/config.js";
import { EXCHANGE_DEFAULT_POLICY_REVISION } from "../../../packages/immo-mcp/src/exchange-config.js";
import { SIGNAL_SEARCH_PATH, parseSignalSearchResponse } from "../../../packages/immo-mcp/src/signal-search-response.js";
import { signalSearchBody, signalSearchItem } from "../../../packages/immo-mcp/src/signal-search-test-fixture.js";

describe("T10/T12 contract parity without runtime cross-workspace imports", () => {
  it("pins API/MCP route, response fields and exchange receipt policy together", () => {
    expect(SIGNAL_SEARCH_PATH).toBe(MCP_SIGNAL_SEARCH_PATH);
    expect(EXCHANGE_DEFAULT_POLICY_REVISION).toBe(STRICT_RECEIVER_POLICY_REVISION);
    const body = signalSearchBody("quebec", [signalSearchItem("quebec")]);
    expect(McpSignalSearchResponse.parse(body)).toEqual(body);
    expect(parseSignalSearchResponse(body, { city: "quebec", limit: 20 })).toEqual(body.signals);
  });
});
