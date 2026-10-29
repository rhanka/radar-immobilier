import { sql } from "drizzle-orm";
import { expect, vi } from "vitest";
import { workspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";
import { preparedSelect } from "../../src/services/facets/signal-write-fixture.js";
import { pwPrepared, pwConfirmation } from "../../src/services/facets/pw-write-fixture.js";
import { coordinateSignalWrite } from "../../src/services/facets/signal-write-admission.js";
import { createDurableWriteAdmission } from "../../src/services/facets/pw-write-admission-durable.js";
import type { WriteTx } from "../../src/services/facets/signal-write-scope.js";
import type { WorkspaceFixture } from "../../src/services/facets/workspace-archive-fixture.js";

export function latch() {
  let done!: () => void;
  let reached = false;
  const promise = new Promise<void>((resolve) => { done = resolve; });
  const resolve = () => { reached = true; done(); };
  const wait = () => vi.waitFor(() => expect(reached).toBe(true), { timeout: 800, interval: 5 });
  return { promise, resolve, wait };
}

export function outcome<T>(work: Promise<T>) {
  return work.then((value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }));
}

export async function backendPid(tx: WriteTx): Promise<number> {
  const result = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
  return result.rows[0]!.pid;
}

export async function blockedBy(f: WorkspaceFixture, pid: number) {
  await vi.waitFor(async () => {
    const result = await f.pool.query(`SELECT EXISTS (SELECT FROM pg_stat_activity
      WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked`, [pid]);
    expect(result.rows[0].blocked).toBe(true);
  }, { timeout: 800, interval: 5 });
}

export async function effects(f: WorkspaceFixture) {
  const result = await f.pool.query(`SELECT
    (SELECT count(*)::int FROM facet_events) AS events,
    (SELECT count(*)::int FROM facet_commands) AS commands,
    (SELECT count(*)::int FROM pw_write_receipt_links) AS links,
    (SELECT count(*)::int FROM pw_write_intents WHERE challenge_state='consumed') AS consumed,
    (SELECT count(*)::int FROM pw_write_audit WHERE result='committed') AS audits,
    (SELECT count(*)::int FROM pw_write_outbox WHERE kind='write_committed') AS outbox,
    (SELECT count(*)::int FROM pw_write_quota_ledger WHERE kind='admission') AS debits`);
  return result.rows[0] as Record<string, number>;
}

export const NO_EFFECTS = { events: 0, commands: 0, links: 0, consumed: 0, audits: 0, outbox: 0, debits: 0 };
export const ONE_COMMIT = { events: 1, commands: 1, links: 1, consumed: 1, audits: 1, outbox: 1, debits: 2 };

export async function writeFixture() {
  const f = await workspaceFixture();
  const input = await preparedSelect(f);
  const row = await pwPrepared(f, input);
  const admission = () => createDurableWriteAdmission(row.intentId, { confirmation: pwConfirmation(row) });
  const execute = (port = admission()) => coordinateSignalWrite(f.db, f.contributor.sub, input, port);
  return { f, row, input, admission, execute };
}
