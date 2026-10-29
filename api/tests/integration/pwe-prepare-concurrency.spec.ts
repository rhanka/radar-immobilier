import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture, H5 } from "./pw-write-authority-fixture.js";
import { mintPageWriteGrant } from "../../src/artifacts/write-intent-page-authority.js";
import { effects, NO_EFFECTS } from "./pwe-fixture.js";

describeDb("PWE-04 C07 concurrent preparation", () => {
  it("should reserve exactly one intent and challenge for two equivalent requests", async () => {
    const h = await authorityFixture();
    const responses = await Promise.all([h.prepare(), h.prepare()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const [first, second] = await Promise.all(responses.map((response) => response.json()));
    expect(first.data).toEqual(second.data);
    expect((await h.f.pool.query(`SELECT
      (SELECT count(*)::int FROM pw_write_intents) AS intents,
      (SELECT count(DISTINCT challenge_id)::int FROM pw_write_intents) AS challenges,
      (SELECT count(*)::int FROM pw_write_key_reservations) AS keys`)).rows)
      .toEqual([{ intents: 1, challenges: 1, keys: 1 }]);
    expect(h.counters().confirms).toBe(0);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
  });

  it("should conflict on a different body without creating a second intent", async () => {
    const h = await authorityFixture();
    const responses = await Promise.all([h.prepare(), h.prepare({ basket: "a_surveiller" })]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const conflict = await responses.find((response) => response.status === 409)!.json();
    expect(conflict.error.code).toBe("idempotency_key_conflict");
    expect((await h.f.pool.query("SELECT count(*)::int AS total FROM pw_write_intents")).rows)
      .toEqual([{ total: 1 }]);
    expect(h.counters().confirms).toBe(0);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
  });

  it("should bind the winning session permanently when another P uses the same key", async () => {
    const h = await authorityFixture();
    const other = structuredClone(h.page);
    other.grant = { ...other.grant, sessionId: randomUUID(), jti: randomUUID() };
    other.pageInstanceId = randomUUID();
    other.authorityReferences = { ...other.authorityReferences,
      page_session: other.grant.sessionId, grant: other.grant.jti };
    const pages = new Map([[h.page.grant.sessionId, h.page], [other.grant.sessionId, other]]);
    h.writeH5.resolvePage = async (request) => pages.get(request.headers.get("x-synthetic-page-proof") ?? "") ?? null;
    const requestOther = async () => h.request(H5, { method: "POST", headers: {
      "content-type": "application/json", "idempotency-key": h.input.commandKey,
      "x-synthetic-page-proof": other.grant.sessionId,
      "x-preview-write-grant": await mintPageWriteGrant(other, h.writeH5, h.clock.now),
    }, body: JSON.stringify(h.body) });
    const responses = await Promise.all([h.prepare(), requestOther()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const winner = responses.findIndex((response) => response.status === 201);
    const pageSessionId = winner === 0 ? h.page.grant.sessionId : other.grant.sessionId;
    const read = async () => (await h.f.pool.query("SELECT page_session_id FROM pw_write_intents")).rows;
    expect(await read()).toEqual([{ page_session_id: pageSessionId }]);
    expect((await (winner === 0 ? h.prepare() : requestOther())).status).toBe(200);
    expect((await (winner === 0 ? requestOther() : h.prepare())).status).toBe(409);
    expect(await read()).toEqual([{ page_session_id: pageSessionId }]);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
  });
});
