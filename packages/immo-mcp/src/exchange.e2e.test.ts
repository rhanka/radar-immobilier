import { expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { serviceFixture } from "../../../tools/exchange-issuer/service-fixture.js";
import { signSubjectToken, TEST_ISSUER } from "./test-exchange-fixtures.js";

it("exchanges over HTTP across isolated issuer, MCP and synthetic receiver without cookies", async () => {
  const f = await serviceFixture();
  const audit = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  let session: string | null = null;
  let id = 0;
  const rpc = (method: string, params: unknown, token = f.subject) => fetch(`${f.mcpUrl}/mcp`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`, ...(session ? { "mcp-session-id": session } : {}),
    }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const call = (name: string, args: unknown, token = f.subject) => rpc("tools/call", { name, arguments: args }, token);
  try {
    for (const authorization of [undefined, "Basic invalid"]) {
      const response = await fetch(`${f.issuerUrl}/token`, { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...(authorization ? { authorization } : {}) },
        body: new URLSearchParams({ subject_token: f.subject }),
      });
      expect(response.status).toBe(401);
      expect(f.issuer.issued).toHaveLength(0);
    }
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "isolated-a2", version: "1" } });
    expect(init.status).toBe(200);
    session = init.headers.get("mcp-session-id");
    expect(session).toBeTruthy();
    const inventory = await (await rpc("tools/list", {})).json();
    expect(inventory.result.tools).toHaveLength(12);
    const search = await (await call("search_signals", { city: "longueuil" })).json();
    expect(search.result.isError).not.toBe(true);
    expect(JSON.stringify(search)).toContain("synthetic-signal");
    expect(JSON.stringify(search)).not.toContain(f.subject);
    expect(f.issuer.issued).toHaveLength(1);
    expect(f.seen).toEqual(f.issuer.issued);
    expect(f.seen).not.toContain(f.subject);
    const direct = await fetch(`${f.radarUrl}/api/graph-signals/longueuil`, { headers: { authorization: `Bearer ${f.subject}` } });
    expect(direct.status).toBe(401);
    const delegatedAtMcp = await rpc("tools/list", {}, f.issuer.issued[0]);
    expect(delegatedAtMcp.status).toBe(401);
    const wrongRadarAudience = await new SignJWT({ scope: "immo:search", client_id: "immo-mcp-workload", act: { sub: "immo-mcp-workload" } })
      .setProtectedHeader({ alg: "RS256", typ: "at+jwt" })
      .setIssuer(TEST_ISSUER).setSubject("user-1").setAudience("https://wrong-audience.test")
      .setIssuedAt().setExpirationTime("60s").sign(f.issuerPrivateKey);
    const wrongAudDirect = await fetch(`${f.radarUrl}/api/graph-signals/longueuil`, { headers: { authorization: `Bearer ${wrongRadarAudience}` } });
    expect(wrongAudDirect.status).toBe(401);
    const wrongMcpAudience = await signSubjectToken(f.subjectPrivateKey, { audience: "https://wrong-mcp.test" });
    const wrongAudMcp = await rpc("tools/list", {}, wrongMcpAudience);
    expect(wrongAudMcp.status).toBe(401);
    const reduced = await (await call("search_signals", { city: "longueuil" }, f.reduced)).json();
    expect(reduced.result.isError).toBe(true);
    expect(JSON.stringify(reduced)).toContain("scope_denied");
    for (const [name, args] of [
      ["get_zones_geojson", { city: "longueuil" }], ["get_lots_geojson", { city: "longueuil" }],
      ["get_grille_pdf", { city: "longueuil", zone: "H-001" }], ["get_pv_pdf", { rawRef: "synthetic" }],
      ["get_reglement_provenance", { muni_slug: "longueuil" }], ["query_zoning_events", { muni_slug: "longueuil" }],
    ] as const) await (await call(name, args)).json();
    for (const [name, args] of [
      ["search_lots", { city: "longueuil" }], ["get_lot_card", { city: "longueuil", no_lot: "synthetic" }],
      ["get_opportunity_dossier", { city: "longueuil", opportunityId: "synthetic" }],
      ["list_documents", {}], ["read_document_excerpt", { documentId: "synthetic" }],
    ] as const) {
      const result = await (await call(name, args)).json();
      expect(JSON.stringify(result)).toContain("not_wired_yet");
    }
    expect(f.issuer.issued).toHaveLength(1);
    expect(f.seen).toHaveLength(1);
    expect(JSON.stringify(audit.mock.calls)).not.toContain(f.subject);
    console.log("[P4] real loopback HTTP: synthetic issuer, MCP, receiver; 12 tools; no cookies");
  } finally { audit.mockRestore(); await f.close(); }
});
