import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifactBinding } from "../../../packages/immo-mcp/src/artifact-binding.js";
import { createHostPolicy } from "../../../packages/artifacts-host/src/commit-policy.js";
import { ALICE, WORKSPACE, live, startAstra, type Astra } from "./artifacts-astra-a5.helpers.js";

describe("astra A5 activation expiry during membership wait", () => {
  let h: Astra;
  beforeAll(async () => { h = await startAstra("expiry"); await h.openHost(); });
  afterAll(async () => { await h?.close(); });

  it("rereads activation inside the transaction after the membership wait", async () => {
    let activation = live();
    const policy = await createHostPolicy(h.pool, h.config.storageScope, () => activation);
    const client = await h.pool.connect();
    const holder = await h.pool.connect();
    let approval: Promise<unknown> | undefined;
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT workspace_id FROM workspace_memberships WHERE workspace_id=$1 FOR UPDATE", [WORKSPACE]);
      await client.query("BEGIN");
      const pid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      approval = policy.createParticipant(client, "expiry-policy").checkApproval!({ actorId: ALICE, operation: "ensure" });
      await expect.poll(async () => (await h.pool.query(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1", [pid])).rows[0]?.wait_event_type,
      { timeout: 750 }).toBe("Lock");
      activation = { ...live(), expiresAtMs: 0 };
      await holder.query("ROLLBACK");
      expect(await approval).toMatchObject({ approved: false, publicCode: "activation_closed", status: 403 });
    } finally {
      await holder.query("ROLLBACK"); await approval;
      await client.query("ROLLBACK"); client.release(); holder.release();
    }
  });

  it("refuses MCP replay after expiry during a proven membership wait", async () => {
    const env = { ...h.bindingEnv };
    const bound = (await createArtifactBinding(env))!;
    const request = {
      principal: { issuer: "synthetic", sub: ALICE, scopes: ["immo:read", "immo:artifacts:read", "immo:artifacts:write"], claims: [], attributes: {} },
      resource: "synthetic:mcp", correlationId: "expiry", signal: new AbortController().signal,
    };
    const args = { bindingName: "expiry-replay", idempotencyKey: "expiry-replay" };
    const holder = await h.pool.connect();
    let replay: ReturnType<typeof bound.binding.invoke> | undefined;
    try {
      expect((await bound.binding.invoke("artifacts_ensure", args, request)).isError).not.toBe(true);
      const before = await h.durable();
      await holder.query("BEGIN");
      await holder.query("SELECT workspace_id FROM workspace_memberships WHERE workspace_id=$1 FOR UPDATE", [WORKSPACE]);
      replay = bound.binding.invoke("artifacts_ensure", args, request);
      await expect.poll(async () => Number((await h.pool.query(`SELECT count(*) AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
        AND query LIKE '%workspace_memberships%FOR SHARE%'`)).rows[0].n), { timeout: 750 }).toBe(1);
      env.ARTIFACTS_VALIDATION_UNTIL = "2020-01-01T00:00:00Z";
      await holder.query("ROLLBACK");
      const denied = await replay;
      expect(denied.isError).toBe(true);
      expect(JSON.parse((denied.content[0] as { text: string }).text))
        .toEqual({ error: "activation_closed", retryable: false });
      expect(await h.durable()).toEqual(before);
    } finally {
      await holder.query("ROLLBACK"); holder.release();
      await replay; await bound.close();
    }
  });
});
