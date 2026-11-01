import { describe, expect, it } from "vitest";
import { validateSwMessage } from "./protocol.js";
import { uuid } from "../sync/test-support.js";
describe("closed worker protocol", () => {
  const hello = () => ({ protocol: 1, type: "HELLO", id: uuid(),
    payload: { clientBuildId: "N-1", tabId: uuid(), protocolVersion: 1 } });
  it("should accept versioned presence and payload-free ping/activation", () => {
    expect(validateSwMessage(hello(), "client")).toBe(true);
    for (const type of ["PING", "ACTIVATE_COMPATIBLE"]) expect(validateSwMessage({ protocol: 1, type, id: uuid() }, "client")).toBe(true);
  });
  it("should reject unknown versions/types, grants and extra business fields", () => {
    expect(validateSwMessage({ ...hello(), protocol: 2 }, "client")).toBe(false);
    expect(validateSwMessage({ ...hello(), type: "MCP" }, "client")).toBe(false);
    expect(validateSwMessage({ ...hello(), grant: "secret" }, "client")).toBe(false);
    for (const payload of [{ scope: "grant" }, { scope: "context", grant: "secret" }, { scope: "workspace", workspaceId: "bad" }]) {
      expect(validateSwMessage({ protocol: 1, type: "INVALIDATE", id: uuid(), payload }, "client")).toBe(false);
    }
  });
  it("should bound UTF-8 bytes and validate reply correlations", () => {
    expect(validateSwMessage({ ...hello(), id: "" }, "client")).toBe(false);
    expect(validateSwMessage({ ...hello(), correlationId: 4 }, "client")).toBe(false);
    expect(validateSwMessage({ ...hello(), padding: "é".repeat(8192) }, "client")).toBe(false);
    expect(validateSwMessage({ protocol: 1, type: "PONG", id: uuid(), correlationId: uuid(),
      payload: { workerBuildId: "N", protocolVersion: 1 } }, "worker")).toBe(true);
    expect(validateSwMessage(hello(), "worker")).toBe(false);
  });
});
