import { expect, it, vi } from "vitest";
import { createDb } from "../../db/client.js";
import { loadConfig } from "../../config.js";
import { describeDb, workspaceFixture } from "./workspace-archive-fixture.js";
import { preparedSelect } from "./signal-write-fixture.js";
import { pwParams, pwPrepared, pwConfirmation } from "./pw-write-fixture.js";
import { readPwWriteStatus } from "./pw-write-admission-durable.js";
import { reservePwIntentStatus } from "./pw-write-status-budget.js";
import { preparePwWriteIntentGuarded } from "./pw-write-prepare.js";

describeDb("PW-D persistent I/P follow-up budgets", () => {
  it("should share spacing across connections and retain it after module and connection reload", async () => {
    const f = await workspaceFixture();
    const row = await pwPrepared(f, await preparedSelect(f));
    const principal = pwConfirmation(row).principal;
    const first = Date.now();
    const peers = Array.from({ length: 3 }, () => createDb({ ...loadConfig(), POSTGRES_DB: f.name }));
    try {
      const results = await Promise.allSettled(peers.map(({ db }) =>
        readPwWriteStatus(db, row.intentId, principal, row.pageSessionId, () => first)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect(r).toMatchObject({ reason: { status: 429, message: "write_rate_limited" } });
      }
    } finally { await Promise.all(peers.map(({ pool }) => pool.end())); }
    vi.resetModules();
    const reloaded = await import("./pw-write-admission-durable.js");
    const fresh = createDb({ ...loadConfig(), POSTGRES_DB: f.name });
    try {
      await expect(reloaded.readPwWriteStatus(fresh.db, row.intentId, principal, row.pageSessionId, () => first + 1999))
        .rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
      await reloaded.readPwWriteStatus(fresh.db, row.intentId, principal, row.pageSessionId, () => first + 2000);
    } finally { await fresh.pool.end(); }
    expect((await f.pool.query("SELECT first_read_at,initial_reads FROM pw_write_status_budgets")).rows)
      .toEqual([{ first_read_at: new Date(first), initial_reads: 2 }]);
  });

  it("should bound sixty initial reads and retain the absolute window during manual follow-up", async () => {
    const f = await workspaceFixture();
    const row = await pwPrepared(f, await preparedSelect(f));
    const first = Date.now();
    const read = (elapsed: number) => f.db.transaction((tx) =>
      reservePwIntentStatus(tx, row.intentId, row.pageSessionId, () => first + elapsed));
    for (let i = 0; i < 60; i++) await read(i * 2000);
    await expect(read(119_999)).rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
    await expect(read(120_000)).rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
    await read(148_000);
    await expect(read(177_999)).rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
    await read(178_000);
    expect((await f.pool.query("SELECT first_read_at,last_read_at,initial_reads FROM pw_write_status_budgets")).rows)
      .toEqual([{ first_read_at: new Date(first), last_read_at: new Date(first + 178_000), initial_reads: 60 }]);
  });

  it("should enforce the count even when a persisted budget already exhausted its allowance", async () => {
    const f = await workspaceFixture();
    const row = await pwPrepared(f, await preparedSelect(f));
    const first = Date.now();
    await f.pool.query(`INSERT INTO pw_write_status_budgets VALUES ($1,$2,$3,$3,60)`,
      [row.intentId, row.pageSessionId, new Date(first)]);
    await expect(f.db.transaction((tx) => reservePwIntentStatus(tx,
      row.intentId, row.pageSessionId, () => first + 2000)))
      .rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
  });

  it("should accumulate the global burst and roll back the per-intent debit on refusal", async () => {
    const f = await workspaceFixture();
    const input = await preparedSelect(f);
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(await preparePwWriteIntentGuarded(f.db,
      pwParams(f, { ...input, commandKey: crypto.randomUUID() })));
    const first = Date.now();
    for (const row of rows.slice(0, 5)) await readPwWriteStatus(f.db, row.intentId,
      pwConfirmation(row).principal, row.pageSessionId, () => first);
    const last = rows[5]!;
    await expect(readPwWriteStatus(f.db, last.intentId, pwConfirmation(last).principal, last.pageSessionId, () => first))
      .rejects.toMatchObject({ status: 429, message: "write_rate_limited" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_status_budgets")).rows[0].n).toBe(5);
    expect((await f.pool.query("SELECT count(*)::int AS n FROM pw_write_quota_ledger WHERE kind='status'")).rows[0].n).toBe(5);
    await expect(readPwWriteStatus(f.db, last.intentId, pwConfirmation(last).principal, "foreign-page"))
      .rejects.toMatchObject({ status: 404, message: "write_intent_not_found" });
  });
});
