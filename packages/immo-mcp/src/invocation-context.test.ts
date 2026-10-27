import { describe, expect, it } from "vitest";
import { MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import {
  captureInvocationContext,
  getInvocationContext,
  runWithInvocationContext,
} from "./invocation-context.js";
import {
  ALL_TOOL_DEFINITIONS,
  TOOL_SCOPE_BY_NAME,
} from "./tool-definitions.js";
import { TOOL_HANDLERS } from "./tool-handlers.js";
import { ALL_TOOL_NAMES, V0_TOOL_NAMES, RAW_TOOL_NAMES } from "./tools.js";

function seeds(sub: string, token: string | undefined, scopes: string[]) {
  const base = {
    sub,
    userId: sub,
    tenantId: "radar",
    roles: ["viewer"],
    scopes,
    workspaces: ["default"],
    dataMode: "simulation" as const,
    audience: "mcp/immo",
  };
  return {
    auth: token === undefined ? base : { ...base, accessToken: token },
    data: new MockDataSource(),
    raw: new MockRawDataSource(),
  };
}

describe("invocation context (P4 private boundary)", () => {
  it("freezes the captured snapshot against later rebinding", () => {
    const seed = seeds("user-1", "credential-1", ["immo:read", "immo:search"]);
    const ctx = captureInvocationContext(seed);
    seed.auth.scopes.push("immo:admin");
    seed.auth.sub = "user-2";
    seed.auth.roles.push("admin");
    seed.auth.workspaces.push("other");
    expect(ctx.auth.sub).toBe("user-1");
    expect(ctx.auth.scopes).toEqual(["immo:read", "immo:search"]);
    expect(ctx.egress).toMatchObject({ bearer: undefined, sub: "user-1" });
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.auth)).toBe(true);
    expect(Object.isFrozen(ctx.egress)).toBe(true);
    expect(Object.isFrozen(ctx.egress.scopes)).toBe(true);
    expect(Object.isFrozen(ctx.auth.scopes)).toBe(true);
    expect(Object.isFrozen(ctx.auth.roles)).toBe(true);
    expect(Object.isFrozen(ctx.auth.workspaces)).toBe(true);
    expect(ctx.auth.roles).toEqual(["viewer"]);
    expect(ctx.auth.workspaces).toEqual(["default"]);
    expect(() => (ctx.egress.scopes as string[]).push("immo:admin")).toThrow(TypeError);
  });

  it("isolates concurrent invocations without swapping identity or credential", async () => {
    const ctxA = captureInvocationContext(seeds("user-a", "credential-a", ["immo:read"]));
    const ctxB = captureInvocationContext(seeds("user-b", "credential-b", ["immo:read"]));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: string[] = [];
    const [idA, idB] = await Promise.all([
      runWithInvocationContext(ctxA, async () => {
        await gate;
        const current = getInvocationContext();
        seen.push(`A:${current?.auth.sub}:${String(current?.egress.bearer)}`);
        return "a";
      }),
      runWithInvocationContext(ctxB, async () => {
        const current = getInvocationContext();
        seen.push(`B:${current?.auth.sub}:${String(current?.egress.bearer)}`);
        release();
        return "b";
      }),
    ]);
    expect([idA, idB].sort()).toEqual(["a", "b"]);
    expect(seen).toContain("A:user-a:undefined");
    expect(seen).toContain("B:user-b:undefined");
  });

  it("keeps one contract source: definitions, handlers and registrar agree", () => {
    expect(ALL_TOOL_DEFINITIONS.map((def) => def.name).sort()).toEqual(
      [...ALL_TOOL_NAMES].sort(),
    );
    expect(Object.keys(TOOL_HANDLERS).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    expect([...V0_TOOL_NAMES, ...RAW_TOOL_NAMES].sort()).toEqual(
      [...ALL_TOOL_NAMES].sort(),
    );
    for (const def of ALL_TOOL_DEFINITIONS) {
      expect(TOOL_SCOPE_BY_NAME[def.name]).toBe(def.scope);
    }
  });
});
