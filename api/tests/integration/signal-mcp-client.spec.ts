import { describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { workspaceFixture, workspaceSignal } from "../../src/services/facets/workspace-archive-fixture.js";
import { createImmoHttpApp } from "../../../packages/immo-mcp/src/server-http.js";
import { accountAuthorizer } from "../../../packages/immo-mcp/src/account-binding.js";

const issuer = "https://auth.synthetic.test";
const resource = "https://immo.synthetic.test/mcp";
async function fixture(scopes = "immo:read immo:signals:write", accept = true, supportsElicitation = true) {
  const f = await workspaceFixture();
  const { target } = await workspaceSignal(f);
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const token = await new SignJWT({ scope: scopes, client_id: "test-mcp-client", workspaces: [f.workspaceId] })
    .setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setAudience(resource)
    .setSubject(f.contributor.sub).setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const app = createImmoHttpApp({ issuer, resource, requiredScopes: ["immo:read"],
    scopesSupported: ["immo:read", "immo:signals:write"], port: 0, dataMode: "simulation",
    sessionIdleTimeoutMs: 60000, sessionMaxLifetimeMs: 60000 }, {
    signals: f.pool, keySource: { resolveKey: async () => publicKey } as never, authorize: accountAuthorizer(f.pool),
  });
  let elicitations = 0;
  const client = new Client({ name: "signal-write-test", version: "1" }, {
    capabilities: supportsElicitation ? { elicitation: { form: {} } } : {} });
  if (supportsElicitation) client.setRequestHandler(ElicitRequestSchema, async (request) => {
    elicitations++;
    expect(request.params.message).toContain('"version"');
    expect(request.params.message).toContain(target.id);
    return accept ? { action: "accept", content: { confirm: true } } : { action: "decline" };
  });
  const transport = new StreamableHTTPClientTransport(new URL(resource), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (input, init) => app.fetch(new Request(input, init)),
  });
  await client.connect(transport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    return JSON.parse((response.content as { text: string }[])[0]!.text);
  };
  const signalRef = { ...target, workspaceId: f.workspaceId, scope: "personal" };
  const input = { signalRef, classe: "pertinent", reasonCode: "P-DENSITE", reason: "More units", model: "sdk-client-model" };
  return { ...f, client, transport, signalRef, input, call, elicitations: () => elicitations };
}
describe.skipIf(process.env.MCP_SIGNAL_DB_TEST !== "1")("MCP SDK to PostgreSQL", () => {
  it("should deny absent write consent despite artifact write consent", async () => {
    const f = await fixture("immo:read immo:artifacts:write");
    const logged = vi.spyOn(process.stderr, "write");
    try {
      expect(await f.call("classify_signal", f.input)).toMatchObject({ error: expect.stringContaining("scope_denied") });
      expect((await f.pool.query("SELECT * FROM signal_mcp_events")).rows).toHaveLength(0);
      const attempts = logged.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"kind":"immo-mcp.signal-write"')).map((line) => JSON.parse(line));
      expect(attempts).toContainEqual(expect.objectContaining({ clientId: "test-mcp-client", model: "sdk-client-model",
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/), result: "refused:scope" }));
    } finally { logged.mockRestore(); await f.transport.terminateSession(); await f.client.close(); }
  });
  it("should record accepted elicitation as human with mcp+elicitation source tag and full trace, while keeping unelicited writes auto", async () => {
    const f = await fixture();
    try {
      const listed = await f.client.listTools();
      expect(listed.tools.find((tool) => tool.name === "classify_signal")?.annotations?.readOnlyHint).toBe(false);
      const codes = await f.call("list_class_reasons", {});
      expect(Object.keys(codes.classes)).toHaveLength(4);
      expect(codes.reasons).toHaveLength(28);
      expect(codes.reasons.every((row: { definition: string }) => !!row.definition)).toBe(true);

      // Without elicitation: stays source=mcp, sourceTag=mcp, validation=auto.
      expect(await f.call("classify_signal", f.input)).toMatchObject({ id: expect.any(String), validation: "auto", sourceTag: "mcp" });
      expect(f.elicitations()).toBe(0);
      expect(await f.call("annotate_signal", { signalRef: f.signalRef, text: "<b>Watch</b> council", model: "sdk-client-model" }))
        .toMatchObject({ validation: "auto" });
      const autoState = await f.call("get_signal_classification", { signalRef: f.signalRef });
      expect(autoState.current).toMatchObject({
        source: "mcp", sourceTag: "mcp", model: "sdk-client-model", validation: "auto",
        mcpClientId: "test-mcp-client", elicitationId: null,
      });
      expect(autoState.current).toHaveProperty("effort", null);
      expect(autoState.current).toHaveProperty("promptId", null);
      expect(autoState.notes[0].text).toBe("Watch council");

      // With accepted elicitation: becomes validation=human, sourceTag=mcp+elicitation + trace.
      const elicited = await f.call("classify_signal", { ...f.input, humanConfirmed: true });
      expect(elicited).toMatchObject({
        id: expect.any(String), validation: "human", sourceTag: "mcp+elicitation",
        elicitationId: expect.any(String), elicitationAcceptedAt: expect.any(String),
      });
      expect(f.elicitations()).toBe(1);
      const humanState = await f.call("get_signal_classification", { signalRef: f.signalRef });
      expect(humanState.current).toMatchObject({
        source: "mcp", sourceTag: "mcp+elicitation", validation: "human", pending_human: false,
        elicitationId: elicited.elicitationId, user: f.contributor.sub, actor_id: f.contributor.id,
      });
      expect(humanState.current.elicitationAcceptedAt).toBeTruthy();

      // Automatic MCP write cannot overwrite an mcp+elicitation human class.
      expect(await f.call("classify_signal", f.input)).toEqual({ error: "classification_priority_conflict" });

      // Negative feedback without reclassification is refused before elicitation.
      expect(await f.call("confirm_classification", { signalRef: f.signalRef, verdict: "down", model: "sdk-client-model" }))
        .toEqual({ error: "reclassification_required" });

      // confirm_classification with accepted elicitation records human + mcp+elicitation.
      expect(await f.call("confirm_classification", { signalRef: f.signalRef, verdict: "up", model: "sdk-client-model" }))
        .toMatchObject({ validation: "human", sourceTag: "mcp+elicitation", elicitationId: expect.any(String) });
      expect(await f.call("confirm_classification", { signalRef: f.signalRef, verdict: "down", model: "sdk-client-model",
        newClasse: "a_surveiller", reasonCode: "S-PLANIFIE", reason: "Wait for adoption" }))
        .toMatchObject({ validation: "human", sourceTag: "mcp+elicitation", elicitationId: expect.any(String) });
      const corrected = await f.call("get_signal_classification", { signalRef: f.signalRef });
      expect(corrected.current).toMatchObject({
        classe: "a_surveiller", reasonCode: "S-PLANIFIE", validation: "human", sourceTag: "mcp+elicitation",
      });
      expect(corrected.feedback.map((row: { verdict: string }) => row.verdict)).toEqual(["down", "up"]);

      const auditRows = (await f.pool.query("SELECT result, elicitation_status, elicitation_id FROM signal_mcp_audit")).rows;
      expect(auditRows.map((row) => row.result)).toEqual(expect.arrayContaining(["written", "reclassification_required"]));
      expect(auditRows.some((row) => row.elicitation_status === "accepted" && row.elicitation_id === elicited.elicitationId)).toBe(true);

      const dbEvents = (await f.pool.query(
        "SELECT source, source_tag, validation, actor_id, oauth_sub, elicitation_id, elicitation_accepted_at FROM signal_mcp_events WHERE kind IN ('class','feedback') ORDER BY created_at",
      )).rows;
      expect(dbEvents[0]).toMatchObject({ source: "mcp", source_tag: "mcp", validation: "auto", elicitation_id: null, elicitation_accepted_at: null });
      expect(dbEvents.slice(1).every((row) =>
        row.source === "mcp" && row.source_tag === "mcp+elicitation" && row.validation === "human"
        && row.actor_id === f.contributor.id && row.oauth_sub === f.contributor.sub
        && typeof row.elicitation_id === "string" && row.elicitation_accepted_at !== null)).toBe(true);
    } finally { await f.transport.terminateSession(); await f.client.close(); }
  });
  it("should keep declined classification automatic and refuse unconfirmed feedback", async () => {
    const f = await fixture(undefined, false);
    try {
      expect(await f.call("classify_signal", { ...f.input, humanConfirmed: true })).toMatchObject({ validation: "auto", sourceTag: "mcp" });
      expect(await f.call("confirm_classification", { signalRef: f.signalRef, verdict: "up", model: "sdk-client-model" }))
        .toEqual({ error: "human_confirmation_required" });
      expect(f.elicitations()).toBe(2);
      const declinedAudit = (await f.pool.query("SELECT elicitation_status FROM signal_mcp_audit WHERE elicitation_status='declined'")).rows;
      expect(declinedAudit.length).toBeGreaterThanOrEqual(2);
    } finally { await f.transport.terminateSession(); await f.client.close(); }
  });
  it("should keep a requested confirmation automatic when the client lacks elicitation", async () => {
    const f = await fixture(undefined, true, false);
    try {
      expect(await f.call("classify_signal", { ...f.input, humanConfirmed: true })).toMatchObject({ validation: "auto", sourceTag: "mcp" });
      expect(f.elicitations()).toBe(0);
    } finally { await f.transport.terminateSession(); await f.client.close(); }
  });
  it("should reject acceptance when the signal changed during elicitation", async () => {
    const f = await fixture();
    try {
      f.client.setRequestHandler(ElicitRequestSchema, async () => {
        await f.pool.query("UPDATE graph_nodes SET label=label || ' changed' WHERE id=$1", [f.signalRef.id]);
        return { action: "accept", content: { confirm: true } };
      });
      expect(await f.call("classify_signal", { ...f.input, humanConfirmed: true })).toEqual({ error: "annotation_version_conflict" });
      expect((await f.pool.query("SELECT * FROM signal_mcp_events")).rows).toHaveLength(0);
    } finally { await f.transport.terminateSession(); await f.client.close(); }
  });
});
