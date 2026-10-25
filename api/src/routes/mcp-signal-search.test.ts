import { describe, expect, it } from "vitest";
import { decodeMcpSignalSearch, McpSignalSearchResponse } from "./mcp-signal-search.js";

const workspace = "12345678-1234-4234-9234-123456789abc";
const decode = (query: string) => decodeMcpSignalSearch(new URLSearchParams(query));
describe("reserved MCP search GET contract", () => {
  it("defaults only the search controls and canonicalizes an explicit UUID", () => {
    expect(decode("city=quebec")).toEqual({ city: "quebec", showDiscarded: false, limit: 20 });
    expect(decode(`city=quebec&workspaceId=${workspace.toUpperCase()}&showDiscarded=1&limit=100`))
      .toEqual({ city: "quebec", workspaceId: workspace, showDiscarded: true, limit: 100 });
    expect(decode("city=quebec&showDiscarded=0&etape=&query=").showDiscarded).toBe(false);
    expect(decode("city=saint-stanislas--des-chenaux").city).toBe("saint-stanislas--des-chenaux");
  });
  it.each(["sub=x", "tenant=x", "roles=x", "unknown=x", "city=montreal",
    "limit=1&limit=2", "showDiscarded=0&showDiscarded=1", "query=a&query=b",
    "workspaceId=" + workspace + "&workspaceId=" + workspace, "constructor=x", "__proto__=x",
    "limit=0", "limit=101", "limit=1.5", "limit=1e1", "limit=+1", "limit=01", "limit=",
    "showDiscarded=true", "showDiscarded=false", "showDiscarded=", "showDiscarded=2"])(
    "rejects ambiguous or non-wire input %s", (suffix) => {
      expect(() => decode(`city=quebec&${suffix}`)).toThrow("invalid_signal_search");
    });
  it.each(["", "Quebec", "québec", "quebec/../x", "-quebec", "quebec-"])(
    "requires the normalized city slug %s", (city) => {
      expect(() => decode(`city=${encodeURIComponent(city)}`)).toThrow("invalid_signal_search");
    });
  it("rejects a malformed selector without a default destination", () => {
    expect(() => decode("city=quebec&workspaceId=default")).toThrow("workspace_malformed");
    expect(() => decode("city=quebec&workspaceId=")).toThrow("workspace_malformed");
  });
  it("reserves an explicit successful empty collection and rejects missing collections", () => {
    const result = { ok: true, citySlug: "quebec", workspaceId: workspace, signals: [] };
    expect(McpSignalSearchResponse.parse(result)).toEqual(result);
    expect(McpSignalSearchResponse.safeParse({ ...result, signals: undefined }).success).toBe(false);
    expect(McpSignalSearchResponse.safeParse({ ...result, nodes: [] }).success).toBe(false);
  });
});
