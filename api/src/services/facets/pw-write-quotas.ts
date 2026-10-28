import { sql } from "drizzle-orm";
import { pwWriteQuotaLedger } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";
import { PwWriteError } from "./pw-write-errors.js";

export type PwQuotaKind = "attempt" | "admission" | "prepare" | "status";

/** Named transactional limits from conception section 7.8. */
export const PW_QUOTA_LIMITS = {
  attemptPerMinute: { limit: 60, windowSecs: 60 },
  admissionPerReaderMinute: { limit: 30, windowSecs: 60 },
  admissionPerWorkspaceMinute: { limit: 200, windowSecs: 60 },
  preparePerMinute: { limit: 20, windowSecs: 60 },
  statusPerMinute: { limit: 30, windowSecs: 60 },
} as const;

async function countInWindow(tx: WriteTx, kind: PwQuotaKind,
  bucket: string, windowSecs: number): Promise<number> {
  const [row] = await tx.select({ total: sql<number>`count(*)::int` })
    .from(pwWriteQuotaLedger).where(sql`
      ${pwWriteQuotaLedger.kind} = ${kind} AND ${pwWriteQuotaLedger.bucket} = ${bucket} AND
      ${pwWriteQuotaLedger.createdAt} > clock_timestamp() - make_interval(secs => ${windowSecs})`);
  return row?.total ?? 0;
}

/** Count then insert in the same transaction; a full bucket refuses. */
export async function reservePwQuota(tx: WriteTx, kind: PwQuotaKind, bucket: string,
  limit: number, windowSecs: number, intentId?: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(
    ${`pw-quota:${kind}:${bucket}`}, 0))`);
  const used = await countInWindow(tx, kind, bucket, windowSecs);
  if (used >= limit) {
    throw new PwWriteError(429, kind === "admission"
      ? "write_quota_exceeded" : "write_rate_limited");
  }
  const burst = kind === "attempt" ? 10 : kind === "admission"
    ? (bucket.startsWith("admission:workspace:") ? 20 : 5) : kind === "status" ? 5 : 20;
  const recent = await tx.execute<{ at: number; current: number }>(sql`
    SELECT extract(epoch FROM created_at)::float8 AS at,
      extract(epoch FROM clock_timestamp())::float8 AS current
    FROM pw_write_quota_ledger WHERE kind = ${kind} AND bucket = ${bucket}
      AND created_at > clock_timestamp() - make_interval(secs => ${windowSecs})
    ORDER BY created_at`);
  let available = burst;
  let previous = recent.rows[0]?.at ?? 0;
  for (const entry of recent.rows) {
    available = Math.min(burst, available + (entry.at - previous) * limit / windowSecs) - 1;
    previous = entry.at;
  }
  const current = recent.rows[0]?.current ?? previous;
  if (Math.min(burst, available + (current - previous) * limit / windowSecs) < 1) {
    throw new PwWriteError(429, kind === "admission" ? "write_quota_exceeded" : "write_rate_limited");
  }
  await tx.insert(pwWriteQuotaLedger).values({ kind, bucket,
    intentId: intentId?.toLowerCase() ?? null, createdAt: sql`clock_timestamp()` });
}

export async function reservePwAttempt(tx: WriteTx, bucket: string,
  intentId?: string): Promise<void> {
  await reservePwQuota(tx, "attempt", bucket,
    PW_QUOTA_LIMITS.attemptPerMinute.limit,
    PW_QUOTA_LIMITS.attemptPerMinute.windowSecs, intentId);
}

export async function reservePwAdmission(tx: WriteTx, readerBucket: string,
  workspaceBucket: string, intentId?: string): Promise<void> {
  await reservePwQuota(tx, "admission", readerBucket,
    PW_QUOTA_LIMITS.admissionPerReaderMinute.limit,
    PW_QUOTA_LIMITS.admissionPerReaderMinute.windowSecs, intentId);
  await reservePwQuota(tx, "admission", workspaceBucket,
    PW_QUOTA_LIMITS.admissionPerWorkspaceMinute.limit,
    PW_QUOTA_LIMITS.admissionPerWorkspaceMinute.windowSecs, intentId);
}

export async function reservePwPrepare(tx: WriteTx, bucket: string,
  intentId?: string): Promise<void> {
  await reservePwQuota(tx, "prepare", bucket,
    PW_QUOTA_LIMITS.preparePerMinute.limit,
    PW_QUOTA_LIMITS.preparePerMinute.windowSecs, intentId);
}

export async function reservePwStatus(tx: WriteTx, bucket: string): Promise<void> {
  await reservePwQuota(tx, "status", bucket,
    PW_QUOTA_LIMITS.statusPerMinute.limit,
    PW_QUOTA_LIMITS.statusPerMinute.windowSecs);
}

/** Pending caps are checked against live intent rows, not the ledger. */
export async function countPwPending(tx: WriteTx, where: { actorId?: string;
  pageSessionId?: string }): Promise<number> {
  if (where.actorId !== undefined) {
    const found = await tx.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM pw_write_intents
      WHERE actor_id = ${where.actorId} AND execution_state = 'pending'
        AND revoked_at IS NULL AND expires_at > now()`);
    return Number(found.rows[0]?.total ?? 0);
  }
  const found = await tx.execute<{ total: number }>(sql`
    SELECT count(*)::int AS total FROM pw_write_intents
    WHERE page_session_id = ${where.pageSessionId ?? ""} AND execution_state = 'pending'
      AND revoked_at IS NULL AND expires_at > now()`);
  return Number(found.rows[0]?.total ?? 0);
}
