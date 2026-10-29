import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authRoute } from "../../src/routes/auth.js";
import { verifySession } from "../../src/services/auth/session.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { effects, NO_EFFECTS, ONE_COMMIT } from "./pwe-fixture.js";

describeDb("PWE-03b normal me session remint", () => {
  it("should invalidate old CSRF after real me remint without extending I or signing on PW GET", async () => {
    const domain = { identityIssuer: "https://remint-idp.example.test", tier: "preprod" as const,
      appOrigin: "https://remint-app.example.test", clientId: "remint-pwe" };
    const h = await identityFixture(domain, randomUUID(), 20);
    const first = await h.summary();
    expect(first.headers.get("set-cookie")).toBeNull();
    const boot = bootstrapOf(await first.text());
    h.h.clock.now = h.login.session.iat * 1000 + 11_000;
    expect(h.h.clock.now).toBeLessThan(h.row.expiresAt.getTime());
    const route = authRoute(h.login.auth, { db: h.h.f.db, now: () => h.h.clock.now });
    const me = await route.request(`${domain.appOrigin}/api/v1/auth/me`, { headers: { cookie: h.login.cookie } });
    expect(me.status).toBe(200);
    const header = me.headers.getSetCookie().find((value) => value.startsWith("radar_session="));
    expect(header).toBeDefined();
    expect(header).toContain("HttpOnly"); expect(header).toContain("Secure"); expect(header).not.toContain("Domain=");
    const reminted = header!.split(";")[0]!;
    expect(reminted).not.toBe(h.login.cookie);
    const session = await verifySession(reminted.slice("radar_session=".length),
      { sessionSecret: h.login.auth.sessionSecret, now: h.h.clock.now });
    expect(session).toMatchObject({ sub: h.login.session.sub, iat0: h.login.session.iat0 });
    const confirm = (csrf: unknown, challengeToken: unknown) => h.app.request(
      `${domain.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`, { method: "POST",
        headers: { host: new URL(domain.appOrigin).host, cookie: reminted, origin: domain.appOrigin,
          "content-type": "application/json", "x-artifact-write-csrf": csrf as string },
        body: JSON.stringify({ challengeToken }) });
    expect((await confirm(boot.csrf, boot.challengeToken)).status).toBe(403);
    expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
    const summary = await h.summary(reminted);
    expect(summary.headers.get("set-cookie")).toBeNull();
    const fresh = bootstrapOf(await summary.text());
    expect(fresh.csrf).not.toBe(boot.csrf);
    expect(fresh.challengeToken).toBe(boot.challengeToken);
    expect(fresh.expiresAt).toBe(boot.expiresAt);
    expect((await h.h.f.pool.query("SELECT expires_at,challenge_id FROM pw_write_intents")).rows)
      .toEqual([{ expires_at: h.row.expiresAt, challenge_id: h.row.challengeId }]);
    expect((await confirm(fresh.csrf, fresh.challengeToken)).status).toBe(200);
    expect(await effects(h.h.f)).toEqual(ONE_COMMIT);
  });
});
