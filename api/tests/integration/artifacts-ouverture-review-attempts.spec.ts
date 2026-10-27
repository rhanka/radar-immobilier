import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, SCOPE, startOuverture, type Ouverture } from "./artifacts-ouverture.helpers.js";

describe("Astra review: attempts reserved before S3", () => {
  let h: Ouverture;
  beforeAll(async () => { h = await startOuverture("review_attempts"); });
  beforeEach(async () => {
    await h.pool.query("DELETE FROM artifacts.host_actor_rate");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=1000000");
    await h.pool.query("UPDATE artifacts.host_actor_quotas SET operation_limit=1000000");
    h.beforeUpload(async () => {});
  });
  afterAll(async () => { await h?.close(); });
  async function artifact(key: string) {
    const ensured = await h.control.handle("ensure", ALICE, { bindingName: key, idempotencyKey: key });
    expect(ensured.status).toBe(201);
    await h.pool.query(`UPDATE artifacts.host_actor_rate SET count=9
      WHERE storage_scope_id=$1 AND actor_id=$2`, [SCOPE, ALICE]);
    return (ensured.body as { artifactId: string }).artifactId;
  }
  const publish = (artifactId: string, key: string) => h.control.handle("publish", ALICE, {
    artifactId, idempotencyKey: key,
    files: [{ path: "index.html", mimeType: "text/html", text: key }],
  });

  it("admits only one concurrent publication to S3 for the last minute unit", async () => {
    const id = await artifact("last-unit");
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let uploads = 0;
    let settled = 0;
    h.beforeUpload(async () => { uploads++; await gate; });
    const pending = ["last-a", "last-b", "last-c"].map((key) =>
      publish(id, key).finally(() => { settled++; }));
    try {
      await vi.waitFor(() => expect({ uploads, settled }).toEqual({ uploads: 1, settled: 2 }));
      release();
      const results = await Promise.all(pending);
      expect(results.map((result) => result.status).sort()).toEqual([201, 429, 429]);
      for (const refused of results.filter((result) => result.status === 429)) {
        expect(refused.body).toEqual({ error: "rate_limited", retryable: true });
        expect(refused).toHaveProperty("retryable", true);
      }
      expect(uploads).toBe(1);
      expect((await h.durable()).rate).toBe(10);
    } finally { release(); await Promise.all(pending); }
  });

  it("keeps the admitted attempt after a durable quota refusal and stops the next upload", async () => {
    const id = await artifact("durable-exhausted");
    await h.pool.query("UPDATE artifacts.host_quotas SET operation_limit=operations_used");
    const before = await h.durable();
    let uploads = 0;
    h.beforeUpload(async () => { uploads++; });
    expect((await publish(id, "durable-refused")).status).toBe(409);
    expect(uploads).toBe(1);
    expect(await h.durable()).toEqual({ ...before, rate: 10 });
    expect(await publish(id, "durable-refused-next")).toMatchObject({
      status: 429, body: { error: "rate_limited", retryable: true },
    });
    expect(uploads).toBe(1);
    expect(await h.durable()).toEqual({ ...before, rate: 10 });
  });
});
