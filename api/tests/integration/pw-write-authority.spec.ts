import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { baseState } from "../../src/services/facets/signal-write-fixture.js";
import { revokePwAuthority } from "../../src/services/facets/pw-write-fences.js";
import { readCommittedSignalReceipt } from "../../src/services/facets/signal-write-receipt.js";
import { authorityFixture, APP, H5 } from "./pw-write-authority-fixture.js";

describeDb("PW-A authority through createApp and PostgreSQL", () => {
  it("should prepare idempotently without BASE effects and reject a crossed body or P", async () => {
    const a = await authorityFixture();
    const before = await baseState(a.f);
    const first = await a.prepare();
    expect(first.status).toBe(201);
    const data = (await first.json()).data;
    expect(JSON.stringify(data)).not.toMatch(/challengeToken|challengeId|csrf|returnUrl/);
    a.clock.now += 1000;
    const repeat = await a.prepare();
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).data).toEqual(data);
    expect((await a.prepare({ basket: "a_surveiller" })).status).toBe(409);
    expect(await (await a.prepare({ basket: "a_surveiller" })).json()).toMatchObject({ error: { code: "idempotency_key_conflict" } });
    a.page.pageInstanceId = "another-instance";
    const crossed = await a.prepare();
    expect(crossed.status).toBe(409);
    expect(await crossed.json()).toMatchObject({ error: { code: "idempotency_key_conflict" } });
    expect(await baseState(a.f)).toEqual(before);
    const count = await a.f.pool.query("SELECT count(*)::int AS n FROM pw_write_intents");
    expect(count.rows[0].n).toBe(1);
  });

  it("should enforce a revoked authority and bound expiry at preparation", async () => {
    const a = await authorityFixture();
    a.page.delegationExpiresAtMs = a.clock.now + 10_000;
    const response = await a.prepare();
    expect(response.status).toBe(201);
    expect(Date.parse((await response.json()).data.expiresAt)).toBeLessThanOrEqual(a.page.delegationExpiresAtMs);
    await a.f.db.transaction((tx) => revokePwAuthority(tx, "grant", a.page.grant.jti));
    const denied = await a.prepare();
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: { code: "write_grant_revoked" } });
  });

  it("should consume through PW-B once, refuse replay exactly and retain the BASE receipt", async () => {
    const a = await authorityFixture();
    const prepared = (await (await a.prepare()).json()).data;
    const cookie = await a.cookie();
    const summary = await a.request(`/artifact-write/intents/${prepared.intentId}`, { headers: { cookie,
      "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
    expect(summary.status).toBe(200);
    const bootstrap = await summary.json();
    const confirm = () => a.request(`${APP}/${prepared.intentId}/confirm`, { method: "POST",
      headers: { cookie, origin: a.writeApp.domain.appOrigin, "content-type": "application/json",
        "x-artifact-write-csrf": bootstrap.csrf }, body: JSON.stringify({ challengeToken: bootstrap.challengeToken }) });
    const committed = await confirm();
    expect(committed.status).toBe(200);
    expect((await committed.json()).event.state).toBe("active");
    const replay = await confirm();
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: { code: "challenge_consumed" } });
    expect(a.counters().sessionExpiry).toBe(Math.floor(a.clock.now / 1000) * 1000 + 3_600_000);
    const receipt = await readCommittedSignalReceipt(a.f.db, a.f.contributor.sub, a.f.workspaceId, a.input.commandKey);
    expect(receipt?.state).toBe("active");
    const repeat = await a.prepare();
    expect(repeat.status).toBe(200);
    expect((await repeat.json()).data.state).toBe("committed");
    const rows = await a.f.pool.query("SELECT (SELECT count(*)::int FROM facet_events) AS events, (SELECT count(*)::int FROM pw_write_receipt_links) AS links");
    expect(rows.rows[0]).toEqual({ events: 1, links: 1 });
    expect((await a.request(`${H5}/${prepared.intentId}`, { headers: { "x-synthetic-page-proof": a.page.grant.sessionId } })).status).toBe(200);
  });
});
