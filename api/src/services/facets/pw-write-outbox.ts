import { and, eq, isNull, sql } from "drizzle-orm";
import { pwWriteOutbox } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";

export type PwOutboxKind = "write_committed" | "write_revoked" | "write_rejected";

/** Outbox append in the committing transaction; export replays delivery. */
export async function appendPwOutbox(tx: WriteTx, row: {
  intentId: string; kind: PwOutboxKind; payload: Record<string, unknown>;
}): Promise<void> {
  await tx.insert(pwWriteOutbox).values({
    intentId: row.intentId.toLowerCase(), kind: row.kind, payload: row.payload,
  });
}

export interface PwOutboxRow {
  id: string;
  intentId: string;
  kind: string;
  payload: unknown;
  createdAt: Date;
  attempts: number;
}

/** Export picks pending rows; delivery marks them without a new write. */
export async function listPwPendingOutbox(tx: WriteTx, limit: number): Promise<PwOutboxRow[]> {
  const rows = await tx.select().from(pwWriteOutbox)
    .where(sql`${pwWriteOutbox.deliveredAt} IS NULL`)
    .orderBy(sql`${pwWriteOutbox.createdAt} ASC`).limit(limit);
  return rows.map((row) => ({ id: row.id, intentId: row.intentId, kind: row.kind,
    payload: row.payload, createdAt: row.createdAt, attempts: row.attempts ?? 0 }));
}

export async function markPwOutboxDelivered(tx: WriteTx, id: string): Promise<void> {
  await tx.update(pwWriteOutbox).set({ deliveredAt: new Date(),
    attempts: sql`${pwWriteOutbox.attempts} + 1` })
    .where(and(eq(pwWriteOutbox.id, id), isNull(pwWriteOutbox.deliveredAt)));
}

export async function notePwOutboxAttempt(tx: WriteTx, id: string): Promise<void> {
  await tx.update(pwWriteOutbox).set({ attempts: sql`${pwWriteOutbox.attempts} + 1` })
    .where(eq(pwWriteOutbox.id, id));
}

/** Purge uncommitted payloads after 24h; digests, reservations and links stay. */
export async function purgePwExpiredPayloads(tx: WriteTx): Promise<number> {
  const result = await tx.execute<{ updated: number }>(sql`
    UPDATE pw_write_intents SET target = '{}'::jsonb, command = '{}'::jsonb
    WHERE execution_state <> 'committed'
      AND expires_at < now() - make_interval(hours => 24)
      AND (target <> '{}'::jsonb OR command <> '{}'::jsonb)
    RETURNING intent_id`);
  return result.rows.length;
}
