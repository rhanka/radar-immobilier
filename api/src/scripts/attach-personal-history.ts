/**
 * attach-personal-history — 6H operator attachment (D3).
 *
 * Records one explicit workspace destination per approved account. Accounts
 * with zero or several destinations stay pending and are reported, never
 * converted. Idempotent: re-running with the same arguments changes nothing
 * and reports `"replayed": true`.
 *
 * Account references are OIDC subject identifiers passed as arguments and
 * resolved against approved accounts; nothing is hardcoded. The printed
 * receipt carries account and workspace identifiers only, never names.
 *
 * Usage:
 *   tsx src/scripts/attach-personal-history.ts \
 *     --actor <sub> --entry <sub:workspaceId> [--entry <sub:workspaceId>] \
 *     [--reason <text>]
 */
import { eq } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb } from "../db/client.js";
import { accountUsers } from "../db/schema.js";
import { attachPersonalHistory } from "../services/facets/attachment.js";

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
  const actorSub = takeValue(rawArgs, "--actor");
  const rawEntries = takeValues(rawArgs, "--entry");
  const reason = takeValue(rawArgs, "--reason") ?? "operator attachment";
  if (!actorSub || rawEntries.length === 0) {
    throw new Error(
      "usage: --actor <sub> --entry <sub:workspaceId> [--entry <sub:workspaceId>] [--reason <text>]",
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
    const entries = rawEntries.map((raw) => {
      const separator = raw.lastIndexOf(":");
      if (separator < 0) throw new Error("invalid_entry");
      return {
        accountId: resolve(raw.slice(0, separator)),
        workspaceId: raw.slice(separator + 1),
      };
    });
    const receipt = await attachPersonalHistory(db, {
      entries,
      actorAccountId: resolve(actorSub),
      reason,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    await pool.end();
  }
}

const invoked = /(?:^|[/\\])attach-personal-history\.(ts|js)$/.test(process.argv[1] ?? "");
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
