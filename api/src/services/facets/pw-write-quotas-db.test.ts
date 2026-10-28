import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { reservePwQuota } from "./pw-write-quotas.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";
import { pwParams, pwPrepared } from "./pw-write-fixture.js";

describeDb("PW-D quotas", () => {
  it("should reserve the last quota unit once across concurrent transactions", async () => {
    const f = await workspaceFixture();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () =>
      f.db.transaction((tx) => reservePwQuota(tx, "prepare", "last-unit", 1, 60))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const result of results.filter((r) => r.status === "rejected")) {
      expect(result).toMatchObject({ reason: { status: 429, message: "write_rate_limited" } });
    }
  });

  it("should retain quota on failed attempts but roll back an uncommitted reservation", async () => {
    const f = await workspaceFixture();
    await expect(f.db.transaction(async (tx) => {
      await reservePwQuota(tx, "admission", "rollback", 1, 60);
      throw new Error("synthetic rollback");
    })).rejects.toThrow("synthetic rollback");
    await f.db.transaction((tx) => reservePwQuota(tx, "admission", "rollback", 1, 60));
    await expect(f.db.transaction((tx) => reservePwQuota(tx, "admission", "rollback", 1, 60)))
      .rejects.toMatchObject({ status: 429, message: "write_quota_exceeded" });
  });

  it("should apply the shared admission burst even under the minute limit", async () => {
    const f = await workspaceFixture();
    for (let i = 0; i < 5; i++) await f.db.transaction((tx) =>
      reservePwQuota(tx, "admission", "burst-reader", 30, 60));
    await expect(f.db.transaction((tx) => reservePwQuota(tx, "admission", "burst-reader", 30, 60)))
      .rejects.toMatchObject({ message: "write_quota_exceeded" });
  });

  it("should cap a reader across sessions and guard immutable reservations and expiry", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const first = await pwPrepared(f, input);
    for (let i = 1; i < 10; i++) await preparePwWriteIntentGuarded(f.db,
      pwParams(f, { ...input, commandKey: crypto.randomUUID() }));
    await expect(preparePwWriteIntentGuarded(f.db,
      pwParams(f, { ...input, commandKey: crypto.randomUUID() })))
      .rejects.toMatchObject({ message: "write_rate_limited" });
    expect((await f.db.execute(sql`SELECT count(*)::int AS n FROM pw_write_intents`)).rows[0]?.n).toBe(10);
    await expect(f.pool.query("UPDATE pw_write_key_reservations SET operation_digest=$1 WHERE intent_id=$2",
      ["f".repeat(64), first.intentId])).rejects.toThrow("append-only");
    await expect(f.pool.query("UPDATE pw_write_intents SET expires_at=expires_at + interval '1 minute' WHERE intent_id=$1",
      [first.intentId])).rejects.toThrow("immutable");
  });
});
