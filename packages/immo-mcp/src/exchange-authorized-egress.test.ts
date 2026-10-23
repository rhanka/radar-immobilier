import { describe, expect, it } from "vitest";
import { MockDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { captureInvocationContext } from "./invocation-context.js";
import {
  bindExchangeInput,
  buildExchangeInput,
  getExchangeDeps,
  resolveExchangedCallContext,
  runWithExchangeDeps,
  runWithHttpTransport,
} from "./authorized-egress.js";
import {
  createIsolatedExchangeFixture,
  exchangeDepsFor,
  signSubjectToken,
  TEST_SCOPES,
} from "./test-exchange-fixtures.js";

function seeds(scopes: string[]) {
  return {
    auth: {
      sub: "user-1",
      userId: "user-1",
      tenantId: "radar",
      roles: ["viewer"],
      scopes,
      workspaces: ["default"],
      dataMode: "simulation" as const,
      audience: "mcp/immo",
    },
    data: new MockDataSource(),
    raw: new MockRawDataSource(),
  };
}

describe("resolveExchangedCallContext", () => {
  it("returns empty for tools other than search_signals and performs zero exchange", async () => {
    const fixture = await createIsolatedExchangeFixture();
    const ctx = captureInvocationContext(seeds(TEST_SCOPES.split(" ")));
    let calls = 0;
    const deps = exchangeDepsFor(fixture, {
      fetchImpl: (async () => { calls += 1; throw new Error("must not exchange"); }) as unknown as typeof fetch,
    });
    const out = await runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_lots"));
    expect(out).toEqual({});
    expect(calls).toBe(0);
  });

  it("throws before any exchange when immo:search is missing", async () => {
    const fixture = await createIsolatedExchangeFixture();
    const ctx = captureInvocationContext(seeds(["immo:read"]));
    bindExchangeInput(ctx, buildExchangeInput({
      subjectToken: "subject-1",
      subjectSub: "user-1",
      subjectExp: Math.floor(Date.now() / 1000) + 300,
      subjectScopes: ["immo:read"],
      issuer: fixture.config.issuer,
      membership: "radar:default",
    }));
    let calls = 0;
    const deps = exchangeDepsFor(fixture, {
      fetchImpl: (async () => { calls += 1; throw new Error("must not exchange"); }) as unknown as typeof fetch,
    });
    await expect(runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_signals"))).rejects.toThrow(/scope_denied/);
    expect(calls).toBe(0);
  });

  it("fails closed without runtime and refuses proof-bound subjects", async () => {
    const fixture = await createIsolatedExchangeFixture();
    const subject = await signSubjectToken(fixture.subjectPrivateKey);
    const ctx = captureInvocationContext(seeds(TEST_SCOPES.split(" ")));
    bindExchangeInput(ctx, buildExchangeInput({
      subjectToken: subject,
      subjectSub: "user-1",
      subjectExp: Math.floor(Date.now() / 1000) + 300,
      subjectScopes: TEST_SCOPES.split(" "),
      issuer: fixture.config.issuer,
      membership: "radar:default",
    }));
    await expect(resolveExchangedCallContext(ctx, "search_signals")).rejects.toThrow(/exchange_not_configured/);
    const deps = exchangeDepsFor(fixture);
    bindExchangeInput(ctx, buildExchangeInput({
      subjectToken: subject,
      subjectSub: "user-1",
      subjectExp: Math.floor(Date.now() / 1000) + 300,
      subjectScopes: TEST_SCOPES.split(" "),
      issuer: fixture.config.issuer,
      membership: "radar:default",
      confirmation: "cnf",
    }));
    await expect(runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_signals"))).rejects.toThrow(/exchange_proof_binding_refused/);
    expect(getExchangeDeps()).toBeUndefined();
  });

  it("refuses HTTP search without bound authority and keeps stdio synthetic", async () => {
    const fixture = await createIsolatedExchangeFixture();
    const ctx = captureInvocationContext(seeds(TEST_SCOPES.split(" ")));
    const deps = exchangeDepsFor(fixture);
    await expect(runWithHttpTransport(() => runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_signals")))).rejects.toThrow(/exchange_missing_authority/);
    await expect(runWithHttpTransport(() => resolveExchangedCallContext(ctx, "search_signals"))).rejects.toThrow(/exchange_missing_authority/);
    await expect(runWithExchangeDeps(deps, () => resolveExchangedCallContext(ctx, "search_signals"))).rejects.toThrow(/exchange_missing_authority/);
    expect(fixture.issuedExchangedTokens).toHaveLength(0);
    const synthetic = await resolveExchangedCallContext(ctx, "search_signals");
    expect(synthetic).toEqual({});
  });

  it("exchanges once per subject and caches within the deadline", async () => {
    const fixture = await createIsolatedExchangeFixture();
    const subject = await signSubjectToken(fixture.subjectPrivateKey, { jti: "s-1" });
    const ctx = captureInvocationContext(seeds(TEST_SCOPES.split(" ")));
    bindExchangeInput(ctx, buildExchangeInput({
      subjectToken: subject,
      subjectSub: "user-1",
      subjectExp: Math.floor(Date.now() / 1000) + 300,
      subjectScopes: TEST_SCOPES.split(" "),
      subjectJti: "s-1",
      issuer: fixture.config.issuer,
      membership: "radar:default",
    }));
    let calls = 0;
    const counting = exchangeDepsFor(fixture, {
      fetchImpl: (async (input: unknown, init?: RequestInit) => {
        calls += 1;
        return fixture.fetchImpl(input as never, init);
      }) as unknown as typeof fetch,
    });
    const first = await runWithExchangeDeps(counting, () => resolveExchangedCallContext(ctx, "search_signals"));
    const second = await runWithExchangeDeps(counting, () => resolveExchangedCallContext(ctx, "search_signals"));
    expect(first.accessToken).toBeTruthy();
    expect(second.accessToken).toBe(first.accessToken);
    expect(first.accessToken).not.toBe(subject);
    expect(calls).toBe(1);
  });
});
