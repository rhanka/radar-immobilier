import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { assertPwPrincipal } from "../../src/services/facets/pw-write-confirmation.js";
import { samePwPrincipal } from "../../src/artifacts/write-intent-principal.js";
import { verifySession } from "../../src/services/auth/session.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects, NO_EFFECTS } from "./pwe-fixture.js";

describeDb("PWE-03a HW-04 verified identity domains", () => {
  let cached: Awaited<ReturnType<typeof identityFixture>>[] | undefined;
  async function getDomains() {
    if (cached) return cached;
    const sub = "pwe-same-subject";
    const domains: Awaited<ReturnType<typeof identityFixture>>[] = [];
    for (const domain of [
      { identityIssuer: "https://idp-a.example.test", tier: "preprod" as const,
        appOrigin: "https://app-a.example.test", clientId: "client-a" },
      { identityIssuer: "https://idp-b.example.test", tier: "preprod" as const,
        appOrigin: "https://app-b.example.test", clientId: "client-b" },
      { identityIssuer: "https://idp-a.example.test", tier: "prod" as const,
        appOrigin: "https://app-c.example.test", clientId: "client-c" },
    ]) domains.push(await identityFixture(domain, sub));
    cached = domains;
    return domains;
  }

  it("should construct equal app/write principals despite a distinct H5 issuer", async () => {
    const domains = await getDomains();
    expect(new Set(domains.map((item) => item.h.f.name)).size).toBe(3);
    expect(new Set(domains.flatMap((item) => [item.login.auth.sessionSecret, item.h.writeH5.grantSecret])).size).toBe(6);
    for (const item of domains) {
      expect(item.login.evidence).toEqual({ login: 302, callback: 302, exchanges: 1, normalFlow: true });
      expect(item.login.session.sub).toBe("pwe-same-subject");
      expect(item.verified.issuer).not.toBe(item.domain.identityIssuer);
      expect(samePwPrincipal(item.login.principal, item.writePrincipal)).toBe(true);
      expect(item.row.principal).toEqual(item.login.principal);
      expect(() => assertPwPrincipal(item.row, item.login.principal)).not.toThrow();
      expect((await item.summary()).status).toBe(200);
      expect(await effects(item.h.f)).toEqual(NO_EFFECTS);
    }
  });

  it.each([{ index: 1, dimension: "issuer" }, { index: 2, dimension: "tier" }])(
    "should reject the same sub from a different $dimension domain before the route guard", async ({ index, dimension }) => {
      const domains = await getDomains();
      const owner = domains[0]!;
      const foreign = domains[index]!;
      expect(owner.login.principal.sub).toBe(foreign.login.principal.sub);
      expect(owner.login.principal[dimension as "issuer" | "tier"])
        .not.toBe(foreign.login.principal[dimension as "issuer" | "tier"]);
      expect(samePwPrincipal(owner.login.principal, foreign.login.principal)).toBe(false);
      expect(() => assertPwPrincipal(owner.row, foreign.login.principal)).toThrow("confirmation_identity_mismatch");
      const token = foreign.login.cookie.slice("radar_session=".length);
      expect(await verifySession(token, { sessionSecret: owner.login.auth.sessionSecret })).toBeNull();
      const response = await owner.summary(foreign.login.cookie);
      expect(response.status).toBe(401);
      const body = await response.text();
      expect(body.includes('id="pw-bootstrap"')).toBe(false);
      expect(body.includes(owner.h.body.target.id)).toBe(false);
      expect(await effects(owner.h.f)).toEqual(NO_EFFECTS);
      expect(await effects(foreign.h.f)).toEqual(NO_EFFECTS);
    });
});
