/**
 * 6H operator attachment: one explicit destination per account (D3).
 * Idempotent with receipt; ambiguous histories stay pending, never
 * converted from personal to workspace scope.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  accountUsers,
  facetStreamAttachments,
  workspaceMemberships,
  workspaces,
} from "../../db/schema.js";
import { decideAttachment, ScopeError } from "./scope.js";
import { assertAttachmentInput, type AttachmentInput, type AttachmentReceipt } from "./attachment-input.js";

type AttachmentTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function approvedId(tx: AttachmentTx, accountId: string): Promise<void> {
  const [row] = await tx.select({ id: accountUsers.id }).from(accountUsers).where(and(
    eq(accountUsers.id, accountId), eq(accountUsers.status, "approved"),
  )).for("share");
  if (!row) throw new ScopeError(403, "account_not_approved");
}

export async function attachPersonalHistory(
  db: Database, input: AttachmentInput,
): Promise<AttachmentReceipt> {
  assertAttachmentInput(input);
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('facet-attachment', 0))`);
    await approvedId(tx, input.actorAccountId);
    const byAccount = new Map<string, string[]>();
    for (const entry of input.entries) {
      const list = byAccount.get(entry.accountId.toLowerCase()) ?? [];
      list.push(entry.workspaceId);
      byAccount.set(entry.accountId.toLowerCase(), list);
    }
    let attached = 0;
    let replayedRows = 0;
    const pending: AttachmentReceipt["pending"] = [];
    for (const [accountId, workspaceIds] of [...byAccount.entries()].sort()) {
      const [existing] = await tx.select().from(facetStreamAttachments)
        .where(eq(facetStreamAttachments.accountId, accountId));
      if (existing) {
        const destinations = [...new Set(workspaceIds.map((id) => id.toLowerCase()))].sort();
        const previous = existing.status === "attached" ? [existing.workspaceId]
          : (existing.detail as { ids: string[] }).ids;
        if (JSON.stringify(destinations) !== JSON.stringify(previous)) {
          throw new ScopeError(409, "attachment_destination_conflict");
        }
        replayedRows += 1;
        if (existing.status === "pending-ambiguous") {
          pending.push({ accountId, workspaceIds: (existing.detail as { ids?: string[] }).ids ?? [] });
        }
        continue;
      }
      const decision = decideAttachment(accountId, workspaceIds);
      if (decision.kind === "pending-ambiguous") {
        if (decision.workspaceIds.length === 0) {
          await approvedId(tx, accountId);
          pending.push({ accountId, workspaceIds: [] });
          continue;
        }
        const fallback = decision.workspaceIds[0]!;
        await approvedId(tx, accountId);
        const [fallbackWorkspace] = await tx.select().from(workspaces)
          .where(eq(workspaces.id, fallback));
        if (!fallbackWorkspace) throw new ScopeError(404, "workspace_not_found");
        await tx.insert(facetStreamAttachments).values({
          accountId, workspaceId: fallback, status: "pending-ambiguous",
          detail: { ids: decision.workspaceIds }, actorId: input.actorAccountId, reason: input.reason,
        });
        pending.push({ accountId, workspaceIds: decision.workspaceIds });
        continue;
      }
      await approvedId(tx, accountId);
      const [target] = await tx.select().from(workspaces)
        .where(eq(workspaces.id, decision.workspaceId));
      if (!target) throw new ScopeError(404, "workspace_not_found");
      const [membership] = await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, decision.workspaceId),
        eq(workspaceMemberships.accountId, accountId),
      )).for("share");
      if (membership?.status !== "active") throw new ScopeError(403, "workspace_membership_required");
      await tx.insert(facetStreamAttachments).values({
        accountId, workspaceId: decision.workspaceId, status: "attached",
        detail: {}, actorId: input.actorAccountId, reason: input.reason,
      });
      attached += 1;
    }
    const total = byAccount.size;
    return {
      attached,
      pendingAmbiguous: pending.length,
      replayed: replayedRows === total && total > 0,
      pending,
    };
  });
}
