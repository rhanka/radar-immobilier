import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetCommandContexts, facetCommands } from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { WorkspaceError } from "../workspaces/types.js";
import { scopedEpochFor } from "./activation.js";
import { readCommand } from "./commands.js";
import { requireScopedEpoch } from "./scope.js";
import { writeScopedPersonalFacetInTx } from "./scoped-writer.js";
import { digest, type SignalTarget } from "./target.js";
import { writeWorkspaceArchiveFacetInTx } from "./workspace-writer.js";
import type { Basket } from "./writer.js";

export interface RestoreClassementCommand {
  target: SignalTarget;
  displayedFingerprint: string;
  archives: { personal?: string | undefined; workspace?: string | undefined };
  selectionHeads: Record<Basket, string | null>;
  nextClass: Basket | "non_classe";
  reasonCode?: string | undefined;
  commandKey: string;
}

/** One receipt and transaction for restoration AND its resulting selection. */
export async function restoreClassement(
  db: Database, sub: string, workspaceId: string, command: RestoreClassementCommand,
) {
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId);
    const accountId = await approvedAccountId(tx, sub, true);
    const access = await resolveWorkspaceAccess(tx, workspaceId, sub);
    if (command.archives.workspace && !access.moderateArchive) {
      throw new WorkspaceError(403, "workspace_capability_required");
    }
    requireScopedEpoch(await scopedEpochFor(tx, workspaceId), workspaceId);
    const key = command.commandKey.toLowerCase();
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
      ["scoped-command", accountId, key])}, 0))`);
    const commandDigest = digest({ operation: "restore-classement-v1", workspaceId,
      target: command.target, displayedFingerprint: command.displayedFingerprint,
      archives: command.archives, selectionHeads: command.selectionHeads,
      nextClass: command.nextClass, reasonCode: command.reasonCode ?? null });
    if (await readCommand(tx, accountId, key, commandDigest) !== undefined) return;
    const base = { target: command.target, displayedFingerprint: command.displayedFingerprint };
    for (const scope of ["personal", "workspace"] as const) {
      const expectedHeadId = command.archives[scope];
      if (!expectedHeadId) continue;
      const restore = { ...base, action: "restore" as const, expectedHeadId, commandKey: randomUUID() };
      if (scope === "personal") await writeScopedPersonalFacetInTx(tx, sub, workspaceId, restore);
      else await writeWorkspaceArchiveFacetInTx(tx, sub, workspaceId, restore);
    }
    for (const basket of ["pertinent", "a_surveiller"] as const) {
      const select = command.nextClass === basket;
      await writeScopedPersonalFacetInTx(tx, sub, workspaceId, {
        ...base, action: select ? "select" : "deselect", basket,
        ...(select && command.reasonCode ? { reasonCode: command.reasonCode } : {}),
        expectedHeadId: command.selectionHeads[basket], commandKey: randomUUID(),
      });
    }
    await tx.insert(facetCommands).values({ ownerId: accountId, commandKey: key,
      commandDigest, result: { event: null, context: { workspaceId, operation: "restore-classement-v1" } } });
    await tx.insert(facetCommandContexts).values({ ownerId: accountId, commandKey: key,
      workspaceId, status: "resolved", commandDigest });
  });
}
