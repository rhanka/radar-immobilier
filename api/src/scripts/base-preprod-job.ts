/** Bounded operator Job: complete JSON on stdout; compact, hashed termination receipt. */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { inspect } from "./base-preprod-inspect.js";
import { sql } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { loadConfig } from "../config.js";
import { assertPrivileges } from "./base-preprod-rights.js";

interface Invocation {
  action: "inspect" | "init" | "attach" | "activate" | "resume";
  binding: { workspaceId: string | null; workspaceSlug?: string; actorSub: string; maintenanceAttemptId: string; releaseId: string };
  args: string[];
  database: { database: string; role: string; schema: string };
}

export async function runJob(invocation: Invocation) {
  if (!invocation.binding || !Array.isArray(invocation.args)) throw new Error("invalid_invocation");
  if (invocation.action === "init") {
    const slugs = invocation.args.filter((_, index) => index % 2 === 1
      && invocation.args[index - 1] === "--workspace-slug");
    if (invocation.binding.workspaceId !== null || !invocation.binding.workspaceSlug
      || slugs.length !== 1 || slugs[0] !== invocation.binding.workspaceSlug) {
      throw new Error("workspace_destination_mismatch");
    }
  }
  const handle = createDb(loadConfig());
  try {
    const [actual] = (await handle.db.execute(sql`SELECT current_database() AS database,
      current_user AS role, current_schema() AS schema`)).rows;
    for (const key of ["database", "role", "schema"] as const) {
      if (!invocation.database?.[key] || actual?.[key] !== invocation.database[key]) throw new Error("database_identity_mismatch");
    }
    if (invocation.action !== "inspect") await assertPrivileges(handle.db, invocation.action);
  } finally { await handle.pool.end(); }
  let result: unknown;
  if (invocation.action === "inspect") {
    result = await inspect(invocation.binding.workspaceId);
  }
  else {
    const scripts = { init: "init-workspace-authority", attach: "attach-personal-history",
      activate: "base-api-personal-activation", resume: "base-api-personal-activation" };
    const script = scripts[invocation.action];
    if (!script) throw new Error("invalid_action");
    const child = spawnSync(process.execPath, [`api/dist/scripts/${script}.js`, ...invocation.args], {
      encoding: "utf8", timeout: 480_000, maxBuffer: 4 * 1024 * 1024,
    });
    // Never echo arbitrary SQL/configuration errors or the invocation back to logs.
    if (child.error || child.status !== 0) throw new Error("operator_script_failed");
    result = JSON.parse(child.stdout) as unknown;
    if (!result || typeof result !== "object") throw new Error("operator_receipt_missing");
    if (invocation.action === "init") {
      const destination = result as { workspaceId?: string; workspaceSlug?: string };
      const verification = createDb(loadConfig());
      try {
        const [row] = (await verification.db.execute(sql`SELECT slug FROM workspaces
          WHERE id=${destination.workspaceId}`)).rows;
        if (row?.slug !== invocation.binding.workspaceSlug) throw new Error("workspace_destination_mismatch");
        destination.workspaceSlug = row.slug as string;
      } finally { await verification.pool.end(); }
    }
  }
  const complete = { action: invocation.action, binding: invocation.binding,
    observedAt: new Date().toISOString(), result };
  const bytes = `${JSON.stringify(complete)}\n`;
  process.stdout.write(bytes);
  const receipt = { action: invocation.action, binding: invocation.binding, status: "complete",
    sha256: createHash("sha256").update(bytes).digest("hex"), bytes: Buffer.byteLength(bytes) };
  writeFileSync("/dev/termination-log", JSON.stringify(receipt));
  if ((invocation.action === "activate" || invocation.action === "resume")
      && (result as { status?: string }).status !== "open-success") process.exitCode = 2;
  if (invocation.action === "attach" && (result as { pendingAmbiguous?: number }).pendingAmbiguous !== 0) {
    process.exitCode = 2;
  }
}

if (/(?:^|[/\\])base-preprod-job\.(ts|js)$/.test(process.argv[1] ?? "")) {
  Promise.resolve().then(() => runJob(JSON.parse(process.argv[2] ?? "") as Invocation))
    .catch(() => {
      const failure = '{"status":"failed","error":"operator_job_failed"}';
      writeFileSync("/dev/termination-log", failure);
      process.stderr.write(`${failure}\n`);
      process.exitCode = 1;
    });
}
