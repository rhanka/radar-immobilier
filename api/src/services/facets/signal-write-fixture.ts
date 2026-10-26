/** Synthetic PW-D port for tests only; no production intent store is supplied. */
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { workspaceMembershipEvents } from "../../db/schema.js";
import type { SignalWriteAdmission } from "./signal-write-admission-port.js";
import { coordinateSignalWrite } from "./signal-write-admission.js";
import { signalWriteOperationDigest, type SignalWriteInput } from "./signal-write-operations.js";
import { FacetError } from "./target.js";
import { workspaceSignal, type WorkspaceFixture } from "./workspace-archive-fixture.js";
import { readProjectionScope } from "./projection-revisions.js";

export function syntheticAdmission(input: SignalWriteInput): SignalWriteAdmission {
  const expected = signalWriteOperationDigest(input);
  let actorId = "";
  return {
    lockAuthority: async () => {},
    reserve: async (tx, reservation) => {
      actorId = reservation.actorId;
      if (reservation.operationDigest !== expected || reservation.commandKey !== input.commandKey.toLowerCase()) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      const [stored] = await tx.select().from(workspaceMembershipEvents).where(sql`
        ${workspaceMembershipEvents.accountId} = ${actorId} AND
        ${workspaceMembershipEvents.reason} LIKE ${`synthetic-pw:${reservation.commandKey}:%`}`);
      if (stored) {
        if (stored.reason !== `synthetic-pw:${reservation.commandKey}:${expected}`) {
          throw new FacetError(409, "idempotency_key_conflict");
        }
        throw new FacetError(409, "challenge_consumed");
      }
    },
    consume: async () => {},
    recordCommit: async (tx) => {
      // Synthetic audit rows stand in for PW-D storage without altering BASE receipts.
      await tx.insert(workspaceMembershipEvents).values({ workspaceId: input.workspaceId,
        accountId: actorId, actorId, kind: "member_added",
        reason: `synthetic-pw:${input.commandKey.toLowerCase()}:${expected}` });
    },
  };
}

export function admitSyntheticWrite(
  db: Database, sub: string, input: SignalWriteInput, clock?: () => number,
) {
  return coordinateSignalWrite(db, sub, input, syntheticAdmission(input), clock);
}

export async function preparedSelect(f: WorkspaceFixture, sub = f.contributor.sub): Promise<SignalWriteInput> {
  const { target, fingerprint } = await workspaceSignal(f);
  const { token } = await readProjectionScope(f.db, sub, f.workspaceId, target.citySlug, "signal");
  return { operation: "facets.signals.personal.select.v1", workspaceId: f.workspaceId,
    target, basket: "pertinent", expectedHeadId: null, displayedFingerprint: fingerprint,
    expectedProjectionToken: token, commandKey: crypto.randomUUID(), expiresAtMs: Date.now() + 60_000 };
}

/** Compare rows, not just counts: heads, receipts, bindings, revisions and audit. */
export async function baseState(f: Pick<WorkspaceFixture, "pool">) {
  const tables = ["facet_events", "facet_event_bindings", "facet_heads", "facet_streams",
    "facet_commands", "facet_command_contexts", "personal_projection_revisions",
    "workspace_projection_revisions", "workspace_membership_events"];
  return Object.fromEntries(await Promise.all(tables.map(async (table) => {
    const result = await f.pool.query(`SELECT coalesce(jsonb_agg(row ORDER BY row::text), '[]') AS rows
      FROM (SELECT to_jsonb(t) AS row FROM ${table} t) s`);
    return [table, result.rows[0].rows];
  })));
}
