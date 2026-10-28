import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { streamIdentityFor } from "../../src/services/facets/scoped-reader.js";
import { streamKey } from "../../src/services/facets/scope.js";
import { bootstrapOf } from "../../src/artifacts/write-intent-app-surface-harness.js";
import { identityFixture } from "./pwe-identity-fixture.js";
import { blockedBy, effects, NO_EFFECTS } from "./pwe-fixture.js";

const cases = (["challenge", "cookie"] as const).flatMap((deadline) =>
  (["intent", "key", "stream", "outbox"] as const).map((wait) => ({ deadline, wait })));
describeDb("PWE-07 C06 independent expiry during actual SQL waits", () => {
  it.each(cases)("should roll back $deadline expiry at the $wait wait", async ({ deadline, wait }) => {
    let now = Date.now();
    const date = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const domain = { identityIssuer: "https://expiry-idp.example.test", tier: "preprod" as const,
        appOrigin: "https://expiry-app.example.test", clientId: "expiry-pwe" };
      const h = await identityFixture(domain, randomUUID(), deadline === "cookie" ? 20 : 3600);
      const boot = bootstrapOf(await (await h.summary()).text());
      const before = await baseState(h.h.f);
      const blocker = await h.h.f.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await blocker.query("BEGIN");
        if (wait === "intent") await blocker.query("SELECT * FROM pw_write_intents WHERE intent_id=$1 FOR UPDATE", [h.row.intentId]);
        else if (wait === "outbox") {
          await blocker.query("SELECT pg_advisory_xact_lock(91733051)");
          await h.h.f.pool.query(`CREATE FUNCTION pwe_expiry_wait() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN PERFORM pg_advisory_xact_lock(91733051); RETURN NEW; END $$;
            CREATE TRIGGER pwe_expiry_wait BEFORE INSERT ON pw_write_outbox
            FOR EACH ROW EXECUTE FUNCTION pwe_expiry_wait()`);
        } else {
          const key = wait === "key" ? JSON.stringify(["scoped-command", h.h.f.contributor.id, h.row.commandKey])
            : streamKey(streamIdentityFor(h.row.workspaceId, h.h.f.contributor.id, {
              citySlug: h.row.citySlug, nodeType: "Signal", nodeId: h.h.input.target.id,
              facet: "selection", basket: "pertinent" }));
          await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [key]);
        }
        const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
        pending = Promise.resolve(h.app.request(`${domain.appOrigin}/api/v1/artifacts/write-intents/${h.row.intentId}/confirm`,
          { method: "POST", headers: { host: new URL(domain.appOrigin).host, cookie: h.login.cookie,
            origin: domain.appOrigin, "content-type": "application/json", "x-artifact-write-csrf": boot.csrf as string },
          body: JSON.stringify({ challengeToken: boot.challengeToken }) }));
        await blockedBy(h.h.f, pid);
        now = deadline === "cookie" ? h.login.session.exp * 1000 : h.row.expiresAt.getTime();
        h.h.clock.now = now;
        if (deadline === "cookie") expect(now).toBeLessThan(h.row.expiresAt.getTime());
        else expect(now).toBeLessThan(h.login.session.exp * 1000);
        await blocker.query("ROLLBACK");
        const response = await pending;
        expect(response.status).toBe(deadline === "cookie" ? 401 : 409);
        expect(await response.json()).toMatchObject({ error: { code: deadline === "cookie"
          ? "session_expired" : "challenge_expired", attemptOutcome: "not_executed" } });
      } finally { await blocker.query("ROLLBACK"); blocker.release(); await pending; }
      expect(await baseState(h.h.f)).toEqual(before);
      expect(await effects(h.h.f)).toEqual(NO_EFFECTS);
      expect((await h.h.f.pool.query("SELECT challenge_state FROM pw_write_intents")).rows)
        .toEqual([{ challenge_state: "pending" }]);
    } finally { date.mockRestore(); }
  });
});
