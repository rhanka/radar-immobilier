/**
 * init-workspace-authority — 6G operator initialization.
 *
 * Registers one workspace, one explicit membership per approved account,
 * and the two separate capability grants. Idempotent: re-running with the
 * same arguments changes nothing and reports `"replayed": true`.
 *
 * Account references are OIDC subject identifiers passed as arguments and
 * resolved against approved accounts; nothing is hardcoded. The printed
 * receipt carries workspace and account identifiers only, never names.
 *
 * Usage:
 *   tsx src/scripts/init-workspace-authority.ts \
 *     --workspace-slug <slug> --workspace-label <label> \
 *     --actor <sub> --moderator <sub> [--moderator <sub>] \
 *     --manager <sub> [--manager <sub>] [--reason <text>]
 */
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { accountUsers } from "../db/schema.js";
import { initializeWorkspaceStore } from "../services/workspaces/init-store.js";

function takeValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && index + 1 < args.length) values.push(args[index + 1]!);
  }
  return values;
}

function takeValue(args: string[], flag: string): string | null {
  const values = takeValues(args, flag);
  return values.length > 0 ? values[values.length - 1]! : null;
}

export async function main(rawArgs: string[]): Promise<void> {
  const slug = takeValue(rawArgs, "--workspace-slug");
  const label = takeValue(rawArgs, "--workspace-label");
  const actorSub = takeValue(rawArgs, "--actor");
  const moderators = takeValues(rawArgs, "--moderator");
  const managers = takeValues(rawArgs, "--manager");
  const reason = takeValue(rawArgs, "--reason") ?? "operator initialization";
  if (!slug || !label || !actorSub || moderators.length === 0 || managers.length === 0) {
    throw new Error(
      "usage: --workspace-slug <slug> --workspace-label <label> --actor <sub> "
      + "--moderator <sub> [--moderator <sub>] --manager <sub> [--manager <sub>] [--reason <text>]",
    );
  }
  const config = loadConfig();
  const { db, pool } = createDb(config);
  try {
    const approved = await db.select({ id: accountUsers.id, sub: accountUsers.sub })
      .from(accountUsers).where(eq(accountUsers.status, "approved"));
    const bySub = new Map(approved.map((row) => [row.sub, row.id]));
    const resolve = (sub: string): string => {
      const id = bySub.get(sub);
      if (!id) throw new Error("account_not_approved");
      return id;
    };
    const receipt = await initializeWorkspaceStore(db, {
      workspaceSlug: slug,
      workspaceLabel: label,
      approvedAccountIds: approved.map((row) => row.id),
      moderatorAccountIds: moderators.map(resolve),
      managerAccountIds: managers.map(resolve),
      actorAccountId: resolve(actorSub),
      reason,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    await pool.end();
  }
}

const invoked = /(?:^|[/\\])init-workspace-authority\.(ts|js)$/.test(process.argv[1] ?? "");
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
