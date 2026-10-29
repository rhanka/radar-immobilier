// PW-C PWC-07/08: owner revocation after approval loss without business
// data, and CSRF renewal on cookie remint without consuming the intent.
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "../services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../services/facets/signal-write-fixture.js";
import { pwPrepared } from "../services/facets/pw-write-fixture.js";
import { bootstrapOf, post, surface } from "./write-intent-app-surface-harness.js";

describeDb("PW-C application rights loss", () => {
  it("should keep owner revocation after approval loss without business data", async () => {
    const f = await workspaceFixture();
    const { app, host, cookie } = await surface(f);
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const session = await cookie(f.contributor.sub);
    await f.pool.query("UPDATE account_users SET status = 'suspended' WHERE id = $1",
      [f.contributor.id]);
    const summaryUrl = `https://${host}/artifact-write/intents/${row.intentId}`;

    const summary = await app.request(summaryUrl, { headers: { host, cookie: session } });
    expect(summary.status).toBe(200);
    const html = await summary.text();
    expect(html).toContain("Management only");
    expect(html).not.toContain("Displayed fingerprint");
    const boot = bootstrapOf(html);

    const revokeUrl = `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/revoke`;
    const revoked = await post(app, host, revokeUrl, session, boot.csrf as string, {});
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ intentId: row.intentId,
      authorizationState: "revoked", commandState: "not_committed" });
  });

  it("should invalidate the CSRF token on cookie remint without consuming the intent", async () => {
    const f = await workspaceFixture();
    const { app, host, cookie } = await surface(f);
    const input = await preparedSelect(f);
    const row = await pwPrepared(f, input);
    const first = await cookie(f.contributor.sub);
    const summaryUrl = `https://${host}/artifact-write/intents/${row.intentId}`;
    const boot = bootstrapOf(await (await app.request(summaryUrl,
      { headers: { host, cookie: first } })).text());

    const reminted = await cookie(f.contributor.sub, "reminted");
    const confirmUrl = `https://${host}/api/v1/artifacts/write-intents/${row.intentId}/confirm`;
    const stale = await post(app, host, confirmUrl, reminted,
      boot.csrf as string, { challengeToken: boot.challengeToken });
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ error: { code: "csrf_refused" } });

    const fresh = bootstrapOf(await (await app.request(summaryUrl,
      { headers: { host, cookie: reminted } })).text());
    expect(fresh.csrf).not.toBe(boot.csrf);
    expect(fresh.challengeToken).toBe(boot.challengeToken);
    expect(fresh.expiresAt).toBe(boot.expiresAt);
    const confirmed = await post(app, host, confirmUrl, reminted,
      fresh.csrf as string, { challengeToken: fresh.challengeToken });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ intentId: row.intentId,
      state: "committed" });
  });
});
