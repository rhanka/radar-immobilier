import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { samePwPrincipal } from "../../src/artifacts/write-intent-principal.js";
import { assertPwPrincipal } from "../../src/services/facets/pw-write-confirmation.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { normalLogin } from "./pwe-normal-login.js";
import { blockedBy, effects, NO_EFFECTS, ONE_COMMIT } from "./pwe-fixture.js";

const domain = { identityIssuer: "https://switch-idp.example.test", tier: "preprod" as const,
  appOrigin: "https://switch-app.example.test", clientId: "switch-pwe" };

describeDb("PWE-03a C11 normal account switch", () => {
  it("should reject a second normal same-domain subject before revealing the first owner's summary", async () => {
    const h = await identityFixture(domain, randomUUID());
    const original = bootstrapOf(await (await h.summary()).text());
    const other = await normalLogin(domain, h.h.f.db, h.h.f.outsider.sub, 3600, h.login.auth);
    expect(other.evidence).toEqual({ login: 302, callback: 302, exchanges: 1, normalFlow: true });
    expect(other.principal.issuer).toBe(h.login.principal.issuer);
    expect(other.principal.tier).toBe(h.login.principal.tier);
    expect(other.principal.sub).not.toBe(h.login.principal.sub);
    expect(samePwPrincipal(other.principal, h.writePrincipal)).toBe(false);
    expect(() => assertPwPrincipal(h.row, other.principal)).toThrow("confirmation_identity_mismatch");
    const refused = await h.summary(other.cookie);
    expect(refused.status).toBe(403);
    expect(await refused.text()).not.toContain('id="pw-bootstrap"');
    const confirm = await h.app.request(`${domain.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`,
      { method: "POST", headers: { host: new URL(domain.appOrigin).host, cookie: other.cookie, origin: domain.appOrigin,
        "content-type": "application/json", "x-artifact-write-csrf": original.csrf as string },
      body: JSON.stringify({ challengeToken: original.challengeToken }) });
    expect(confirm.status).toBe(403);
    expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
  });

  it("should finish an already dispatched A request under its own cookie after normal login as B", async () => {
    const h = await identityFixture(domain, randomUUID());
    const original = bootstrapOf(await (await h.summary()).text());
    const blocker = await h.h.f.pool.connect();
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [JSON.stringify(["scoped-command", h.h.f.contributor.id, h.row.commandKey])]);
      const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
      pending = Promise.resolve(h.app.request(`${domain.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`,
        { method: "POST", headers: { host: new URL(domain.appOrigin).host, cookie: h.login.cookie, origin: domain.appOrigin,
          "content-type": "application/json", "x-artifact-write-csrf": original.csrf as string },
        body: JSON.stringify({ challengeToken: original.challengeToken }) }));
      await blockedBy(h.h.f, pid);
      const other = await normalLogin(domain, h.h.f.db, h.h.f.outsider.sub, 3600, h.login.auth);
      expect(other.principal.sub).toBe(h.h.f.outsider.sub);
      expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
      await blocker.query("ROLLBACK");
      expect((await pending).status).toBe(200);
      expect((await h.summary(other.cookie)).status).toBe(403);
    } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
    expect(await effects(h.h.f)).toEqual(ONE_COMMIT);
  });
});
