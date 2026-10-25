import { afterEach, describe, expect, it, vi } from "vitest";
import { bindExchangeInput, buildExchangeInput, resolveExchangedCallContext, runWithExchangeDeps } from "./authorized-egress.js";
import { captureInvocationContext } from "./invocation-context.js";
import { HttpDataSource, MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { TOOL_HANDLERS } from "./tool-handlers.js";
import { createIsolatedExchangeFixture, exchangeDepsFor, signSubjectToken, TEST_SCOPES } from "./test-exchange-fixtures.js";

afterEach(() => vi.useRealTimers());

async function rig() {
  vi.useFakeTimers({ toFake: ["Date"] });
  const now = Math.floor(Date.now() / 1000) * 1000;
  vi.setSystemTime(now);
  const fixture = await createIsolatedExchangeFixture();
  const subject = await signSubjectToken(fixture.subjectPrivateKey, { jti: "same-jti" });
  let outage = false;
  let exchanges = 0;
  const deps = exchangeDepsFor(fixture, { fetchImpl: async (input, init) => {
    exchanges++;
    if (outage) throw new Error("issuer unavailable");
    return fixture.fetchImpl(input, init);
  } });
  const data = new MockDataSource();
  function context(token = subject) {
    const ctx = captureInvocationContext({ data, raw: new MockRawDataSource(), auth: {
      sub: "user-1", userId: "user-1", tenantId: "radar", roles: ["viewer"],
      scopes: TEST_SCOPES.split(" "), workspaces: ["default"], dataMode: "simulation", audience: fixture.config.mcpResource,
    } });
    bindExchangeInput(ctx, buildExchangeInput({ subjectToken: token, subjectSub: "user-1",
      subjectExp: now / 1000 + 300, subjectScopes: TEST_SCOPES.split(" "), subjectJti: "same-jti",
      issuer: fixture.config.issuer, membership: "radar:default" }));
    return ctx;
  }
  const ctx = context();
  return { fixture, deps, ctx, context, now, subject, calls: () => exchanges,
    outage: () => { outage = true; },
    resolve: () => runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_signals")),
  };
}

describe("delegation outage and invalidation", () => {
  it("fails cold, reuses only a fresh warm entry, and fails at the effective deadline", async () => {
    const cold = await rig();
    cold.outage();
    await expect(cold.resolve()).rejects.toThrow();
    expect(cold.calls()).toBe(1);
    const warm = await rig();
    const first = await warm.resolve();
    warm.outage();
    vi.setSystemTime(warm.now + 54_999);
    expect((await warm.resolve()).accessToken).toBe(first.accessToken);
    expect(warm.calls()).toBe(1);
    vi.setSystemTime(warm.now + 55_000);
    await expect(warm.resolve()).rejects.toThrow();
    expect(warm.calls()).toBe(2);
  });

  it.each([401, 403])("invalidates downstream %s without retry or stale outage reuse", async (status) => {
    const r = await rig();
    let apiCalls = 0;
    const data = new HttpDataSource({ baseUrl: "https://api.example.test", fetchImpl: async () => {
      apiCalls++;
      return new Response("{}", { status });
    } });
    const ctx = Object.freeze({ ...r.ctx, data });
    bindExchangeInput(ctx, buildExchangeInput({ subjectToken: r.subject, subjectSub: "user-1",
      subjectExp: r.now / 1000 + 300, subjectScopes: TEST_SCOPES.split(" "),
      issuer: r.fixture.config.issuer, membership: "radar:default" }));
    const search = () => runWithExchangeDeps(r.deps, () => TOOL_HANDLERS.search_signals!({ city: "longueuil", limit: 1 }, ctx));
    await expect(search()).rejects.toMatchObject({ code: status === 401 ? "unauthenticated" : "forbidden" });
    r.outage();
    await expect(search()).rejects.toThrow(/exchange|issuer/);
    expect(r.calls()).toBe(2);
    expect(apiCalls).toBe(1);
  });

  it("separates distinct token bytes even when their issuer reuses a jti", async () => {
    const r = await rig();
    const first = await r.resolve();
    const token = await signSubjectToken(r.fixture.subjectPrivateKey, { jti: "same-jti", scope: "immo:read immo:search" });
    const ctx = r.context(token);
    const second = await runWithExchangeDeps(r.deps, () => resolveExchangedCallContext(ctx, "search_signals"));
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(r.calls()).toBe(2);
  });
});
