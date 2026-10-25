import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { lotCutoverState, lotDestinationState } from "../../src/db/schema.js";
import { setLotCapability } from "../../src/services/facets/lots/lot-capabilities.js";
import { describeDb } from "../../src/services/facets/lots/lot-fixture.js";
import { lotHttpFixture } from "./base-api-lot-http-fixture.js";

describeDb("b5 composed historical command contexts", () => {
  it("keeps an unresolved historical receipt unresolved without SQL mutation", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const key = randomUUID();
    const body = { mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    // Reconstruct pre-epoch metadata without weakening the production immutability triggers.
    const client = await f.fixture.pool.connect();
    try {
      await client.query("BEGIN; SET LOCAL session_replication_role = replica");
      await client.query("INSERT INTO facet_commands(owner_id, command_key, command_digest, result) VALUES($1,$2,$3,$4)",
        [f.fixture.contributor.id, key, "b".repeat(64), { event: null }]);
      await client.query("INSERT INTO facet_command_contexts(owner_id, command_key, workspace_id, status) VALUES($1,$2,$3,'pending')",
        [f.fixture.contributor.id, key, f.fixture.workspaceId]);
      await client.query("COMMIT");
    } finally { client.release(); }
    const before = await f.sqlSnapshot();
    const replay = await f.command("workspace", body, f.fixture.contributor.sub, key);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: "command_context_unresolved" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });

  it("binds an idempotency key to its workspace through composed authentication", async () => {
    const f = await lotHttpFixture();
    const { target, displayed } = await f.resolve(0);
    const key = randomUUID();
    const body = { mode: "real", target, displayed_version: displayed, expected_head_id: null,
      mutation: { action: "select", basket_id: f.fixture.selectionBasket } };
    expect((await f.command("workspace", body, f.fixture.contributor.sub, key)).status).toBe(200);
    await f.fixture.db.insert(lotDestinationState).values({ workspaceId: f.fixture.otherId,
      enabled: true, selectionBasket: f.fixture.selectionBasket });
    await f.fixture.db.insert(lotCutoverState).values({ workspaceId: f.fixture.otherId,
      maintenanceBarrier: true, destinationOpen: true });
    await setLotCapability(f.fixture.db, { workspaceId: f.fixture.otherId,
      targetAccountId: f.fixture.contributor.id, actorSub: f.fixture.moderator.sub,
      capability: "lot_select", granted: true, reason: "synthetic cross workspace", expectedRevision: null });
    const before = await f.sqlSnapshot();
    const response = await f.request(`/api/v1/workspaces/${f.fixture.otherId}/lot-facets/workspace/commands`,
      f.fixture.contributor.sub, { method: "POST", headers: { "content-type": "application/json",
        "idempotency-key": key }, body: JSON.stringify(body) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "idempotency_key_conflict" });
    expect(await f.sqlSnapshot()).toEqual(before);
  });
});
