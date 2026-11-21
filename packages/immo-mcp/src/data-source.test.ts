import { describe, expect, it } from "vitest";
import {
  createDataSource,
  HttpDataSource,
  MockDataSource,
} from "./data-source.js";
import { captureInvocationContext } from "./invocation-context.js";
import { MockRawDataSource } from "./raw-data.js";
import { signalSearchBody, signalSearchItem, SIGNAL_TEST_WORKSPACE } from "./signal-search-test-fixture.js";
import { invokeTool } from "./tools.js";

const BASE = "http://radar-api:3000";


describe("createDataSource", () => {
  it("defaults to mock without RADAR_API_BASE_URL and to http with it", () => {
    expect(createDataSource({}).mode).toBe("mock");
    expect(createDataSource({ RADAR_API_BASE_URL: BASE }).mode).toBe("http");
  });
});

describe("MockDataSource.searchSignals (documents the bug)", () => {
  it("returns ZERO signals for a real city absent from the fixtures", async () => {
    // This is exactly the prod symptom: the remote MCP was pinned to the mock
    // source, so mont-tremblant/rosemere/sainte-catherine all came back count 0.
    const mock = new MockDataSource();
    const out = await mock.searchSignals({ city: "mont-tremblant", limit: 20 });
    expect(out.signals).toHaveLength(0);
    expect(out.workspaceId).toBeUndefined();
  });

  it("still serves its demo cities (no regression)", async () => {
    const mock = new MockDataSource();
    const out = await mock.searchSignals({ city: "longueuil", limit: 20 });
    expect(out.signals.length).toBeGreaterThan(0);
    expect(out.workspaceId).toBeUndefined();
  });
});

describe("search_signals workspaceId passthrough (EVO-5)", () => {
  it("exposes the API-resolved workspaceId in live mode and omits it in fixture mode", async () => {
    const signal = signalSearchItem("longueuil");
    const httpData = new HttpDataSource({
      baseUrl: BASE,
      fetchImpl: async () => Response.json(signalSearchBody("longueuil", [signal], SIGNAL_TEST_WORKSPACE)),
    });
    const direct = await httpData.searchSignals({ city: "longueuil", limit: 10 });
    expect(direct).toEqual({ signals: [signal], workspaceId: SIGNAL_TEST_WORKSPACE });

    const auth = {
      sub: "user-1",
      userId: "user-1",
      tenantId: "radar",
      roles: ["viewer"],
      scopes: ["immo:read", "immo:search"],
      workspaces: [SIGNAL_TEST_WORKSPACE],
      dataMode: "real" as const,
      audience: "mcp/immo",
    };
    const liveCtx = captureInvocationContext({ auth, data: httpData, raw: new MockRawDataSource() });
    const liveResult = await invokeTool("search_signals", { city: "longueuil", limit: 10 }, liveCtx);
    const livePayload = JSON.parse(liveResult.content[0]!.text) as Record<string, unknown>;
    expect(livePayload).toMatchObject({
      source: "live",
      workspaceId: SIGNAL_TEST_WORKSPACE,
      city: "longueuil",
      count: 1,
      signals: [signal],
    });

    const mockCtx = captureInvocationContext({
      auth: { ...auth, dataMode: "simulation" as const },
      data: new MockDataSource(),
      raw: new MockRawDataSource(),
    });
    const mockResult = await invokeTool("search_signals", { city: "longueuil", limit: 10 }, mockCtx);
    const mockPayload = JSON.parse(mockResult.content[0]!.text) as Record<string, unknown>;
    expect(mockPayload.source).toBe("fixture");
    expect(mockPayload).not.toHaveProperty("workspaceId");
  });
});
