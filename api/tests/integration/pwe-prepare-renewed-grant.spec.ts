import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { authorityFixture } from "./pw-write-authority-fixture.js";
import { effects, NO_EFFECTS } from "./pwe-fixture.js";

describeDb("PWE-04 C07 grant renewal during an exact retry", () => {
  it("should retain the original challenge, grant reference and deadline", async () => {
    const h = await authorityFixture();
    h.page.pageExpiresAtMs = h.clock.now + 240_000;
    h.page.delegationExpiresAtMs = h.clock.now + 300_000;
    const first = await h.prepare();
    expect(first.status).toBe(201);
    const original = (await first.json()).data;
    const snapshot = async () => (await h.f.pool.query(`SELECT
      intent_id, invocation_id, intent_digest, grant_reference, expires_at::text,
      challenge_id, challenge_state, authority_references FROM pw_write_intents`)).rows;
    const before = await snapshot();
    h.clock.now += 1_000;
    const reference = randomUUID();
    h.page.grant = { ...h.page.grant, jti: reference };
    h.page.authorityReferences = { ...h.page.authorityReferences, grant: reference };
    const replay = await h.prepare();
    expect(replay.status).toBe(200);
    expect((await replay.json()).data).toEqual(original);
    // Compare internally: never project the challenge identifier to P.
    expect(await snapshot()).toEqual(before);
    expect(h.counters().confirms).toBe(0);
    expect(await effects(h.f)).toEqual(NO_EFFECTS);
  });
});
