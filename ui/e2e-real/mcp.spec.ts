import { request as playwrightRequest } from "@playwright/test";
import { expect, seed, stateFor, test } from "./fixtures";

// Local probe of the scoped search_signals facade with
// MCP_SIGNAL_SEARCH_ENABLED=1 (docker-compose.e2e.yml). The OAuth token
// exchange of the real MCP server is out of reach locally (unverified here).
const SEARCH = "/api/v1/mcp/facets/signals/search";

function contextFor(role: "member" | "outsider") {
  return playwrightRequest.newContext({
    baseURL: process.env.PLAYWRIGHT_UI_BASE_URL ?? "http://localhost:8080",
    storageState: stateFor(role),
  });
}

test("mcp: the member gets the seeded signals, identical to the coherent read", async () => {
  const api = await contextFor("member");
  try {
    const search = await api.get(`${SEARCH}?city=${seed.city}`);
    expect(search.status()).toBe(200);
    const body = await search.json() as { workspaceId: string; signals: Array<{ id: string }> };
    expect(body.workspaceId).toBe(seed.workspaceId);
    const coherent = await api.get(
      `/api/v1/workspaces/${seed.workspaceId}/signal-facets/coherent-city?citySlug=${seed.city}&mode=signal`);
    const city = await coherent.json() as { signals: Array<{ id: string }> };
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();
    expect(ids(body.signals)).toEqual(ids(city.signals));
    expect(ids(body.signals)).toEqual(ids(seed.signals));
  } finally {
    await api.dispose();
  }
});

test("mcp: an approved account without membership gets a typed refusal and no data", async () => {
  const api = await contextFor("outsider");
  try {
    const search = await api.get(`${SEARCH}?city=${seed.city}`);
    expect(search.status()).toBeGreaterThanOrEqual(400);
    const body = await search.json() as Record<string, unknown>;
    expect(["workspace_missing", "workspace_not_authorized"]).toContain(body.error);
    expect(body).not.toHaveProperty("signals");
  } finally {
    await api.dispose();
  }
});
