import type { Database } from "../../db/client.js";
import type { WriteTx } from "./signal-write-scope.js";
import { sql } from "drizzle-orm";
import { preparePwWriteIntent, type PwPrepareParams } from "./pw-write-store.js";
import { countPwPending, reservePwPrepare } from "./pw-write-quotas.js";
import { PwWriteError } from "./pw-write-errors.js";

const MAX_PENDING_PER_SESSION = 5;
const MAX_PENDING_PER_READER = 10;

/** Guarded preparation: pending caps and prepare rate share one transaction. */
export async function preparePwWriteIntentGuarded(db: Database,
  params: PwPrepareParams) {
  return db.transaction(async (tx) => preparePwWriteIntentInTx(tx, params));
}

export async function preparePwWriteIntentInTx(tx: WriteTx, params: PwPrepareParams) {
  params = JSON.parse(JSON.stringify(params)) as PwPrepareParams;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`pw-prepare:${params.actorId.toLowerCase()}`}, 0))`);
  const existing = await tx.execute(sql`SELECT 1 FROM pw_write_key_reservations
    WHERE actor_id = ${params.actorId} AND command_key = ${params.binding.commandKey}`);
  const intent = await preparePwWriteIntent(tx, params);
  if (existing.rows.length > 0) return intent;
  const pendingSession = await countPwPending(tx,
    { pageSessionId: params.binding.pageSessionId });
  if (pendingSession > MAX_PENDING_PER_SESSION) {
    throw new PwWriteError(429, "write_rate_limited");
  }
  const pendingReader = await countPwPending(tx, { actorId: params.actorId });
  if (pendingReader > MAX_PENDING_PER_READER) {
    throw new PwWriteError(429, "write_rate_limited");
  }
  await reservePwPrepare(tx, `prepare:${params.actorId}`, intent.intentId);
  return intent;
}
