import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PRECONDITION_REQUIRED_MESSAGE } from "@sentropic/artifacts/mcp-core";
import { migrateArtifactCasPolicy } from "../../artifacts-host/src/policy-switch.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`p0c_required_${name}`);
  return value;
}
const phase = required("P0C_PHASE");
const scope = required("P0C_SCOPE");
const origin = "https://preprod.immo.sent-tech.ca";
const v1Base = required("P0C_V1_HTTP_BASE");
const oldBase = phase === "inputs" ? required("P0C_OLD_HTTP_BASE") : v1Base;
const base = phase === "inputs" ? v1Base : required("P0C_V2_HTTP_BASE");
const pool = new pg.Pool({ connectionString: required("P0C_DATABASE_URL"), max: 4,
  options: "-c statement_timeout=15000 -c lock_timeout=5000" });
const hook = (step: string) => execFileSync(required("P0C_APPLY_HOOK"), [phase, step], { stdio: "inherit" });
const files = [{ path: "index.html", mimeType: "text/html", text: "P0-C qualification" }];
const output = (body: Record<string, unknown>) => (body.ok === true ? body.output : body) as Record<string, unknown>;
async function http(url: string, op: string, args: Record<string, unknown> = {}) {
  const read = ["profile", "meta", "list"].includes(op);
  const target = new URL(`${url}/${op}`);
  if (read) for (const [key, value] of Object.entries(args)) target.searchParams.set(key, String(value));
  const response = await fetch(target, { method: read ? "GET" : "POST", redirect: "error",
    headers: { cookie: required("P0C_COOKIE"), origin, "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(read ? {} : { body: JSON.stringify(args) }), signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}
async function usage() {
  return (await pool.query("SELECT operations_used,bytes_used FROM artifacts.host_quotas WHERE storage_scope_id=$1", [scope])).rows;
}
function precondition(body: Record<string, unknown>, version: 1 | 2, revision: string) {
  const error = version === 2 ? body.error as Record<string, unknown> : body;
  assert.equal(version === 2 ? error.code : error.error, "precondition_required", "p0c_precondition_code");
  assert.equal(error.message, PRECONDITION_REQUIRED_MESSAGE, "p0c_precondition_message");
  assert.equal(version === 2 ? error.retriable : error.retryable, false, "p0c_precondition_retry");
  assert.deepEqual(error.details, { profileRevisionId: revision, resultEnvelopeVersion: version,
    requiredField: "expectedCurrentReleaseId", readTools: ["artifacts_get", "artifacts_list"] });
  if (version === 2) assert.equal(body.commitState, "not_committed");
}
async function main() {
  assert.ok(phase === "inputs" || phase === "results", "p0c_phase");
  const version = phase === "inputs" ? 1 : 2;
  const revision = phase === "inputs" ? "immo-artifacts.cas.v2" : "immo-artifacts.v2";
  // Preserve an unchanged v1 command across the input or output switchover.
  const beforeBase = phase === "inputs" ? oldBase : v1Base;
  const ensured = await http(beforeBase, "ensure", { bindingName: `p0c-qualification-${randomUUID()}`, idempotencyKey: randomUUID() });
  assert.equal(ensured.status, 201, "p0c_before_ensure");
  const artifactId = String(output(ensured.body).artifactId);
  const read = await http(beforeBase, "meta", { artifactId });
  assert.equal(output(read.body).currentReleaseId, null, "p0c_before_null_read");
  const historical = { artifactId, files, idempotencyKey: randomUUID(),
    ...(phase === "results" ? { expectedCurrentReleaseId: null } : {}) };
  const first = await http(beforeBase, "publish", historical);
  assert.equal(first.status, 201, "p0c_before_publish");
  const releaseId = output(first.body).releaseId;
  hook("prepare"); // Staged code ready; close old admission, retain the authenticated old probe endpoint.
  if (phase === "inputs") await migrateArtifactCasPolicy(pool, scope);
  else assert.equal((await pool.query("SELECT revision FROM artifacts.host_policy WHERE storage_scope_id=$1", [scope])).rows[0]?.revision, "radar-c4-r3-artifacts-cas");
  hook("open"); // Open the selected binding; never downgrade host_policy on failure.
  const descriptor = await http(base, "profile");
  assert.deepEqual({ profileRevisionId: descriptor.body.profileRevisionId,
    requireExpectedCurrentReleaseId: descriptor.body.requireExpectedCurrentReleaseId,
    resultEnvelopeVersion: descriptor.body.resultEnvelopeVersion }, {
    profileRevisionId: revision, requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: version });
  const before = await usage();
  if (phase === "inputs") {
    const old = await http(oldBase, "publish", { artifactId, files, idempotencyKey: randomUUID() });
    assert.equal(old.status, 403, "p0c_old_instance_can_commit");
  } else {
    const v1 = await http(v1Base, "profile");
    assert.equal(v1.body.profileRevisionId, "immo-artifacts.cas.v2", "p0c_v1_binding_was_downgraded");
    assert.equal(v1.body.resultEnvelopeVersion, 1, "p0c_v1_binding_reshaped");
  }
  const replay = await http(base, "publish", historical);
  assert.equal(replay.status, 201, "p0c_cross_switch_retry");
  assert.equal(output(replay.body).releaseId, releaseId, "p0c_retry_release");
  if (version === 2) assert.deepEqual({ state: replay.body.commitState, replayed: replay.body.replayed }, { state: "committed", replayed: true });
  assert.deepEqual(await usage(), before, "p0c_retry_charged_twice");
  const missing = { artifactId, files, idempotencyKey: randomUUID() };
  const denied = await http(base, "publish", missing);
  assert.equal(denied.status, 428, "p0c_http_428"); precondition(denied.body, version, revision);
  const client = new Client({ name: "immo-p0c-qualification", version: "1" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(required("P0C_MCP_URL")), {
      requestInit: { headers: { authorization: `Bearer ${required("P0C_MCP_TOKEN")}` } } }));
    const catalogue = await client.listTools();
    for (const tool of catalogue.tools.filter((tool) => tool.name.startsWith("artifacts_"))) {
      assert.deepEqual(tool._meta?.["immo/artifactsProfile"], descriptor.body.profileRevisionId ? {
        profileRevisionId: revision, requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: version } : undefined);
    }
    assert.equal(catalogue.tools.filter((tool) => tool.name.startsWith("artifacts_")).length, version === 2 ? 9 : 7);
    const mcpDenied = await client.callTool({ name: "artifacts_publish", arguments: missing });
    assert.equal(mcpDenied.isError, true, "p0c_mcp_isError");
    precondition(JSON.parse((mcpDenied.content as { text: string }[])[0]!.text), version, revision);
    assert.deepEqual(await usage(), before, "p0c_omission_charged");
    const draft = await client.callTool({ name: "artifacts_ensure", arguments: { bindingName: `p0c-first-${randomUUID()}`, idempotencyKey: randomUUID() } });
    const data = output(JSON.parse((draft.content as { text: string }[])[0]!.text));
    assert.deepEqual((data.authoringGuide as { descriptor: unknown }).descriptor, {
      profileRevisionId: revision, requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: version });
    const fresh = String(data.artifactId);
    const get = await client.callTool({ name: "artifacts_get", arguments: { artifactId: fresh } });
    assert.equal(output(JSON.parse((get.content as { text: string }[])[0]!.text)).currentReleaseId, null);
    const published = await client.callTool({ name: "artifacts_publish", arguments: { artifactId: fresh, files, expectedCurrentReleaseId: null, idempotencyKey: randomUUID() } });
    assert.notEqual(published.isError, true, "p0c_first_null_publish");
  } finally { await client.close(); }
  console.log(JSON.stringify({ phase, scope, profileRevisionId: revision, scriptedProofs: "passed",
    claudeConflictAndUnknown: "pending-conductor-qualification" }));
}
try { await main(); }
catch {
  process.exitCode = 1;
  try { hook("close"); } catch { console.error("p0c_admission_close_failed_operator_action_required"); }
  console.error("p0c_acceptance_failed_no_policy_downgrade");
}
finally { await pool.end(); }
