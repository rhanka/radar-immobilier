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
  const path = "/api/v1/mcp/facets/signals/search";
  it("accepts only the exact GET and the validated search subset", () => {
    expect(isStrictSearchRequest("GET", path, new URLSearchParams("city=sutton&limit=20&showDiscarded=1"))).toBe(true);
    expect(isStrictSearchRequest("GET", path, new URLSearchParams("city=sutton"), "text/event-stream")).toBe(false);
  });
  it.each([
    ["POST", path, "city=sutton"], ["GET", "/api/graph-signals/sutton", ""],
    ["GET", path + "/", "city=sutton"], ["GET", path + "/extra", "city=sutton"],
    ["GET", "/api/v1/mcp/facets/signals/%73earch", "city=sutton"],
    ["GET", path, "city=sutton&city=sutton"], ["GET", path, "city=sutton&limit=1&limit=2"],
    ["GET", path, "city=sutton&sub=other"], ["GET", path, "city=sutton&dateFrom=2026-01-01"],
    ["GET", path, "city=sutton&showDiscarded=true"], ["GET", path, "city=Sutton"],
    ["GET", path, "city=sutton&workspaceId=default"], ["GET", path, "city=sutton&limit=101"],
    ["GET", path, ""], ["GET", "/api/v1/workspaces/anything/signal-facets/coherent-city", "city=sutton"],
  ])("refuses %s %s?%s", (method, route, query) => {
    expect(isStrictSearchRequest(method, route, new URLSearchParams(query))).toBe(false);
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
