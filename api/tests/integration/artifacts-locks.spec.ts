import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "@radar/artifacts-host";
import { startHarness, type Harness } from "./artifacts-h2.helpers.js";

let h: Harness;
beforeAll(async () => { h = await startHarness("locks"); });
afterAll(async () => { await h?.close(); });

describe("artifact advisory lock deadline", () => {
  it("returns 409 on lock timeout, resets lock_timeout and succeeds after unlock", async () => {
    const blocker = await h.pool.connect();
    const key = deriveIdempotencyKey({ scope: h.config.storageScope, sub: "alice", op: "ensure",
      artifactId: "", clientKey: "blocked" }).slice(0, 16);
    const input = { bindingName: "blocked", idempotencyKey: "blocked" };
    try {
      await blocker.query("SELECT pg_advisory_lock(('x' || $1)::bit(64)::bigint)", [key]);
      const response = await h.control.handle("ensure", "alice", input);
      expect(response).toEqual({ status: 409, body: { error: "conflict" } });
      expect((await h.pool.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("0");
      expect((await h.pool.query("SELECT count(*) FROM artifacts.artifacts")).rows[0].count).toBe("0");
    } finally {
      await blocker.query("SELECT pg_advisory_unlock(('x' || $1)::bit(64)::bigint)", [key]);
      blocker.release();
    }
    expect((await h.control.handle("ensure", "alice", input)).status).toBe(201);
    expect((await h.pool.query("SHOW lock_timeout")).rows[0].lock_timeout).toBe("0");
  });
});
