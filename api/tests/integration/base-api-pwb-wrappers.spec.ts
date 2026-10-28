// PW-B wrapper stability over HTTP: existing scoped routes keep their
// contract, and this lot exposes no write-intent route.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { describeDb } from "../../src/services/facets/workspace-archive-fixture.js";
import { httpFixture } from "./base-api-http-fixture.js";

describeDb("PW-B scoped wrappers over HTTP", () => {
  it("should keep personal commands idempotent without new routes", async () => {
    const f = await httpFixture();
    const target = f.signal.target;
    const fingerprint = f.signal.fingerprint;
    const key = randomUUID();
    const body = { target, basket: "pertinent",
      expectedHeadId: null, displayedFingerprint: fingerprint };
    const first = await f.command("personal", "select", body, f.data.contributor.sub, key);
    expect(first.status).toBe(200);
    const firstJson = await first.json() as { ok: boolean; event: { id: string } };
    expect(firstJson.ok).toBe(true);
    const replay = await f.command("personal", "select", body, f.data.contributor.sub, key);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { event: { id: string } }).event.id)
      .toBe(firstJson.event.id);
    const stale = await f.command("personal", "deselect",
      { target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: fingerprint });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: "facet_head_conflict" });
  });

  it("should keep workspace moderation gates and mount no intent route", async () => {
    const f = await httpFixture();
    const target = f.signal.target;
    const body = { target, reasonCode: "N-NON-RES",
      expectedHeadId: null, displayedFingerprint: f.signal.fingerprint };
    const refused = await f.command("workspace", "discard", body, f.data.contributor.sub);
    expect(refused.status).toBe(403);
    const committed = await f.command("workspace", "discard", body, f.data.moderator.sub);
    expect(committed.status).toBe(200);
    const missing = await f.request(
      `/api/v1/workspaces/${f.data.workspaceId}/signal-facets/write-intents/prepare`,
      f.data.contributor.sub, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({}) });
    expect(missing.status).toBe(404);
  });
});
