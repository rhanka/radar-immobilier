import type pg from "pg";
import { isCommandCapability, type CanonicalScope, type CommandCapability, type ResourceRef } from "@sentropic/comments";
import type { AnnotationHostRepository, RegisteredResource } from "./host-ports.js";

/** Postgres owns immo assignments and source metadata, never canonical contents. */
export class PgAnnotationHostRepository implements AnnotationHostRepository {
  constructor(private readonly database: Pick<pg.Pool, "query">) {}

  async hasCapability(principal: string, scope: CanonicalScope, capability: CommandCapability): Promise<boolean> {
    if (!isCommandCapability(capability)) return false;
    const result = await this.database.query(
      `SELECT 1 FROM annotation_memberships m
       JOIN account_users u ON u.sub = m.principal AND u.status = 'approved'
       JOIN annotation_workspaces w ON w.id = m.workspace_id AND w.tenant_id = m.tenant_id
       JOIN annotation_tenants t ON t.id = w.tenant_id
       WHERE m.principal = $1 AND m.tenant_id = $2 AND m.workspace_id = $3
         AND m.revoked_at IS NULL AND w.revoked_at IS NULL AND t.revoked_at IS NULL
         AND $4 = ANY(m.capabilities) LIMIT 1`,
      [principal, scope.tenantId, scope.workspaceId, capability],
    );
    return result.rows.length === 1;
  }

  async resources(ref: ResourceRef): Promise<readonly RegisteredResource[]> {
    const result = await this.database.query<{
      source_version: string; frozen_digest: string; current_digest: string | null;
      unavailable_at: Date | null;
    }>(
      `SELECT source_version, frozen_digest, current_digest, unavailable_at
       FROM annotation_resources WHERE tenant_id = $1 AND workspace_id = $2
         AND namespace = $3 AND kind = $4 AND resource_id = $5`,
      [ref.scope.tenantId, ref.scope.workspaceId, ref.namespace, ref.kind, ref.id],
    );
    return result.rows.map((r) => ({ ref, sourceVersion: r.source_version,
      frozenDigest: r.frozen_digest, currentDigest: r.current_digest,
      available: r.unavailable_at === null }));
  }
}
