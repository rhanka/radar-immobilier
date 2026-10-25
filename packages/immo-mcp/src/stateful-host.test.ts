import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { StatefulMcpHooks, VerifiedMcpRequest } from "@sentropic/cluster-mesh/compose/mcp-stateful";
import { ImmoStatefulHost } from "./stateful-host.js";

const authority: VerifiedMcpRequest = {
  principal: { issuer: "synthetic", sub: "alice", scopes: ["immo:read"], claims: [], attributes: {} },
  resource: "synthetic:mcp", correlationId: "test", signal: new AbortController().signal,
};
const hooks = (register = vi.fn()): StatefulMcpHooks => ({
  maxRequestBytes: 32, register, run: async (_auth, next) => next(),
});
const server = () => new Server({ name: "test", version: "1" });

describe("P6 stateful admission", () => {
  it("should deny effects before binding and register retained and future servers once", async () => {
    const app = new Hono();
    const host = new ImmoStatefulHost(app);
    const effect = vi.fn(async () => 1);
    await expect(host.run(authority, effect)).rejects.toThrow("composition_unavailable");
    expect(effect).not.toHaveBeenCalled();
    const retained = server();
    host.retain(retained);
    const bridge = vi.fn();
    expect(await host.bind(hooks(bridge))).toBe(app);
    expect(bridge).toHaveBeenCalledExactlyOnceWith(retained);
    const future = server();
    host.retain(future);
    expect(bridge).toHaveBeenCalledTimes(2);
    expect(await host.run(authority, effect)).toBe(1);
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("should retain closed admission after partial binding fails", async () => {
    const host = new ImmoStatefulHost(new Hono());
    const a = server(); const b = server();
    host.retain(a); host.retain(b);
    const install = vi.fn((s) => { if (s === b) throw new Error("binding_failure"); });
    await expect(host.bind(hooks(install))).rejects.toThrow("binding_failure");
    expect(install).toHaveBeenCalledTimes(2);
    const effect = vi.fn(async () => 1);
    await expect(host.run(authority, effect)).rejects.toThrow("composition_unavailable");
    await expect(host.bind(hooks())).rejects.toThrow("composition_already_attempted");
    await expect(host.run(authority, effect)).rejects.toThrow("composition_unavailable");
    expect(effect).not.toHaveBeenCalled();
  });

  it("should close all admission if a future server cannot install its bridge", async () => {
    const host = new ImmoStatefulHost(new Hono());
    await host.bind(hooks(vi.fn(() => { throw new Error("future_failure"); })));
    expect(() => host.retain(server())).toThrow("future_failure");
    await expect(host.run(authority, async () => 1)).rejects.toThrow("composition_unavailable");
  });

  it("should bound the entire streamed JSON-RPC body before parsing", async () => {
    const host = new ImmoStatefulHost(new Hono());
    await host.bind(hooks());
    const input = new Request("https://synthetic/mcp", { method: "POST", body: "x".repeat(33) });
    await expect(host.boundRequest(input)).rejects.toThrow("request_too_large");
    const accepted = await host.boundRequest(new Request("https://synthetic/mcp", { method: "POST", body: "x".repeat(32) }));
    expect(await accepted.text()).toHaveLength(32);
  });
});
