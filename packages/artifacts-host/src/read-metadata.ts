import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";
import type { ArtifactApp, HttpAppDeps, HttpRequest } from "@sentropic/artifacts/http";

interface MetadataRow {
  id: string; binding_name: string; created_at: Date; lifecycle_state: string;
  release_id: string | null; published_at: Date | null; current_digest: string | null;
}

/** Local projection shared by MCP and HTTP; upstream still authorizes every read. */
export function createArtifactReadMetadata(pool: Pick<pg.Pool, "query">, scope: string,
  urls?: HttpAppDeps["publicationUrls"]) {
  const snapshots = new AsyncLocalStorage<Map<string, MetadataRow>>();
  async function read(ids: string[] | null) {
    const result = await pool.query<MetadataRow>(
      `SELECT a.id, a.binding_name, a.created_at, a.lifecycle_state,
         r.id AS release_id, r.created_at AS published_at, r.manifest_digest AS current_digest
       FROM artifacts.artifacts a
       LEFT JOIN artifacts.artifact_current c ON c.artifact_id=a.id
       LEFT JOIN artifacts.releases r ON r.id=c.release_id AND r.artifact_id=a.id
       WHERE a.storage_scope_id=$1 AND ($2::uuid[] IS NULL OR a.id=ANY($2::uuid[]))
       ORDER BY r.created_at DESC NULLS LAST, a.created_at DESC, a.id ASC`, [scope, ids]);
    for (const row of result.rows) snapshots.getStore()?.set(row.id, row);
    return result.rows;
  }
  function summary(row: MetadataRow) {
    const links = urls?.(row.id, row.release_id ?? "");
    return { artifactId: row.id, bindingName: row.binding_name,
      stableUrl: links?.stableUrl ?? null, pinnedUrl: row.release_id ? links?.pinnedUrl ?? null : null,
      currentReleaseId: row.release_id, createdAt: row.created_at.toISOString(),
      updatedAt: row.published_at?.toISOString() ?? null, state: row.lifecycle_state,
      published: row.release_id !== null };
  }
  return {
    // The upstream app filters this ordered inventory for visibility before paginating.
    async listArtifactIds() { return (await read(null)).map((row) => row.id); },
    async project(request: HttpRequest, dispatch: () => ReturnType<ArtifactApp["execute"]>): ReturnType<ArtifactApp["execute"]> {
      const list = request.method === "POST" && request.path === "/list";
      const get = request.method === "GET" && /^\/meta\/[^/]+$/.test(request.path);
      if (!list && !get) return dispatch();
      return snapshots.run(new Map(), async () => {
        const outcome = await dispatch();
        if (!outcome.ok) return outcome;
        const body = outcome.result.body as Record<string, unknown>;
        const items = list ? body.artifacts as Record<string, unknown>[] : [body];
        if (!list) await read(items.map((item) => String(item.artifactId)));
        const enriched = items.map((item) => {
          const row = snapshots.getStore()!.get(String(item.artifactId));
          if (!row) throw new Error("artifact read metadata unavailable");
          return { ...item, ...summary(row),
            ...(Object.hasOwn(item, "digest") ? { digest: row.current_digest } : {}) };
        });
        return { ...outcome, result: { ...outcome.result,
          body: list ? { ...body, artifacts: enriched } : enriched[0] } };
      });
    },
  };
}
