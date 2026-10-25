import { describe, expect, it } from "vitest";
import { statusAuthorityDenial, type StatusAuthority } from "./authority-contract.js";

const accountId = "11111111-2222-4333-8444-555555555555";
const workspaceId = "22222222-3333-4444-8555-666666666666";
const state: StatusAuthority = { credentialVerified: true, humanSub: "synthetic-oidc", resolvedSub: "synthetic-oidc",
  accountId, accountApproved: true, workspaceId, membership: { accountId, workspaceId, active: true },
  signalEpochServed: true, lotDestinationEnabled: true, lotDestinationOpen: true };

describe("D4 authority and public opening contract", () => {
  it("should resolve verified subject, approved account and active workspace membership in that order", () => {
    expect(statusAuthorityDenial(state, "lot")).toBeNull();
    expect(statusAuthorityDenial({ ...state, credentialVerified: false, accountApproved: false }, "context"))
      .toBe("unauthenticated");
    expect(statusAuthorityDenial({ ...state, resolvedSub: "other" }, "lot")).toBe("unauthenticated");
    expect(statusAuthorityDenial({ ...state, accountApproved: false }, "lot")).toBe("account_not_approved");
    for (const membership of [{ ...state.membership, active: false }, { ...state.membership, accountId: workspaceId },
      { ...state.membership, workspaceId: accountId }]) {
      expect(statusAuthorityDenial({ ...state, membership }, "lot")).toBe("workspace_not_authorized");
    }
    expect(statusAuthorityDenial({ ...state, workspaceId: "radar" }, "lot")).toBe("workspace_not_authorized");
  });

  it("should require durable 6K opening in addition to configured enablement and 6H availability", () => {
    for (const key of ["signalEpochServed", "lotDestinationEnabled", "lotDestinationOpen"] as const) {
      expect(statusAuthorityDenial({ ...state, [key]: false }, "lot")).toBe("business_closed");
    }
    expect(statusAuthorityDenial({ ...state, signalEpochServed: false }, "signal")).toBe("business_closed");
    expect(statusAuthorityDenial({ ...state, lotDestinationOpen: false }, "signal")).toBeNull();
    expect(statusAuthorityDenial({ ...state, signalEpochServed: false, lotDestinationOpen: false }, "context"))
      .toBeNull();
  });
});
