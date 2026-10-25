import { describe, expect, it } from "vitest";
import {
  createDataSource,
  MockDataSource,
} from "./data-source.js";

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
    expect(out).toHaveLength(0);
  });

  it("still serves its demo cities (no regression)", async () => {
    const mock = new MockDataSource();
    const out = await mock.searchSignals({ city: "longueuil", limit: 20 });
    expect(out.length).toBeGreaterThan(0);
  });
});
