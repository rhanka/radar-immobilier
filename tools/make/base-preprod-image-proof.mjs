  await pool.query("GRANT INSERT ON facet_command_contexts TO synthetic_operator");
  await pool.query("REVOKE EXECUTE ON FUNCTION facet_swap_head_enforcement(uuid) FROM PUBLIC");
  await refused("missing activation function execution");
  await pool.query("GRANT EXECUTE ON FUNCTION facet_swap_head_enforcement(uuid) TO PUBLIC");
  await pool.query("ALTER TABLE facet_events OWNER TO radar");
  await pool.query("GRANT SELECT, INSERT, UPDATE ON facet_events TO synthetic_operator");
  await refused("missing effective index owner");
  await pool.query("ALTER TABLE facet_events OWNER TO synthetic_operator");
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
