import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";

const execute = (script, args = [], cwd = "/workspace") => {
  const child = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
  assert.equal(child.status, 0, `${script}: ${child.stderr}`);
  return child.stdout;
};
execute("dist/db/migrate.js", [], "/workspace/api");
const pool = new pg.Pool({ host: process.env.POSTGRES_HOST, user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, database: process.env.POSTGRES_DB });
try {
  const subjects = ["oidc:synthetic:owner", "oidc:synthetic:member"];
  for (const sub of subjects) await pool.query("INSERT INTO account_users(sub,status) VALUES ($1,'approved')", [sub]);
  const init = JSON.parse(execute("api/dist/scripts/init-workspace-authority.js", [
    "--workspace-slug", "synthetic-image-scope", "--workspace-label", "Synthetic image scope",
    "--actor", subjects[0], "--moderator", subjects[0], "--moderator", subjects[1],
    "--manager", subjects[0], "--manager", subjects[1], "--reason", "synthetic image proof",
  ]));
  assert.equal(init.membersAdded, 2);
  assert.equal(init.moderatorsGranted, 2);
  assert.equal(init.managersGranted, 2);
  console.log(JSON.stringify({ script: "init-workspace-authority.js", receipt: init }));
  const attach = JSON.parse(execute("api/dist/scripts/attach-personal-history.js", [
    "--actor", subjects[0], "--reason", "synthetic image attachment",
    ...subjects.flatMap((sub) => ["--entry", `${sub}:${init.workspaceId}`]),
  ]));
  assert.equal(attach.attached, 2);
  assert.equal(attach.pendingAmbiguous, 0);
  console.log(JSON.stringify({ script: "attach-personal-history.js", receipt: attach }));
  const binding = { workspaceId: init.workspaceId, actorSub: subjects[0],
    maintenanceAttemptId: "22222222-2222-4222-8222-222222222222",
    releaseId: `${process.env.GIT_SHA}:synthetic-image-proof` };
  const instanceIds = ["synthetic-old-api", "synthetic-old-mcp"];
  const coverage = { completedAt: new Date().toISOString(), coveredInstanceIds: instanceIds };
  const evidence = { ...binding, instanceIds, reason: "synthetic image activation", drain: coverage, shutdown: coverage };
  const args = ["--workspace", binding.workspaceId, "--actor", binding.actorSub, "--reason", evidence.reason,
    "--maintenance-attempt", binding.maintenanceAttemptId, "--release", binding.releaseId,
    ...instanceIds.flatMap((id) => ["--instance", id]), "--evidence-json", JSON.stringify(evidence)];
  const activate = JSON.parse(execute("api/dist/scripts/base-api-personal-activation.js", ["activate", ...args]));
  assert.equal(activate.status, "open-success");
  assert.equal(activate.maintenanceBarrier, false);
  assert.equal(activate.epoch, "scoped");
  console.log(JSON.stringify({ script: "base-api-personal-activation.js", receipt: activate }));
  const snapshot = async () => {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const hash = createHash("sha256");
    for (const { tablename } of tables.rows) {
      const name = tablename.replaceAll('"', '""');
      const rows = await pool.query(`SELECT row_to_json(t) AS row FROM "${name}" t ORDER BY row_to_json(t)::text`);
      hash.update(JSON.stringify({ tablename, rows: rows.rows }));
    }
    return hash.digest("hex");
  };
  const before = await snapshot();
  const bytes = execute("api/dist/scripts/base-preprod-job.js", [JSON.stringify({ action: "inspect", binding, args: [] })]);
  const inspection = JSON.parse(bytes);
  assert.deepEqual(inspection.result.missingMigrations, []);
  assert.equal(inspection.result.approved.length, 2);
  assert(inspection.result.differences.every((row) => row.activeMember && row.attachedHere));
  assert(inspection.result.approved.every((row) => Object.keys(row).sort().join(",") === "id,status,sub"));
  const after = await snapshot();
  assert.equal(after, before, "inspection must preserve every public SQL row");
  const termination = JSON.parse(readFileSync("/dev/termination-log", "utf8"));
  assert.equal(termination.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert(JSON.stringify(termination).length < 4096);
  console.log(JSON.stringify({ inspection, termination, publicSqlBefore: before, publicSqlAfter: after }));
  const resume = JSON.parse(execute("api/dist/scripts/base-api-personal-activation.js", ["resume", ...args]));
  assert.equal(resume.status, "open-success");
  assert.equal(await snapshot(), after);
  console.log(JSON.stringify({ resume, status: "PASS image runtime and read-only inspection" }));
} finally { await pool.end(); }
