import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { workspaceFixture, workspaceSignal } from "../facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../facets/scoped-writer.js";
import { decideSignalMcp, readSignalMcp } from "./signal-mcp.js";
import { Hono } from "hono";
import { signalMcpRoute } from "../../routes/signal-mcp.js";
import { readWorkspaceArchiveCity } from "../facets/workspace-reader.js";
import { writeClassAnnotation, type AiClassAnnotation } from "./class-annotations.js";
import { applyServiceRoleGrants } from "../../db/service-role-grants.js";

async function fixture() {
  const f = await workspaceFixture();
  const { target, fingerprint } = await workspaceSignal(f);
  const ref = { ...target, workspaceId: f.workspaceId, scope: "personal" as const };
  const body = { signalRef: ref, classe: "pertinent", reasonCode: "P-DENSITE", reason: "Residential density", model: "test-model" };
  const read = (sub = f.contributor.sub, reference = ref) => readSignalMcp(f.db, sub, reference);
  const write = async (input: Record<string, unknown> = body, validation = "auto", tool = "classify_signal",
    sub = f.contributor.sub, version?: string) => {
    const state = await read(sub, (input.signalRef ?? ref) as typeof ref);
    const hash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const rows = await f.pool.query("SELECT signal_mcp_write($1,$2,$3,$4::jsonb,$5,$6,$7) AS result",
      [sub, "test-client", tool, JSON.stringify(input), validation, version ?? state.version, hash]);
    return rows.rows[0].result;
  };
  return { ...f, target, fingerprint, ref, body, read, write };
}
describe.skipIf(process.env.MCP_SIGNAL_DB_TEST !== "1")("scoped MCP PostgreSQL", () => {
  it("should reject fabricated human validation in the function and table CHECK", async () => {
    const f = await fixture();
    expect(await f.write(f.body, "human")).toEqual({ error: "invalid_signal_command" });
    await f.write({ ...f.body, pendingHuman: true });
    await expect(f.pool.query(`INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,
      kind,source,model,client_id,oauth_sub,validation,classe,reason,previous_version)
      SELECT workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,model,client_id,oauth_sub,
        'human',classe,reason,previous_version FROM signal_mcp_events`)).rejects.toThrow(/check constraint/);
  });
  it("should persist a browser Non classé override and link it to the MCP event", async () => {
    const f = await fixture();
    await f.write({ ...f.body, pendingHuman: true });
    const state = await f.read();
    const app = new Hono();
    app.use("*", async (c, next) => { c.set("session" as never, { sub: f.contributor.sub } as never); await next(); });
    app.route("/", signalMcpRoute({ db: f.db, auth: { enabled: true } }));
    const response = await app.request(`/api/v1/workspaces/${f.workspaceId}/signal-facets/annotations/decision`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: { ...f.target, scope: "personal" }, version: state.version, classe: "non_classe" }),
    });
    expect(response.status).toBe(201);
    expect((await f.read()).current).toMatchObject({ source: "manual", validation: "human", classe: "non_classe", linked_event_id: state.current!.id });
    expect(await f.write()).toEqual({ error: "classification_priority_conflict" });
  });
  it("should enforce shared MCP archive moderation in UI writes, reads and restoration", async () => {
    const f = await fixture();
    const shared = { ...f.body, signalRef: { ...f.ref, scope: "workspace" }, classe: "ecarte", reasonCode: "N-NON-RES", pendingHuman: true };
    await f.write(shared, "auto", "classify_signal", f.moderator.sub);
    const state = await f.read();
    expect((await readWorkspaceArchiveCity(f.db, f.contributor.sub, f.workspaceId, f.ref.citySlug))[0])
      .toMatchObject({ effectiveDiscarded: true, workspace: { id: state.current!.id }, capabilities: { moderateArchive: false } });
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, { target: f.target,
      action: "select", basket: "pertinent", expectedHeadId: null, displayedFingerprint: f.fingerprint, commandKey: randomUUID() }))
      .rejects.toThrow("workspace_capability_required");
    await expect(decideSignalMcp(f.db, f.contributor.sub, f.ref, state.version, { classe: "pertinent" }))
      .rejects.toThrow("workspace_capability_required");
    await expect(decideSignalMcp(f.db, f.contributor.sub, f.ref, state.version, { classe: "ecarte", confirm: true }))
      .rejects.toThrow("same_actor_confirmation_required");
    const moderatorState = await f.read(f.moderator.sub);
    await decideSignalMcp(f.db, f.moderator.sub, f.ref, moderatorState.version, { classe: "ecarte", confirm: true });
    expect((await f.read()).current).toMatchObject({ source: "manual", classe: "ecarte", scope: "workspace" });
    const confirmedArchive = await f.read(f.moderator.sub);
    await decideSignalMcp(f.db, f.moderator.sub, f.ref, confirmedArchive.version, { classe: "pertinent" });
    expect((await f.read()).current).toBeNull();
    expect((await f.read(f.moderator.sub)).current).toMatchObject({ source: "manual", classe: "pertinent" });
    expect(await readWorkspaceArchiveCity(f.db, f.contributor.sub, f.workspaceId, f.ref.citySlug)).toEqual([]);
  });
  it("should retain model, client, reason and immutable reclassification history", async () => {
    const f = await fixture();
    expect(await f.write()).toHaveProperty("id");
    expect(await f.write({ ...f.body, pendingHuman: true, classe: "a_surveiller", reasonCode: "S-PLANIFIE", reason: "Wait for adoption" })).toHaveProperty("id");
    const state = await f.read();
    expect(state.current).toMatchObject({ source: "mcp", model: "test-model", validation: "auto", pending_human: true, classe: "a_surveiller",
      reasonCode: "S-PLANIFIE", mcpClientId: "test-client", user: f.contributor.sub });
    expect(state.mcpHistory).toHaveLength(2);
    await expect(f.pool.query("DELETE FROM signal_mcp_events")).rejects.toThrow(/append-only/);
    await expect(f.pool.query("TRUNCATE signal_mcp_audit")).rejects.toThrow(/append-only/);
  });
  it("should preserve UI manual priority against automatic and pending MCP", async () => {
    const f = await fixture();
    await writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, { target: f.target,
      action: "select", basket: "a_surveiller", reasonCode: "S-PLANIFIE", expectedHeadId: null,
      displayedFingerprint: f.fingerprint, commandKey: randomUUID() });
    for (const pendingHuman of [false, true]) expect(await f.write({ ...f.body, pendingHuman })).toEqual({ error: "classification_priority_conflict" });
    expect((await f.read()).current).toMatchObject({ source: "manual", classe: "a_surveiller" });
  });
  it("should preserve linked browser confirmation through automatic writes and AI refresh", async () => {
    const f = await fixture();
    await f.write({ ...f.body, pendingHuman: true });
    const pending = await f.read();
    await decideSignalMcp(f.db, f.contributor.sub, f.ref, pending.version, { classe: "pertinent", confirm: true });
    expect(await f.write()).toEqual({ error: "classification_priority_conflict" });
    const ai: AiClassAnnotation = { citySlug: f.target.citySlug, nodeType: f.target.type, nodeId: f.target.id,
      classe: "ecarte", reason: "AI refresh", source: "ai", model: "refresh-model", effort: "low",
      promptId: "v1", promptSha256: "a".repeat(64), pipelineRunId: "refresh-1", inputSha256: "b".repeat(64) };
    await writeClassAnnotation(f.db, ai);
    expect((await f.read()).current).toMatchObject({ source: "manual", classe: "pertinent", validation: "human", linked_event_id: pending.current!.id });
    const confirmed = await f.read();
    await decideSignalMcp(f.db, f.contributor.sub, f.ref, confirmed.version, { classe: "non_classe" });
    expect((await f.read()).current).toMatchObject({ source: "manual", classe: "non_classe", linked_event_id: confirmed.current!.id });
  });
  it("should serialize a manual UI write against an automatic MCP write", async () => {
    const f = await fixture();
    await Promise.all([f.write(), writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, {
      target: f.target, action: "select", basket: "a_surveiller", reasonCode: "S-PLANIFIE", expectedHeadId: null,
      displayedFingerprint: f.fingerprint, commandKey: randomUUID(),
    })]);
    expect((await f.read()).current).toMatchObject({ source: "manual", classe: "a_surveiller" });
  });
  it("should reject stale human acceptance and negative feedback without reclassification", async () => {
    const f = await fixture();
    const previous = await f.read();
    await f.write();
    expect(await f.write({ ...f.body, pendingHuman: true }, "auto", "classify_signal", f.contributor.sub, previous.version)).toEqual({ error: "annotation_version_conflict" });
    expect(await f.write({ signalRef: f.ref, pendingHuman: true, model: "test-model", verdict: "down" }, "auto", "confirm_classification"))
      .toEqual({ error: "reclassification_required" });
  });
  it("should reject automatic clearing, mismatched codes and unconfirmed feedback", async () => {
    const f = await fixture();
    expect(await f.write({ ...f.body, classe: "non_classe" })).toEqual({ error: "human_confirmation_required" });
    expect(await f.write({ ...f.body, reasonCode: "N-NON-RES" })).toEqual({ error: "invalid_reason_code" });
    expect(await f.write({ signalRef: f.ref, model: "test-model", verdict: "up" }, "auto", "confirm_classification"))
      .toEqual({ error: "human_confirmation_required" });
  });
  it("should clean free notes and isolate notes and classifications by user and workspace", async () => {
    const f = await fixture();
    await f.write({ signalRef: f.ref, text: " <b>Check</b>\u0001 next council ", model: "test-model" }, "auto", "annotate_signal");
    await f.write();
    expect((await f.read()).notes[0]).toMatchObject({ text: "Check next council", source: "mcp", validation: "auto" });
    expect((await f.read(f.moderator.sub)).notes).toHaveLength(0);
    expect(await f.read(f.outsider.sub)).toEqual({ error: "workspace_membership_required" });
    const other = await f.read(f.contributor.sub, { ...f.ref, workspaceId: f.otherId });
    expect(other.notes).toHaveLength(0);
    expect(other.current).toBeNull();
  });
  it("should enforce shared moderation and archive-only class rights", async () => {
    const f = await fixture();
    const body = { ...f.body, signalRef: { ...f.ref, scope: "workspace" }, classe: "ecarte", reasonCode: "N-NON-RES" };
    expect(await f.write(body)).toEqual({ error: "workspace_capability_required" });
    expect(await f.write({ ...body, classe: "pertinent", reasonCode: "P-DENSITE" }, "auto", "classify_signal", f.moderator.sub))
      .toEqual({ error: "workspace_archive_only" });
    expect(await f.write(body, "auto", "classify_signal", f.moderator.sub)).toHaveProperty("id");
    expect((await f.read()).current).toMatchObject({ classe: "ecarte", validation: "auto" });
    expect(await f.write(f.body)).toEqual({ error: "workspace_archive_only" });
  });
  it("should audit both outcomes and enforce the per-user rate limit", async () => {
    const f = await fixture();
    for (let index = 0; index < 30; index++) await f.write({ ...f.body, reasonCode: "BAD" });
    expect(await f.write()).toEqual({ error: "rate_limited" });
    const rows = await f.pool.query("SELECT sub,client_id,model,tool,input_hash,result FROM signal_mcp_audit ORDER BY created_at");
    expect(rows.rows).toHaveLength(31);
    expect(rows.rows[0]).toMatchObject({ sub: f.contributor.sub, client_id: "test-client", model: "test-model",
      tool: "classify_signal", input_hash: expect.stringMatching(/^[a-f0-9]{64}$/), result: "invalid_reason_code" });
  });
  it("should grant the restricted role only the necessary signal writes", async () => {
    const f = await fixture();
    await f.pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='immo_mcp_signal_writer') THEN CREATE ROLE immo_mcp_signal_writer; END IF; END $$");
    await applyServiceRoleGrants(f.pool);
    const client = await f.pool.connect();
    try {
      const version = (await f.read()).version;
      await client.query("SET ROLE immo_mcp_signal_writer");
      const rows = await client.query("SELECT signal_mcp_write($1,'test-client','classify_signal',$2::jsonb,'auto',$3,$4) AS result",
        [f.contributor.sub, JSON.stringify(f.body), version, "a".repeat(64)]);
      expect(rows.rows[0].result).toHaveProperty("id");
      await expect(client.query("UPDATE account_users SET status='approved'")).rejects.toThrow(/permission denied/);
      await expect(client.query("DELETE FROM signal_mcp_events")).rejects.toThrow(/permission denied/);
    } finally { await client.query("RESET ROLE"); client.release(); }
  });
});
