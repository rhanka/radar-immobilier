// Synthetic fixtures only; the Make profile supplies a disposable Postgres DB.
import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { loadConfig } from "../../config.js";
import { createDb } from "../../db/client.js";
import { accountUsers } from "../../db/schema.js";
import { initializeWorkspaceStore } from "./init-store.js";

export const { db, pool } = createDb(loadConfig());
export const describeDb: ReturnType<typeof describe.skipIf> = describe.skipIf(process.env.LOT_MIGRATION_DB_TEST !== "1");

export async function account(status = "approved", isAdmin = false) {
  const id = randomUUID();
  const sub = `synthetic-6g-${id}`;
  await db.insert(accountUsers).values({ id, sub, status, isAdmin });
  return { id, sub };
}

export async function fixture() {
  const manager = await account();
  const moderator = await account();
  const member = await account();
  const outsider = await account("approved", true);
  const input = {
    workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic team",
    approvedAccountIds: [manager.id, moderator.id, member.id],
    managerAccountIds: [manager.id], moderatorAccountIds: [moderator.id],
    actorAccountId: manager.id, reason: "synthetic initialization",
  };
  const receipt = await initializeWorkspaceStore(db, input);
  return { manager, moderator, member, outsider, input, receipt,
    workspaceId: receipt.workspaceId };
}
