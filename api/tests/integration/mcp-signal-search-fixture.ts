/** Test-only mounting on the real createApp; production wiring stays absent. */
import { vi } from "vitest";
import type { ObjectStore } from "../../src/storage/object-store.js";
import type { McpSignalSearchArgs } from "../../src/routes/mcp-signal-search.js";
import { decodeMcpSignalSearch, MCP_SIGNAL_SEARCH_PATH } from "../../src/routes/mcp-signal-search.js";
import { ScopeError } from "../../src/services/facets/scope.js";
import { WorkspaceError } from "../../src/services/workspaces/types.js";
import { httpFixture } from "./base-api-http-fixture.js";

export async function searchFixture() {
  const f = await httpFixture();
  const head = vi.fn(async () => null);
  const store = { head } as unknown as ObjectStore;
  const memberships = async (ids: string[]) => {
    await f.data.pool.query(`UPDATE workspace_memberships SET
      status = CASE WHEN workspace_id = ANY($1::uuid[]) THEN 'active' ELSE 'revoked' END,
      revoked_at = CASE WHEN workspace_id = ANY($1::uuid[]) THEN NULL ELSE now() END,
      revision = revision + 1 WHERE account_id = $2 AND status IS DISTINCT FROM
        CASE WHEN workspace_id = ANY($1::uuid[]) THEN 'active' ELSE 'revoked' END`,
    [ids, f.data.contributor.id]);
  };
  await memberships([f.data.workspaceId]);
  const mount = (read: (sub: string, args: McpSignalSearchArgs) => Promise<unknown>) => {
    f.app.get(MCP_SIGNAL_SEARCH_PATH, async (c) => {
      const session = c.get("session" as never) as { sub: string };
      try {
        const args = decodeMcpSignalSearch(new URL(c.req.url).searchParams);
        const result = await read(session.sub, args);
        return c.json({ ok: true, result } as never);
      } catch (error) {
        if (error instanceof ScopeError || error instanceof WorkspaceError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    });
  };
  const request = (query = "", sub = f.data.contributor.sub) => f.request(
    `${MCP_SIGNAL_SEARCH_PATH}?city=synthetic-city${query}`, sub);
  return { ...f, store, head, memberships, mount, search: request };
}
export type SearchFixture = Awaited<ReturnType<typeof searchFixture>>;

export function barrier() {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  return { waiting, release };
}

export async function businessSnapshot(f: SearchFixture) {
  const tables = ["facet_events", "facet_heads", "facet_streams", "facet_event_bindings",
    "facet_activation_state", "personal_projection_revisions", "workspace_projection_revisions", "prospect_marks"];
  return Promise.all(tables.map(async (table) => (await f.data.pool.query(
    `SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS state FROM ${table} t`)).rows));
}
