import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { workspaceFixture, workspaceSignal } from "../facets/workspace-archive-fixture.js";
import { writeScopedPersonalFacet } from "../facets/scoped-writer.js";
import { decideSignalMcp, readSignalMcp, readSignalMcpCity } from "./signal-mcp.js";
import { initializeWorkspaceStore } from "../workspaces/init-store.js";
import { readScopedByCity } from "../facets/scoped-by-city.js";
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
    if (validation !== "auto") {
      // The MCP entry point forces auto: a caller asking for anything else
      // is refused exactly like a forged human validation was before.
      return { error: "invalid_signal_command" };
    }
    const rows = await f.pool.query("SELECT signal_mcp_write_mcp($1,$2,$3,$4::jsonb,$5,$6) AS result",
      [sub, "test-client", tool, JSON.stringify(input), version ?? state.version, hash]);
    return rows.rows[0].result;
  };
  return { ...f, target, fingerprint, ref, body, read, write };
}
describe.skipIf(process.env.MCP_SIGNAL_DB_TEST !== "1")("scoped MCP PostgreSQL", () => {
  it("should replay migration 0048 and 0049 without changing existing events, audit or protections", async () => {
    const f = await fixture();
    expect(await f.write()).toHaveProperty("id");
    const state = await f.read();
    const audit = await f.pool.query("SELECT * FROM signal_mcp_audit ORDER BY id");
    const sql48 = readFileSync(new URL("../../../drizzle/0048_signal_mcp_write.sql", import.meta.url), "utf8");
    const sql49 = readFileSync(new URL("../../../drizzle/0049_signal_mcp_elicitation_human.sql", import.meta.url), "utf8");
    for (let replay = 0; replay < 2; replay++) {
      await f.pool.query(sql48);
      await f.pool.query(sql49);
      expect(await f.read()).toEqual(state);
      expect((await f.pool.query("SELECT * FROM signal_mcp_audit ORDER BY id")).rows).toEqual(audit.rows);
      for (const table of ["signal_mcp_events", "signal_mcp_audit"]) {
        await expect(f.pool.query(`DELETE FROM ${table}`)).rejects.toThrow(/append-only/);
        await expect(f.pool.query(`TRUNCATE ${table}`)).rejects.toThrow(/append-only/);
      }
    }
    expect(await f.write({ ...f.body, classe: "a_surveiller", reasonCode: "S-PLANIFIE" })).toHaveProperty("id");
  });
  it("should record accepted elicitation as human with mcp+elicitation source tag and reject forged human rows", async () => {
    const f = await fixture();
    expect(await f.write(f.body, "human")).toEqual({ error: "invalid_signal_command" });
    // No callable writer lets the MCP path choose source or validation directly.
    expect((await f.pool.query(`SELECT count(*)::int AS n FROM pg_proc
      WHERE proname IN ('signal_mcp_write')`)).rows).toEqual([{ n: 0 }]);
    // Without elicitationId/elicitationAcceptedAt, MCP remains auto/mcp.
    await f.write({ ...f.body, pendingHuman: true });
    expect((await f.pool.query(`SELECT source,source_tag,validation,elicitation_id FROM signal_mcp_events`)).rows)
      .toEqual([{ source: "mcp", source_tag: "mcp", validation: "auto", elicitation_id: null }]);
    // Direct forged human row without elicitation_id + source_tag='mcp+elicitation' fails table CHECK.
    await expect(f.pool.query(`INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,
      kind,source,source_tag,model,client_id,oauth_sub,validation,classe,reason,previous_version)
      SELECT workspace_id,actor_id,scope,city_slug,node_type,node_id,kind,source,'mcp',model,client_id,oauth_sub,
        'human',classe,reason,previous_version FROM signal_mcp_events`)).rejects.toThrow(/check constraint/);
    // Accepted elicitation produces validation='human', source_tag='mcp+elicitation', and full trace.
    const elicitationId = randomUUID();
    const elicitationAcceptedAt = new Date().toISOString();
    const res = await f.write({ ...f.body, classe: "a_surveiller", reasonCode: "S-PLANIFIE",
      elicitationId, elicitationAcceptedAt, elicitationStatus: "accepted" });
    expect(res).toMatchObject({ id: expect.any(String), validation: "human", sourceTag: "mcp+elicitation", elicitationId });
    const state = await f.read();
    expect(state.current).toMatchObject({
      source: "mcp", sourceTag: "mcp+elicitation", validation: "human", pending_human: false,
      elicitationId, actor_id: f.contributor.id, user: f.contributor.sub, classe: "a_surveiller",
    });
    expect(state.canConfirm).toBe(false);
    // Automatic MCP write and newer AI refresh never supersede an mcp+elicitation human class.
    expect(await f.write()).toEqual({ error: "classification_priority_conflict" });
    await writeClassAnnotation(f.db, { citySlug: f.target.citySlug, nodeType: f.target.type, nodeId: f.target.id,
      classe: "ecarte", reason: "Newer AI", source: "ai", model: "refresh-model", effort: "low",
      promptId: "v2", promptSha256: "a".repeat(64), pipelineRunId: "refresh-2", inputSha256: "b".repeat(64) });
    expect((await f.read()).current).toMatchObject({ source: "mcp", sourceTag: "mcp+elicitation", validation: "human", classe: "a_surveiller" });
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
    // A workspace MCP archive is not effective for anyone until the linked
    // browser confirmation lands.
    const pending = await f.read();
    expect(pending.current).not.toMatchObject({ scope: "workspace", classe: "ecarte" });
    expect(pending.pendingShared).toMatchObject({ source: "mcp", classe: "ecarte", scope: "workspace" });
    expect(await readWorkspaceArchiveCity(f.db, f.contributor.sub, f.workspaceId, f.ref.citySlug)).toEqual([]);
    await expect(decideSignalMcp(f.db, f.contributor.sub, f.ref, pending.version, { classe: "pertinent", reasonCode: "P-DENSITE" }))
      .rejects.toThrow("workspace_capability_required");
    await expect(decideSignalMcp(f.db, f.contributor.sub, f.ref, pending.version, { classe: "ecarte", confirm: true }))
      .rejects.toThrow("same_actor_confirmation_required");
    const moderatorState = await f.read(f.moderator.sub);
    await decideSignalMcp(f.db, f.moderator.sub, f.ref, moderatorState.version, { classe: "ecarte", confirm: true });
    const state = await f.read();
    expect(state.current).toMatchObject({ source: "manual", classe: "ecarte", scope: "workspace" });
    expect(state.pendingShared).toBeNull();
    expect((await readWorkspaceArchiveCity(f.db, f.contributor.sub, f.workspaceId, f.ref.citySlug))[0])
      .toMatchObject({ effectiveDiscarded: true, workspace: { id: state.current!.id }, capabilities: { moderateArchive: false } });
    await expect(writeScopedPersonalFacet(f.db, f.contributor.sub, f.workspaceId, { target: f.target,
      action: "select", basket: "pertinent", expectedHeadId: null, displayedFingerprint: f.fingerprint, commandKey: randomUUID() }))
      .rejects.toThrow("workspace_capability_required");
    const confirmedArchive = await f.read(f.moderator.sub);
    await decideSignalMcp(f.db, f.moderator.sub, f.ref, confirmedArchive.version, { classe: "pertinent", reasonCode: "P-DENSITE" });
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
    expect((await f.read()).pendingShared).toMatchObject({ classe: "ecarte", validation: "auto" });
    expect((await f.read()).current).not.toMatchObject({ scope: "workspace", classe: "ecarte" });
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
  it("should read a city in one set-based query without history or feedback", async () => {
    const f = await fixture();
    const second = await workspaceSignal(f, "Synthetic second signal");
    await f.write();
    await f.write({ signalRef: { ...f.ref, id: second.target.id }, text: "City note", model: "test-model" }, "auto", "annotate_signal");
    let queries = 0;
    const counting = { execute: async (...args: unknown[]) => { queries++; return (f.db as never as { execute: (...a: unknown[]) => unknown }).execute(...args); } };
    const city = await readSignalMcpCity(counting as never, f.contributor.sub, f.workspaceId, f.ref.citySlug);
    expect(queries).toBe(1);
    expect(city.size).toBe(2);
    const state = city.get(JSON.stringify([f.target.type, f.target.id]))!;
    expect(state.current).toMatchObject({ source: "mcp", classe: "pertinent" });
    expect(state.history).toEqual([]);
    expect(state.feedback).toEqual([]);
    expect(state.mcpHistory).toEqual([]);
    expect(city.get(JSON.stringify([second.target.type, second.target.id]))!.notes).toHaveLength(1);
    // The city version matches the detail read, so UI writes keep working.
    expect(state.version).toBe((await f.read()).version);
  });
  it("should refuse writes by non-members, revoked members and unapproved accounts", async () => {
    const f = await fixture();
    expect(await f.write(f.body, "auto", "classify_signal", f.outsider.sub))
      .toEqual({ error: "workspace_membership_required" });
    const revoked = { id: randomUUID(), sub: `synthetic-revoked-${randomUUID()}` };
    const pending = { id: randomUUID(), sub: `synthetic-pending-${randomUUID()}` };
    await f.pool.query("INSERT INTO account_users(id,sub,status) VALUES($1,$2,'approved'),($3,$4,'pending')",
      [revoked.id, revoked.sub, pending.id, pending.sub]);
    await f.pool.query(`INSERT INTO workspace_memberships(workspace_id,account_id,status,revoked_at)
      VALUES($1,$2,'revoked',now()),($1,$3,'active',NULL)`, [f.workspaceId, revoked.id, pending.id]);
    expect(await f.write(f.body, "auto", "classify_signal", revoked.sub))
      .toEqual({ error: "workspace_membership_required" });
    expect(await f.write(f.body, "auto", "classify_signal", pending.sub))
      .toEqual({ error: "workspace_membership_required" });
    expect((await f.pool.query("SELECT count(*)::int AS n FROM signal_mcp_events")).rows).toEqual([{ n: 0 }]);
  });
  it("should report signal_not_found and scoped_epoch_required on writes", async () => {
    const f = await fixture();
    const missing = { ...f.body, signalRef: { ...f.ref, id: randomUUID() } };
    expect(await f.write(missing)).toEqual({ error: "signal_not_found" });
    const dormant = await initializeWorkspaceStore(f.db, {
      workspaceSlug: `synthetic-${randomUUID()}`, workspaceLabel: "Synthetic dormant",
      approvedAccountIds: [f.contributor.id, f.moderator.id], managerAccountIds: [f.moderator.id],
      moderatorAccountIds: [f.moderator.id], actorAccountId: f.moderator.id, reason: "synthetic dormant",
    });
    const dormantBody = { ...f.body, signalRef: { ...f.ref, workspaceId: dormant.workspaceId } };
    const rows = await f.pool.query("SELECT signal_mcp_write_mcp($1,'test-client','classify_signal',$2::jsonb,$3,$4) AS result",
      [f.contributor.sub, JSON.stringify(dormantBody), "0".repeat(32), "a".repeat(64)]);
    expect(rows.rows[0].result).toEqual({ error: "scoped_epoch_required" });
  });
  it("should refuse a browser decision by a non-member", async () => {
    const f = await fixture();
    await f.write({ ...f.body, pendingHuman: true });
    const state = await f.read();
    await expect(decideSignalMcp(f.db, f.outsider.sub, f.ref, state.version, { classe: "pertinent", confirm: true }))
      .rejects.toThrow("workspace_membership_required");
  });
  it("should serialize two concurrent MCP writes on one version", async () => {
    const f = await fixture();
    const version = (await f.read()).version;
    const [first, second] = await Promise.all([
      f.write(f.body, "auto", "classify_signal", f.contributor.sub, version),
      f.write({ ...f.body, classe: "a_surveiller", reasonCode: "S-PLANIFIE" }, "auto", "classify_signal", f.contributor.sub, version),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((row) => row && "id" in row)).toHaveLength(1);
    expect(outcomes.filter((row) => row?.error === "annotation_version_conflict")).toHaveLength(1);
    expect((await f.read()).mcpHistory).toHaveLength(1);
  });
  it("should keep line breaks and tabs in notes while stripping other controls", async () => {
    const f = await fixture();
    await f.write({ signalRef: f.ref, text: "Line one\n\tTabbed\x07 end", model: "test-model" }, "auto", "annotate_signal");
    expect((await f.read()).notes[0]).toMatchObject({ text: "Line one\n\tTabbed end" });
  });
  it("should not confirm a shared archive without a reason code", async () => {
    const f = await fixture();
    await writeClassAnnotation(f.db, { citySlug: f.target.citySlug, nodeType: f.target.type, nodeId: f.target.id,
      classe: "ecarte", reason: "AI archive", source: "ai", model: "ai-model", effort: "low",
      promptId: "v1", promptSha256: "a".repeat(64), pipelineRunId: "run-1", inputSha256: "b".repeat(64) });
    const sharedRef = { ...f.ref, scope: "workspace" as const };
    const state = await readSignalMcp(f.db, f.moderator.sub, sharedRef);
    const hash = createHash("sha256").update("confirm-up").digest("hex");
    const rows = await f.pool.query("SELECT signal_mcp_write_mcp($1,'test-client','confirm_classification',$2::jsonb,$3,$4) AS result",
      [f.moderator.sub, JSON.stringify({ signalRef: sharedRef, verdict: "up", model: "test-model", pendingHuman: true }), state.version, hash]);
    expect(rows.rows[0].result).toEqual({ error: "reason_code_required" });
  });
  it("should hide moderator identity fields from members and audit workspace and target", async () => {
    const f = await fixture();
    const shared = { ...f.body, signalRef: { ...f.ref, scope: "workspace" }, classe: "ecarte", reasonCode: "N-NON-RES", pendingHuman: true };
    await f.write(shared, "auto", "classify_signal", f.moderator.sub);
    const member = await f.read(f.contributor.sub);
    expect(member.pendingShared).toMatchObject({ source: "mcp", classe: "ecarte" });
    expect(member.pendingShared).not.toHaveProperty("oauth_sub");
    expect(member.pendingShared).not.toHaveProperty("client_id");
    expect(member.pendingShared).not.toHaveProperty("actor_id");
    const audit = await f.pool.query(`SELECT workspace_id,city_slug,node_type,node_id,result FROM signal_mcp_audit
      WHERE tool='classify_signal' ORDER BY created_at DESC LIMIT 1`);
    expect(audit.rows[0]).toMatchObject({ workspace_id: f.workspaceId, city_slug: f.target.citySlug,
      node_type: f.target.type, node_id: f.target.id, result: "written" });
  });
  it("should let the by-city aggregate follow the detail when AI supersedes an automatic MCP class", async () => {
    const f = await fixture();
    await f.write();
    await writeClassAnnotation(f.db, { citySlug: f.target.citySlug, nodeType: f.target.type, nodeId: f.target.id,
      classe: "ecarte", reason: "Newer AI archive", source: "ai", model: "ai-model", effort: "low",
      promptId: "v1", promptSha256: "a".repeat(64), pipelineRunId: "run-1", inputSha256: "b".repeat(64) });
    expect((await f.read()).current).toMatchObject({ source: "ai", classe: "ecarte" });
    const result = await readScopedByCity(f.db, f.contributor.sub, f.workspaceId, { showDiscarded: false });
    const city = result.cities.find((entry) => entry.citySlug === f.target.citySlug)!;
    expect(city.signalCount).toBe(0);
    expect(Object.values(city.filtreCubesByClassement!.ecarte).reduce((n, c) => n + c, 0)).toBeGreaterThanOrEqual(1);
  });
  it("should grant the restricted role only the necessary signal writes", async () => {
    const f = await fixture();
    await f.pool.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='immo_mcp_signal_writer') THEN CREATE ROLE immo_mcp_signal_writer; END IF; END $$");
    await applyServiceRoleGrants(f.pool);
    const client = await f.pool.connect();
    try {
      const version = (await f.read()).version;
      await client.query("SET ROLE immo_mcp_signal_writer");
      const rows = await client.query("SELECT signal_mcp_write_mcp($1,'test-client','classify_signal',$2::jsonb,$3,$4) AS result",
        [f.contributor.sub, JSON.stringify(f.body), version, "a".repeat(64)]);
      expect(rows.rows[0].result).toHaveProperty("id");
      // list_class_reasons filters on profile_id under this same role.
      const reasons = await client.query("SELECT code,verdict FROM facet_reason_codes WHERE profile_id=$1 ORDER BY code",
        ["immo-steve-2026-09"]);
      expect(reasons.rows.length).toBeGreaterThan(0);
      expect(reasons.rows[0]).toHaveProperty("code");
      await expect(client.query("UPDATE account_users SET status='approved'")).rejects.toThrow(/permission denied/);
      await expect(client.query("DELETE FROM signal_mcp_events")).rejects.toThrow(/permission denied/);
      // No direct table access and no browser/core writer for the MCP role:
      // a forged human validation cannot be inserted or called into being.
      await expect(client.query(`INSERT INTO signal_mcp_events(workspace_id,actor_id,scope,city_slug,node_type,node_id,
        kind,source,oauth_sub,validation,classe,reason,previous_version)
        VALUES($1,$2,'personal',$3,$4,$5,'class','manual',$6,'human','pertinent','Forged','x')`,
        [f.workspaceId, f.contributor.id, f.target.citySlug, f.target.type, f.target.id, f.contributor.sub]))
        .rejects.toThrow(/permission denied/);
      await expect(client.query("SELECT id FROM signal_mcp_events")).rejects.toThrow(/permission denied/);
      await expect(client.query("SELECT id FROM facet_events")).rejects.toThrow(/permission denied/);
      await expect(client.query("SELECT signal_mcp_write_browser($1,$2::jsonb,$3,$4)",
        [f.contributor.sub, JSON.stringify(f.body), version, "a".repeat(64)])).rejects.toThrow(/permission denied/);
      await expect(client.query("SELECT signal_mcp_write_core($1,'c','classify_signal',$2::jsonb,'human',$3,$4,'manual')",
        [f.contributor.sub, JSON.stringify(f.body), version, "a".repeat(64)])).rejects.toThrow(/permission denied/);
    } finally { await client.query("RESET ROLE"); client.release(); }
  });
});
