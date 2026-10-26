import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "@radar/artifacts-host";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";

let h: Harness;
beforeAll(async () => { h = await startHarness("locks", ["alice"]); });
afterAll(async () => { await h?.close(); });

describe("artifact coordinator key lock deadline", () => {
  it("returns 409 on full-key contention and succeeds after unlock", async () => {
    const blocker = await h.pool.connect();
    const key = deriveIdempotencyKey({ scope: h.config.storageScope, sub: "alice", op: "ensure",
      artifactId: "", clientKey: "blocked" });
    const input = { bindingName: "blocked", idempotencyKey: "blocked" };
    try {
      await h.pool.query("INSERT INTO artifacts.operation_keys (storage_scope_id, internal_key) VALUES ($1, $2)",
        [h.config.storageScope, key]);
      await blocker.query("BEGIN");
      await blocker.query("SELECT 1 FROM artifacts.operation_keys WHERE storage_scope_id=$1 AND internal_key=$2 FOR UPDATE",
        [h.config.storageScope, key]);
      const response = await h.control.handle("ensure", "alice", input);
      expect(response).toEqual({ status: 409, body: { error: "conflict" } });
      expect((await h.pool.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("1s");
      expect((await h.pool.query("SELECT count(*) FROM artifacts.artifacts")).rows[0].count).toBe("0");
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect((await h.control.handle("ensure", "alice", input)).status).toBe(201);
    expect((await h.pool.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("1s");
  });
});
