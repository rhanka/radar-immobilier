import { describe, expect, it } from "vitest";
import {
  BASKET_READ_SCOPE_ID,
  BASKET_SCOPE_VERSION,
  consentAllowsBaskets,
  consentScopeForReadOperation,
  readerConsentKey,
} from "./reader-consent.js";
import { isGateBOperation } from "./reader-operations.js";
import { BASKET_READER_PROFILE } from "./reader-storage.js";

/**
 * J1.2d/e wagon 6 (§0.4, §14.2): serving the named Gate-B ops widens the
 * baskets contract, so the scope version moves v1 → v2 and the reader
 * profile revision moves to basket-read-v3. Every existing reader
 * re-approves once; a v1 consent row no longer authorizes Gate B.
 */
describe("baskets scope v2 / profile basket-read-v3", () => {
  const gateB = ["signals.by-city.v1", "signals.coherent-city.v1", "documents.pv.v1"];

  it("should bump the scope version and the profile revision", () => {
    expect(BASKET_SCOPE_VERSION).toBe("v2");
    expect(BASKET_READER_PROFILE.policyRevision).toBe("basket-read-v3");
    expect(BASKET_READER_PROFILE.capabilities).toEqual(["signals.protected-read", "geo.read"]);
  });

  it("should put every new named op under baskets.read Gate B, never app.me.v1", () => {
    for (const op of gateB) {
      expect(consentScopeForReadOperation(op)).toBe(BASKET_READ_SCOPE_ID);
      expect(isGateBOperation(op)).toBe(true);
    }
    expect(consentScopeForReadOperation("app.me.v1")).toBeNull();
    expect(isGateBOperation("app.me.v1")).toBe(false);
  });

  it("should refuse a live v1 consent row and accept a live v2 row", () => {
    const base = { ...readerConsentKey("scope-1", "reader-alice", "artifact-1", BASKET_READ_SCOPE_ID),
      consentId: "00000000-0000-4000-8000-000000000001", grantedAt: "2026-11-05T00:00:00.000Z",
      grantedVia: "reader_screen" as const };
    expect(base.scopeVersion).toBe("v2");
    expect(consentAllowsBaskets(base)).toBe(true);
    expect(consentAllowsBaskets({ ...base, scopeVersion: "v1" })).toBe(false);
    expect(consentAllowsBaskets({ ...base, revokedAt: "2026-11-05T01:00:00.000Z", revokedBy: "self" })).toBe(false);
  });
});
