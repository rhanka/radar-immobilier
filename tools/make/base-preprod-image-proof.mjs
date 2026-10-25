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
  const job = { action: "activate", binding, image: process.env.OPERATOR_IMAGE, args: ["activate", ...args],
    database: { database: "radar", role: "synthetic_operator", schema: "public" } };
  const operator = (invocation = job) => spawnSync(process.execPath,
    ["api/dist/scripts/base-preprod-job.js", JSON.stringify(invocation)],
    { encoding: "utf8", timeout: 60_000, env: { ...process.env,
      POSTGRES_USER: "synthetic_operator", POSTGRES_PASSWORD: "synthetic-only" } });
  // A nonowner has table locks only through explicit grants. Own just the event
  // table to qualify DROP INDEX without inheriting every other table's owner.
  await pool.query("CREATE ROLE synthetic_operator LOGIN PASSWORD 'synthetic-only'");
  await pool.query("GRANT USAGE ON SCHEMA public TO synthetic_operator");
  await pool.query("GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO synthetic_operator");
  await pool.query("ALTER TABLE facet_events OWNER TO synthetic_operator");
  const refused = async (label, invocation = job) => {
    const child = operator(invocation);
    assert.equal(child.status, 1, `${label} must fail before activation`);
    const state = await pool.query("SELECT count(*)::int AS count FROM facet_activation_state WHERE workspace_id=$1", [init.workspaceId]);
    assert.equal(state.rows[0].count, 0, `${label} must leave no maintenance barrier`);
    console.log(JSON.stringify({ deniedBeforeBarrier: label, exitCode: child.status }));
  };
  await refused("foreign release", { ...job, binding: { ...binding, releaseId: `${"c".repeat(40)}:foreign` } });
  await pool.query("REVOKE UPDATE ON facet_event_bindings FROM synthetic_operator");
  await refused("missing facet_event_bindings table lock");
  await pool.query("GRANT UPDATE ON facet_event_bindings TO synthetic_operator");
  await pool.query("REVOKE UPDATE ON account_users FROM synthetic_operator");
  await pool.query("GRANT DELETE ON account_users TO synthetic_operator");
  await refused("DELETE cannot replace UPDATE for account row locks");
  await pool.query("GRANT UPDATE ON account_users TO synthetic_operator");
  await pool.query("REVOKE INSERT ON facet_command_contexts FROM synthetic_operator");
  await refused("missing command context insertion");
  await pool.query("GRANT INSERT ON facet_command_contexts TO synthetic_operator");
  const qualified = operator();
  assert.equal(qualified.status, 0, qualified.stderr);
  const activate = JSON.parse(qualified.stdout).result;
  assert.equal(activate.status, "open-success");
  assert.equal(activate.maintenanceBarrier, false);
  assert.equal(activate.epoch, "scoped");
  console.log(JSON.stringify({ script: "base-api-personal-activation.js", receipt: activate }));
  const initialization = { action: "init", image: process.env.OPERATOR_IMAGE,
    binding: { ...binding, workspaceId: null, workspaceSlug: "synthetic-image-scope" },
    database: { database: "radar", role: "radar", schema: "public" },
    args: ["--workspace-slug", "synthetic-image-scope", "--workspace-label", "Synthetic image scope",
      "--actor", subjects[0], "--moderator", subjects[0], "--moderator", subjects[1],
      "--manager", subjects[0], "--manager", subjects[1]] };
  for (let replay = 0; replay < 2; replay++) {
    const receipt = JSON.parse(execute("api/dist/scripts/base-preprod-job.js", [JSON.stringify(initialization)]));
    assert.equal(receipt.result.workspaceId, init.workspaceId);
    assert.equal(receipt.result.workspaceSlug, initialization.binding.workspaceSlug);
    assert.equal(receipt.result.replayed, true);
    console.log(JSON.stringify({ initializationReplay: replay + 1, receipt }));
  }
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
  const bytes = execute("api/dist/scripts/base-preprod-job.js", [JSON.stringify({ action: "inspect", binding,
    image: process.env.OPERATOR_IMAGE,
    database: { database: "radar", role: "radar", schema: "public" }, args: [] })]);
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
