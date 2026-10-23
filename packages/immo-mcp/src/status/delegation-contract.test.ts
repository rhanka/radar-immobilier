import { describe, expect, it } from "vitest";
import { canAuthorizeWrite, delegationCacheKey, validateDelegationProfile,
  type DelegationPolicy, type DelegationProfile } from "./delegation-contract.js";

const now = "2026-10-23T00:00:00Z";
const base: DelegationProfile = {
  issuer: "https://issuer.example", audience: "api-synthetic", humanSub: "synthetic-user",
  workloadActor: "mcp-workload", workloadClient: "mcp-client", expiresAt: "2026-10-23T00:01:00Z",
  operationProfile: "facet-interact.v1", invocationScopes: ["immo:read"],
  routes: [{ method: "POST", path: "/api/v1/mcp/facets/lots/command",
    inputContract: "command_lot_facet.v1", schemaDigest: "a".repeat(64) }],
  policyRevision: "p1", environment: "synthetic",
};
const policy: DelegationPolicy = { ...base, maxLifetimeSeconds: 120,
  requiredInvocationScopes: ["immo:read"], allowedInvocationScopes: ["immo:read"],
  permitsWrites: true, issuerEnforced: true, receiverVerified: true };

describe("delegation A contract", () => {
  it("should require the issuer discriminator and receiver verification beyond immo:read", () => {
    expect(validateDelegationProfile(base, now, policy)).toBeNull();
    expect(canAuthorizeWrite(["immo:read"], now, policy)).toBe(false);
    expect(canAuthorizeWrite(["immo:facets:write"], now, policy)).toBe(false);
    expect(canAuthorizeWrite(base, now, policy)).toBe(true);
    expect(canAuthorizeWrite(base, now, { ...policy, permitsWrites: false })).toBe(false);
    for (const proof of ["issuerEnforced", "receiverVerified"] as const) {
      expect(canAuthorizeWrite(base, now, { ...policy, [proof]: false })).toBe(false);
    }
    expect(validateDelegationProfile(null, now, policy)).toBe("delegation_missing");
  });

  it.each(["issuer", "humanSub", "audience", "workloadActor", "workloadClient",
    "operationProfile", "policyRevision", "environment"] as const)(
    "should refuse a changed %s", (field) => {
      expect(validateDelegationProfile({ ...base, [field]: "other" }, now, policy)).not.toBeNull();
    });

  it("should reject expired, long-lived and offset-expired profiles using numeric time", () => {
    for (const expiresAt of [now, "2026-10-22T23:30:00Z", "2026-10-23T01:00:00+02:00",
      "2030-01-01T00:00:00Z", "invalid"]) {
      expect(validateDelegationProfile({ ...base, expiresAt }, now, policy)).toBe("profile_expired");
    }
    expect(validateDelegationProfile(base, "invalid", policy)).toBe("profile_expired");
  });

  it.each(["/api/graph-signals/paris", "/api/v1/mcp/facets-evil/write",
    "/api/v1/mcp/facets/lots/unknown", "/api/v1/mcp/facets/lots/../command",
    "/api/v1/mcp/facets/lots/%63ommand"])("should refuse broadened route %s", (path) => {
    expect(validateDelegationProfile({ ...base, routes: [{ ...base.routes[0]!, path }] }, now, policy))
      .toBe("delegation_broadened");
  });

  it("should bind exact methods, contract schemas and invocation scopes", () => {
    for (const patch of [{ method: "GET" }, { inputContract: "unknown" }, { schemaDigest: "b".repeat(64) }]) {
      expect(validateDelegationProfile({ ...base, routes: [{ ...base.routes[0]!, ...patch }] }, now, policy))
        .toBe("delegation_broadened");
    }
    expect(validateDelegationProfile({ ...base, invocationScopes: ["immo:search"] }, now, policy))
      .toBe("insufficient_scope");
    expect(validateDelegationProfile({ ...base, invocationScopes: ["immo:read", "admin"] }, now, policy))
      .toBe("delegation_broadened");
    expect(validateDelegationProfile({ ...base, actor: "forged" }, now, policy)).toBe("delegation_forged");
  });

  it("should separate cache dimensions without separator collisions", () => {
    const key = { humanSub: "u", credentialId: "c", workloadActor: "w", workloadClient: "client",
      operationProfile: "p", environment: "synthetic", policyRevision: "r" };
    for (const field of Object.keys(key) as (keyof typeof key)[]) {
      expect(delegationCacheKey({ ...key, [field]: "other" })).not.toBe(delegationCacheKey(key));
    }
    expect(delegationCacheKey({ ...key, humanSub: "u|c", credentialId: "w" }))
      .not.toBe(delegationCacheKey({ ...key, humanSub: "u", credentialId: "c|w" }));
  });
});
