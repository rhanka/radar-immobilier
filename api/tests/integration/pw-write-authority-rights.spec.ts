import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { revokeMembership } from "../../src/services/workspaces/mutations.js";
import { setMembershipCapability } from "../../src/services/workspaces/capabilities.js";
import { issueWriteIntentCsrf } from "../../src/artifacts/write-intent-csrf.js";
import { authorityFixture, APP } from "./pw-write-authority-fixture.js";

describeDb("PW-A summary rights and technical management", () => {
  it.each(["membership", "moderation"])("should retain only revoke after %s loss with approval intact", async (loss) => {
    const a = await authorityFixture();
    const mutation = { workspaceId: a.f.workspaceId, targetAccountId: a.f.contributor.id,
      actorSub: a.f.moderator.sub, reason: "synthetic withdrawal", expectedRevision: 1 };
    if (loss === "moderation") {
      await setMembershipCapability(a.f.db, { ...mutation, capability: "moderate_archive", granted: true });
      a.page.grant = { ...a.page.grant, operations: ["facets.signals.workspace.restore.v1"] };
    }
    const response = await a.prepare(loss === "moderation"
      ? { operation: "facets.signals.workspace.restore.v1", basket: undefined } : {});
    expect(response.status).toBe(201);
    const id = (await response.json()).data.intentId;
    const cookie = await a.cookie();
    const active = await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } });
    expect((await active.json()).challengeToken).toEqual(expect.any(String));
    if (loss === "membership") await revokeMembership(a.f.db, mutation);
    else await setMembershipCapability(a.f.db, { ...mutation, expectedRevision: 2,
      capability: "moderate_archive", granted: false });
    const approval = await a.f.pool.query("SELECT status FROM account_users WHERE id = $1", [a.f.contributor.id]);
    expect(approval.rows[0].status).toBe("approved");
    for (const path of [`/artifact-write/intents/${id}`, `${APP}/${id}`]) {
      const management = await a.request(path, { headers: { cookie } });
      expect(management.status).toBe(200);
      const data = await management.json();
      expect(data).toEqual({ intentId: id, management: true, csrf: expect.any(String) });
      if (path.startsWith(APP)) {
        const revoked = await a.request(`${APP}/${id}/revoke`, { method: "POST", headers: { cookie,
          origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
          "x-artifact-write-csrf": data.csrf }, body: "{}" });
        expect(revoked.status).toBe(200);
        expect(await revoked.json()).toEqual({ committed: false });
      }
    }
    expect(a.counters().confirms).toBe(0);
  });

  it("should hide foreign and absent management references identically including revoke", async () => {
    const a = await authorityFixture();
    const id = (await (await a.prepare()).json()).data.intentId;
    const cookie = await a.cookie(a.f.outsider.sub);
    const sessionExpSec = Math.floor(a.clock.now / 1000) + 3600;
    for (const ref of [id, randomUUID()]) {
      const csrf = issueWriteIntentCsrf({ domain: a.writeApp.domain,
        principal: { issuer: a.writeApp.domain.identityIssuer, tier: a.writeApp.domain.tier, sub: a.f.outsider.sub },
        rawCookie: cookie.slice("radar_session=".length), intentId: ref,
        issuedAtMs: a.clock.now, sessionExpSec, sessionSecret: a.writeApp.sessionSecret });
      for (const method of ["GET", "POST"]) {
        const denied = await a.request(`${APP}/${ref}${method === "POST" ? "/revoke" : ""}`, {
          method, headers: { cookie, origin: a.writeApp.domain.appOrigin,
            "content-type": "application/json", "x-artifact-write-csrf": csrf },
          ...(method === "POST" ? { body: "{}" } : {}) });
        expect(denied.status).toBe(404);
        expect(await denied.json()).toMatchObject({ error: { code: "write_intent_not_found", action: "refresh_state" } });
      }
    }
    const summary = await a.request(`/artifact-write/intents/${id}`, { headers: { cookie } });
    expect(summary.status).toBe(403);
    expect(await summary.json()).toMatchObject({ error: { code: "confirmation_identity_mismatch" } });
    const untouched = await a.f.pool.query("SELECT revoked_at, challenge_state FROM pw_write_intents");
    expect(untouched.rows).toEqual([{ revoked_at: null, challenge_state: "pending" }]);
  });
});
