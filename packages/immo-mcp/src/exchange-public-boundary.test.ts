import { expect, it } from "vitest";
import { bindExchangeInput, buildExchangeInput, runWithExchangeDeps } from "./authorized-egress.js";
import { captureInvocationContext } from "./invocation-context.js";
import { HttpDataSource } from "./data-source.js";
import { MockRawDataSource } from "./raw-data.js";
import { TOOL_HANDLERS } from "./tool-handlers.js";
import { createIsolatedExchangeFixture, exchangeDepsFor, signSubjectToken, TEST_SCOPES } from "./test-exchange-fixtures.js";

const publicTools = ["get_zones_geojson", "get_lots_geojson", "get_grille_pdf", "get_pv_pdf", "get_reglement_provenance", "query_zoning_events"];
const stubs = ["search_lots", "get_lot_card", "get_opportunity_dossier", "list_documents", "read_document_excerpt"];

it.each([...publicTools, ...stubs])("%s performs no exchange with full authenticated authority", async (name) => {
  const fixture = await createIsolatedExchangeFixture();
  const subject = await signSubjectToken(fixture.subjectPrivateKey);
  const ctx = captureInvocationContext({ auth: { sub: "user-1", userId: "user-1", tenantId: "radar",
    roles: ["viewer"], scopes: TEST_SCOPES.split(" "), workspaces: ["default"], dataMode: "real", audience: fixture.config.mcpResource,
  }, data: new HttpDataSource({ baseUrl: "https://unreachable.example.test", fetchImpl: async () => { throw new Error("unexpected_api_call"); } }),
    raw: new MockRawDataSource(),
  });
  bindExchangeInput(ctx, buildExchangeInput({ subjectToken: subject, subjectSub: "user-1",
    subjectExp: Math.floor(Date.now() / 1000) + 300, subjectScopes: TEST_SCOPES.split(" "),
    issuer: fixture.config.issuer, membership: "radar:default" }));
  const result = runWithExchangeDeps(exchangeDepsFor(fixture), () => TOOL_HANDLERS[name]!({
    city: "longueuil", muni_slug: "longueuil", limit: 2, zone: "H-001", rawRef: "synthetic",
    no_lot: "synthetic", opportunityId: "synthetic", documentId: "synthetic", offset: 0, maxChars: 100,
  }, ctx));
  if (stubs.includes(name)) await expect(result).rejects.toThrow(/not_wired_yet/);
  else expect(JSON.stringify(await result)).not.toContain(subject);
  expect(fixture.issuedExchangedTokens).toHaveLength(0);
  expect(JSON.stringify(ctx)).not.toContain(subject);
});
