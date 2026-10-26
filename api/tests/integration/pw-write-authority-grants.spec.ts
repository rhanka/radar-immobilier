import { SignJWT } from "jose";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture, H5 } from "./pw-write-authority-fixture.js";

describeDb("PW-A grant boundary", () => {
  it("should refuse each crossed grant with the exact refusal and no persisted intention", async () => {
    const a = await authorityFixture();
    const iat = Math.floor(a.clock.now / 1000);
    const valid = { ...a.page.grant, grantKind: "write", permitsWrites: true,
      iss: a.page.grant.issuer, aud: a.page.grant.audience, iat, exp: iat + 55 };
    const variants = [{ grantKind: "read" }, { grantKind: "publisher" }, { grantKind: undefined },
      { aud: "radar-artifact-read" }, { tier: "prod" }, { identityIssuer: "https://another-idp.example.test" },
      { sessionId: "other-page" }, { readerSub: "other-reader" }, { sub: "other-reader" },
      { artifactId: "another-artifact" }, { releaseId: "another-release" }, { host: "another.pages.example.test" },
      { profileFingerprint: "d".repeat(64) }, { profileName: "demo" }, { policyRevision: "other-policy" },
      { permitsWrites: false }, { exp: iat }, { exp: iat + 121 }, { operations: ["*"] },
      { workspaceId: a.f.otherId }, { operations: ["facets.signals.personal.restore.v1"] }];
    for (const patch of variants) {
      const token = await new SignJWT({ ...valid, ...patch }).setProtectedHeader({ alg: "HS256" })
        .sign(new TextEncoder().encode(a.writeH5.grantSecret));
      const response = await a.prepare({}, a.input.commandKey, token);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "write_grant_required" } });
    }
    const count = await a.f.pool.query("SELECT count(*)::int AS n FROM pw_write_intents");
    expect(count.rows[0].n).toBe(0);
    a.writeH5.resolvePage = async () => null;
    const noPage = await a.prepare();
    expect(noPage.status).toBe(403);
    expect(await noPage.json()).toMatchObject({ error: { code: "write_grant_required" } });
  });

  it("should bind status to P and keep content hosts ahead of the app cookie guard", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    a.page.pageInstanceId = "other-instance";
    const crossed = await a.request(`${H5}/${id}`, { headers: { "x-synthetic-page-proof": a.page.grant.sessionId } });
    expect(crossed.status).toBe(403);
    expect(await crossed.json()).toMatchObject({ error: { code: "write_grant_required" } });
    const content = await a.request(`/api/v1/artifacts/write-intents/${id}/confirm`, { method: "POST",
      headers: { host: a.page.grant.host, cookie: await a.cookie(), authorization: "Bearer synthetic" } });
    expect(content.status).toBe(401);
    expect(await content.json()).toEqual({ error: "unauthenticated" });
    expect(a.counters().confirms).toBe(0);
  });

  it.each(["grant", "page"])("should return the exact authenticated %s expiry refusal", async (kind) => {
    const a = await authorityFixture();
    const iat = Math.floor(a.clock.now / 1000);
    const token = await new SignJWT({ ...a.page.grant, grantKind: "write", permitsWrites: true,
      iss: a.page.grant.issuer, aud: a.page.grant.audience, iat, exp: iat + 1 })
      .setProtectedHeader({ alg: "HS256" }).sign(new TextEncoder().encode(a.writeH5.grantSecret));
    a.clock.now = (iat + 1) * 1000;
    if (kind === "page") a.page.pageExpiresAtMs = a.clock.now;
    const response = await a.prepare({}, a.input.commandKey, token);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ operation: "facets.write-intents.prepare.v1",
      error: { code: kind === "page" ? "page_session_expired" : "write_grant_expired",
        action: "authenticate", attemptOutcome: "not_executed" } });
    const count = await a.f.pool.query("SELECT count(*)::int AS n FROM pw_write_intents");
    expect(count.rows[0].n).toBe(0);
  });
});
