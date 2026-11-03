// Lot I1 — preprod read-only ingestion of signed prod admission snapshots.
//
// Zero connection to prod, zero write towards prod: this module only verifies
// an envelope handed to it (webhook body or cron file) and applies it to the
// LOCAL staging + LOCAL prod_sync account rows. Local ('local') accounts are
// never touched. A prod revocation (status leaving 'approved') is propagated
// to the mirrored prod_sync row on the next applied cycle.

import { and, eq, sql } from "drizzle-orm";
import type { KeyObject } from "node:crypto";
import type { Database } from "../db/client.js";
import { accountUsers, admissionSyncProfiles, admissionSyncState } from "../db/schema.js";
import {
  normalizeAdmissionEmail,
  verifySnapshot,
  type AdmissionEntry,
  type AdmissionPayload,
  type AdmissionSourceRow,
} from "./snapshot.js";

export interface IngestOptions {
  publicKeys: Map<string, KeyObject>;
  now?: () => number;
}

export interface IngestResult {
  applied: boolean;
  stale: boolean;
  kid: string;
  issuedAt: string;
  full: boolean;
  upserted: number;
  propagated: number;
  markedAbsent: number;
}

/** Read the prod-side source rows (prod emitter only — never run in preprod). */
export async function readAdmissionSourceRows(db: Database): Promise<AdmissionSourceRow[]> {
  const rows = await db
    .select({
      email: accountUsers.email,
      name: accountUsers.name,
      status: accountUsers.status,
      isAdmin: accountUsers.isAdmin,
      createdAt: accountUsers.createdAt,
      approvedAt: accountUsers.approvedAt,
    })
    .from(accountUsers);
  return rows;
}

function entryDates(entry: AdmissionEntry): { approvedAt: Date | null; createdAt: Date | null } {
  return {
    approvedAt: entry.approvedAt ? new Date(entry.approvedAt) : null,
    createdAt: entry.createdAt ? new Date(entry.createdAt) : null,
  };
}

/**
 * Verify and apply a snapshot envelope. Throws SnapshotRejectedError for an
 * invalid signature (caller maps to 401); returns `{ applied: false, stale:
 * true }` for a delayed snapshot that must not resurrect a newer revocation.
 */
export async function applyAdmissionSnapshot(
  db: Database,
  envelope: unknown,
  opts: IngestOptions,
): Promise<IngestResult> {
  const payload: AdmissionPayload = verifySnapshot(envelope, opts.publicKeys);
  const issuedAt = new Date(payload.issuedAt);
  const base = {
    kid: payload.kid,
    issuedAt: payload.issuedAt,
    full: payload.full,
  };

  const prior = await db
    .select()
    .from(admissionSyncState)
    .where(eq(admissionSyncState.kid, payload.kid))
    .limit(1);
  if (prior.length > 0 && issuedAt.getTime() <= prior[0]!.issuedAt.getTime()) {
    return { ...base, applied: false, stale: true, upserted: 0, propagated: 0, markedAbsent: 0 };
  }

  let upserted = 0;
  let propagated = 0;
  let markedAbsent = 0;
  const seen = new Set<string>();

  for (const entry of payload.entries) {
    const norm = normalizeAdmissionEmail(entry.email);
    if (seen.has(norm)) continue;
    seen.add(norm);
    const dates = entryDates(entry);
    await db
      .insert(admissionSyncProfiles)
      .values({
        email: norm,
        emailDisplay: entry.email.trim(),
        name: entry.name,
        status: entry.status,
        role: entry.role,
        approvedAt: dates.approvedAt,
        createdAt: dates.createdAt,
      })
      .onConflictDoUpdate({
        target: admissionSyncProfiles.email,
        set: {
          emailDisplay: entry.email.trim(),
          name: entry.name,
          status: entry.status,
          role: entry.role,
          approvedAt: dates.approvedAt,
          createdAt: dates.createdAt,
          syncedAt: new Date(opts.now?.() ?? Date.now()),
        },
      });
    upserted += 1;
    propagated += await propagateToMirrorRow(db, norm, entry);
  }

  if (payload.full) {
    // Entries absent from a FULL snapshot left prod (deleted or email
    // changed): stage them as rejected so a stale approval cannot linger.
    // Local accounts are never in staging, so they cannot be marked here.
    const staged = await db.select({ email: admissionSyncProfiles.email }).from(admissionSyncProfiles);
    for (const row of staged) {
      if (seen.has(row.email)) continue;
      await db
        .update(admissionSyncProfiles)
        .set({ status: "rejected", syncedAt: new Date(opts.now?.() ?? Date.now()) })
        .where(eq(admissionSyncProfiles.email, row.email));
      markedAbsent += 1;
      propagated += await propagateRevocationToMirrorRow(db, row.email);
    }
  }

  await db
    .insert(admissionSyncState)
    .values({ kid: payload.kid, issuedAt, entries: payload.entries.length })
    .onConflictDoUpdate({
      target: admissionSyncState.kid,
      set: { issuedAt, entries: payload.entries.length, appliedAt: new Date(opts.now?.() ?? Date.now()) },
    });

  return { ...base, applied: true, stale: false, upserted, propagated, markedAbsent };
}

/**
 * Mirror a staging entry onto the LOCAL prod_sync account row for that email.
 * Only `admission_source='prod_sync'` rows are written; local rows — even
 * with the same email — are never matched. The `sub` is never written here:
 * sub linkage belongs to the JIT reconciliation alone.
 */
async function propagateToMirrorRow(db: Database, normEmail: string, entry: AdmissionEntry): Promise<number> {
  const set: { status: string; isAdmin: boolean; name?: string | null } = {
    status: entry.status,
    isAdmin: entry.role === "admin",
  };
  if (entry.name !== null) set.name = entry.name;
  const updated = await db
    .update(accountUsers)
    .set(set)
    .where(
      and(
        eq(accountUsers.admissionSource, "prod_sync"),
        sql`lower(${accountUsers.email}) = ${normEmail}`,
      ),
    )
    .returning({ id: accountUsers.id });
  return updated.length;
}

async function propagateRevocationToMirrorRow(db: Database, normEmail: string): Promise<number> {
  const updated = await db
    .update(accountUsers)
    .set({ status: "rejected" })
    .where(
      and(
        eq(accountUsers.admissionSource, "prod_sync"),
        sql`lower(${accountUsers.email}) = ${normEmail}`,
      ),
    )
    .returning({ id: accountUsers.id });
  return updated.length;
}
