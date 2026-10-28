import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../services/facets/signal-write-fixture.js";
import { pwPrepared } from "../services/facets/pw-write-fixture.js";
import { assertPwPrincipal } from "../services/facets/pw-write-confirmation.js";
import { canonicalAppPrincipal } from "./write-intent-principal.js";
import { verifySession } from "../services/auth/session.js";
import { issueWriteIntentCsrf } from "./write-intent-csrf.js";
import { APP_ORIGIN, AUTH, ISSUER, bootstrapOf, post, surface } from "./write-intent-app-surface-harness.js";
import { revokeWriteIntent } from "./write-intent-app-dispatch.js";
import type { PwPrincipal } from "../services/facets/pw-write-digests.js";

describeDb("PW-C application invariants", () => {
  it("should serialize simultaneous owner revocations without lock upgrades", async () => {
    const f = await workspaceFixture();
    const row = await pwPrepared(f, await preparedSelect(f));
    const blocker = await f.pool.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM account_users WHERE id = $1 FOR UPDATE", [f.contributor.id]);
    const pending = Promise.allSettled([1, 2].map(() =>
      revokeWriteIntent(f.db, row, row.principal as PwPrincipal)));
    try {
      let waiting = 0;
      for (let i = 0; i < 100; i += 1) {
        const locks = await f.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
        waiting = locks.rows[0].n;
        if (waiting === 2) break;
        await new Promise((done) => setTimeout(done, 5));
      }
      expect(waiting).toBe(2);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    const results = await pending;
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled"]);
    if (results[0]!.status === "fulfilled" && results[1]!.status === "fulfilled") {
      expect(results[0]!.value).toEqual(results[1]!.value);
    }
  });

  it.each(["confirm", "revoke"])("should enforce independent origin and CSRF guards on %s", async (action) => {
    const f = await workspaceFixture();
    const { app, host, cookie } = await surface(f);
    const row = await pwPrepared(f, await preparedSelect(f));
    const session = await cookie(f.contributor.sub);
    const summary = await app.request(`https://${host}/artifact-write/intents/${row.intentId}`,
      { headers: { host, cookie: session } });
    expect(summary.status).toBe(200);
    expect(summary.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(summary.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(summary.headers.get("set-cookie")).toBeNull();
    const boot = bootstrapOf(await summary.text());
    const url = `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/${action}`;
    const body = action === "confirm" ? { challengeToken: boot.challengeToken } : {};
    const other = await pwPrepared(f, await preparedSelect(f));
    const otherSummary = await app.request(`https://${host}/artifact-write/intents/${other.intentId}`,
      { headers: { host, cookie: session } });
    const otherBoot = bootstrapOf(await otherSummary.text());
    for (const [csrf, origin] of [[boot.csrf, "https://foreign.test"],
      ["", APP_ORIGIN], [otherBoot.csrf, APP_ORIGIN]] as const) {
      const refused = await post(app, host, url, session, csrf as string, body, origin);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ error: { code: "csrf_refused" } });
    }
    const page = await post(app, host, url, "page=synthetic-page", boot.csrf as string, body);
    expect(page.status).toBe(401);
    const state = await f.pool.query("SELECT consumed_at, revoked_at FROM pw_write_intents WHERE intent_id = $1",
      [row.intentId]);
    expect(state.rows).toEqual([{ consumed_at: null, revoked_at: null }]);
    const receipts = await f.pool.query("SELECT count(*)::int AS n FROM pw_write_receipt_links WHERE intent_id = $1",
      [row.intentId]);
    expect(receipts.rows).toEqual([{ n: 0 }]);
  });

  it.each([{ identityIssuer: "https://other-idp.test", tier: "preprod" as const },
    { identityIssuer: ISSUER, tier: "prod" as const }])(
    "should refuse the same subject in a different identity domain %j", async (identity) => {
      const f = await workspaceFixture();
      const row = await pwPrepared(f, await preparedSelect(f));
      const { app, host, cookie } = await surface(f, identity);
      const session = await cookie(f.contributor.sub);
      const rawCookie = session.slice("radar_session=".length);
      const verified = await verifySession(rawCookie, { sessionSecret: AUTH.sessionSecret });
      expect(verified).not.toBeNull();
      const domain = { ...identity, appOrigin: APP_ORIGIN, clientId: AUTH.clientId };
      const principal = canonicalAppPrincipal(verified!, domain);
      expect(() => assertPwPrincipal(row, principal)).toThrow("confirmation_identity_mismatch");
      const csrf = issueWriteIntentCsrf({ domain, principal, rawCookie, intentId: row.intentId,
        issuedAtMs: Date.now(), sessionExpSec: verified!.exp, sessionSecret: AUTH.sessionSecret });
      const summary = await app.request(`https://${host}/artifact-write/intents/${row.intentId}`,
        { headers: { host, cookie: session } });
      expect(summary.status).toBe(403);
      expect(await summary.text()).not.toContain('id="pw-bootstrap"');
      const result = await post(app, host,
        `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/confirm`,
        session, csrf, { challengeToken: "synthetic-challenge" });
      expect(result.status).toBe(403);
      expect(await result.json()).toMatchObject({ error: { code: "confirmation_identity_mismatch" } });
    });
});
