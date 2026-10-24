import { describe, expect, it } from "vitest";
import {
  assertStrictRecoveryEligible,
  isStrictArmingInvalid,
  isStrictReceiverEnforced,
  isStrictSearchRequest,
  isStrictWiringComplete,
  strictReceiverTestAuth,
  strictReceiverTestConfig,
  strictRequestPath,
} from "./strict-receiver.js";

describe("isStrictSearchRequest", () => {
  it("accepts a canonical per-city GET with an allowlisted query", () => {
    expect(isStrictSearchRequest("GET", "/api/graph-signals/drummondville", {})).toBe(true);
    expect(
      isStrictSearchRequest("GET", "/api/graph-signals/sutton", {
        showDiscarded: "1",
        dateFrom: "2026-01-01",
      }),
    ).toBe(true);
  });

  it("refuses the aggregate, methods, unknown queries and malformed variants", () => {
    expect(isStrictSearchRequest("GET", "/api/graph-signals/by-city", {})).toBe(false);
    expect(isStrictSearchRequest("POST", "/api/graph-signals/drummondville", {})).toBe(false);
    expect(
      isStrictSearchRequest("GET", "/api/graph-signals/drummondville", { viewer: "x" }),
    ).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/graph-signals/", {})).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/graph-signals/drummondville/", {})).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/graph-signals//drummondville", {})).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/graph-signals/Drummondville", {})).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/graph-signals/%64rummondville", {})).toBe(false);
    expect(isStrictSearchRequest("GET", "/api/v1/signal-facets/reason-codes", {})).toBe(false);
  });
});

describe("strictRequestPath", () => {
  it("preserves percent sequences verbatim", () => {
    expect(strictRequestPath("https://x.test/api/graph-signals/%64rummondville")).toBe(
      "/api/graph-signals/%64rummondville",
    );
  });

  it("returns null on an unparsable URL", () => {
    expect(strictRequestPath("::not-a-url")).toBeNull();
  });
});

describe("isStrictReceiverEnforced", () => {
  it("requires an armed config (absent or disabled stays pre-strict)", () => {
    expect(isStrictReceiverEnforced(undefined)).toBe(false);
    expect(
      isStrictReceiverEnforced(strictReceiverTestAuth(strictReceiverTestConfig())),
    ).toBe(true);
    expect(
      isStrictReceiverEnforced(
        strictReceiverTestAuth(strictReceiverTestConfig({ enabled: false })),
      ),
    ).toBe(false);
    expect(isStrictReceiverEnforced({ enabled: true } as never)).toBe(false);
  });
});

describe("strict arming helpers", () => {
  it("distinguishes disarmed from requested-but-invalid wiring", () => {
    const armed = strictReceiverTestAuth(strictReceiverTestConfig());
    expect(isStrictArmingInvalid(armed)).toBe(false);
    const disarmed = strictReceiverTestAuth(
      strictReceiverTestConfig({ enabled: false }),
    );
    expect(isStrictArmingInvalid(disarmed)).toBe(false);
    expect(isStrictReceiverEnforced(disarmed)).toBe(false);
    const invalid = strictReceiverTestAuth(
      strictReceiverTestConfig({ enabled: false, armingRequested: true }),
    );
    expect(isStrictArmingInvalid(invalid)).toBe(true);
    expect(isStrictReceiverEnforced(invalid)).toBe(false);
  });

  it("reports wiring completeness for exchanged verification", () => {
    const complete = strictReceiverTestAuth(strictReceiverTestConfig());
    expect(isStrictWiringComplete(complete)).toBe(true);
    const incomplete = strictReceiverTestAuth({
      ...strictReceiverTestConfig(),
      workloadSub: "",
    });
    expect(isStrictWiringComplete(incomplete)).toBe(false);
    expect(isStrictWiringComplete(undefined)).toBe(false);
  });
});

describe("assertStrictRecoveryEligible", () => {
  const eligible = { strictEnforced: true, exchangeCapable: true, preservesData: true };

  it("accepts a strict, exchange-capable, data-preserving target", () => {
    expect(() => assertStrictRecoveryEligible(eligible)).not.toThrow();
  });

  it("refuses permissive, forwarding or data-losing targets", () => {
    for (const target of [
      { ...eligible, strictEnforced: false },
      { ...eligible, exchangeCapable: false },
      { ...eligible, preservesData: false },
    ]) {
      expect(() => assertStrictRecoveryEligible(target)).toThrow("strict_recovery_refused");
    }
  });
});

describe("annotated fixtures", () => {
  it("derives the MCP audience and the bearer allowlist from the API origin", () => {
    const strict = strictReceiverTestConfig({ apiAudience: "https://preprod.example.test" });
    expect(strict.mcpAudience).toBe("https://preprod.example.test/mcp");
    const auth = strictReceiverTestAuth(strict);
    expect(auth.bearerAudiences).toEqual([
      "https://preprod.example.test",
      "https://preprod.example.test/mcp",
    ]);
    expect(auth.strict).toBe(strict);
  });
});
