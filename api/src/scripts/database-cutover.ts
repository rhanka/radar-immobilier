import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { accountUsers, facetActivationState, facetStreamAttachments, workspaceMembershipEvents,
  workspaceMemberships, workspaces } from "../db/schema.js";
import { initializeWorkspaceStore } from "../services/workspaces/init-store.js";
import { attachPersonalHistory } from "../services/facets/attachment.js";
import { executePersonalActivationResume } from "./base-api-personal-activation.js";

const planSchema = z.object({
  version: z.literal(1), actorSub: z.string().min(1), workspaceSlug: z.string().regex(/^[a-z0-9-]+$/),
  workspaceLabel: z.string().min(1),
  accounts: z.array(z.object({ sub: z.string().min(1), destination: z.string().min(1),
    moderateArchive: z.boolean(), manageMembers: z.boolean() }).strict()).min(1),
}).strict();
const evidenceSchema = z.object({ run: z.string().uuid(), release: z.string().regex(/^[0-9a-f]{40}$/),
  instances: z.array(z.string().min(1)).min(1), completedAt: z.string().datetime() }).strict();
export type CutoverPlan = z.infer<typeof planSchema>;
export type CutoverEvidence = z.infer<typeof evidenceSchema>;

export async function migrateDatabaseCutover(db: Database, rawPlan: unknown, rawEvidence: unknown) {
  const plan = planSchema.parse(rawPlan);
  const observed = evidenceSchema.parse(rawEvidence);
  if (new Set(plan.accounts.map(a => a.sub)).size !== plan.accounts.length
    || plan.accounts.some(a => a.destination !== plan.workspaceSlug)
    || !plan.accounts.some(a => a.sub === plan.actorSub && a.manageMembers)) throw new Error("cutover_plan_conflict");
  const reason = "Approved release 6H migration";
  const workspaceId = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('workspace-init', 0))`);
    const accounts = await tx.select().from(accountUsers)
      .where(inArray(accountUsers.sub, plan.accounts.map(a => a.sub))).for("share");
    const resolve = (sub: string) => {
      const row = accounts.find(a => a.sub === sub);
      if (!row || row.status !== "approved") throw new Error("cutover_account_not_approved");
      return row.id;
    };
    plan.accounts.forEach(a => resolve(a.sub));
    const [workspace] = await tx.select().from(workspaces).where(eq(workspaces.slug, plan.workspaceSlug)).for("update");
    const [state] = workspace ? await tx.select().from(facetActivationState)
      .where(eq(facetActivationState.workspaceId, workspace.id)) : [];
    const scoped = state?.writerEpoch === "scoped";
    if (workspace && workspace.label !== plan.workspaceLabel) throw new Error("cutover_workspace_conflict");
    for (const declared of plan.accounts) {
      const id = resolve(declared.sub);
      const [member] = workspace ? await tx.select().from(workspaceMemberships).where(and(
        eq(workspaceMemberships.workspaceId, workspace.id), eq(workspaceMemberships.accountId, id))).for("update") : [];
      const events = workspace ? await tx.select().from(workspaceMembershipEvents).where(and(
        eq(workspaceMembershipEvents.workspaceId, workspace.id), eq(workspaceMembershipEvents.accountId, id))) : [];
      if (!member && scoped) throw new Error("cutover_scoped_membership_missing");
      if (!member && events.length) throw new Error("cutover_membership_history_conflict");
      if (!member) continue;
      if (member.status !== "active" || member.revokedAt) throw new Error("cutover_rights_revoked");
      for (const [field, capability] of [["moderateArchive", "moderate_archive"], ["manageMembers", "manage_members"]] as const) {
        if (member[field] && !declared[field]) throw new Error("cutover_rights_conflict");
        if (declared[field] && !member[field] && (scoped || events.some(e =>
          e.kind === "capability_revoked" && e.capability === capability))) throw new Error("cutover_rights_revoked");
      }
    }
    if (scoped) return workspace!.id;
    // The checks above run under the same transaction/locks as initialization.
    const initialized = await initializeWorkspaceStore(tx as Database, {
      workspaceSlug: plan.workspaceSlug, workspaceLabel: plan.workspaceLabel,
      approvedAccountIds: plan.accounts.map(a => resolve(a.sub)),
      moderatorAccountIds: plan.accounts.filter(a => a.moderateArchive).map(a => resolve(a.sub)),
      managerAccountIds: plan.accounts.filter(a => a.manageMembers).map(a => resolve(a.sub)),
      actorAccountId: resolve(plan.actorSub), reason,
    });
    return initialized.workspaceId;
  });
  const accounts = await db.select().from(accountUsers).where(inArray(accountUsers.sub, plan.accounts.map(a => a.sub)));
  const resolve = (sub: string) => accounts.find(a => a.sub === sub)!.id;
  const [state] = await db.select().from(facetActivationState).where(eq(facetActivationState.workspaceId, workspaceId));
  const entries = plan.accounts.map(a => ({ accountId: resolve(a.sub), workspaceId }));
  if (state?.writerEpoch === "scoped") {
    for (const entry of entries) {
      const [attachment] = await db.select().from(facetStreamAttachments).where(eq(facetStreamAttachments.accountId, entry.accountId));
      if (attachment?.status !== "attached" || attachment.workspaceId !== workspaceId) throw new Error("cutover_scoped_attachment_conflict");
    }
  } else {
    const attachment = await attachPersonalHistory(db, { entries, actorAccountId: resolve(plan.actorSub), reason });
    if (attachment.pendingAmbiguous) throw new Error("cutover_attachment_conflict");
  }
  const bound = { workspaceId, actorSub: plan.actorSub, maintenanceAttemptId: observed.run,
    releaseId: observed.release, instanceIds: observed.instances };
  const proof = { completedAt: observed.completedAt, coveredInstanceIds: observed.instances };
  const result = await executePersonalActivationResume(db, { workspaceId, actorSub: plan.actorSub, reason,
    bound, evidence: { ...bound, reason, drain: proof, shutdown: proof } });
  if (result.status !== "open-success" || result.epoch !== "scoped" || result.sealedUnresolved !== 0
    || result.maintenanceBarrier) throw new Error("cutover_data_not_open");
  return { ok: true, status: result.status, epoch: result.epoch, sealedUnresolved: 0, maintenanceBarrier: false };
}

async function main() {
  const { db, pool } = createDb(loadConfig());
  try {
    const result = await migrateDatabaseCutover(db, JSON.parse(process.env["CUTOVER_PLAN"] ?? "null"),
      JSON.parse(process.env["CUTOVER_EVIDENCE"] ?? "null"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await pool.end(); }
}
if (/database-cutover\.(js|ts)$/.test(process.argv[1] ?? "")) {
  main().catch(() => { process.stderr.write("cutover_data_migration_failed\n"); process.exitCode = 1; });
}
