import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex } from "@sentropic/comments";
import { loadConfig } from "../../src/config.js";
import { createDb } from "../../src/db/client.js";
import { PgAnnotationHostRepository } from "../../src/services/annotations/pg-host-repository.js";
import { createAnnotationHostPorts, snapshotResource } from "../../src/services/annotations/host-ports.js";

const { pool } = createDb(loadConfig());
const scope = { tenantId: "annotation-integration-tenant", workspaceId: "annotation-integration-workspace" };
const principal = "annotation-integration-subject";
const ref = snapshotResource({ scope, namespace: "immo.position", citySlug: "synthetic-city",
  kind: "manual-position", nativeId: "pin-1", sourceVersion: "snapshot-1" });
const digest = sha256Hex(canonicalJson({ coordinates: ["45.50", "-73.50"], crs: "EPSG:4326", unit: "degrees", precision: "0.01" }));
const repository = new PgAnnotationHostRepository(pool);
const host = createAnnotationHostPorts(repository);

beforeAll(async () => {
  await pool.query("INSERT INTO account_users(sub, status, is_admin) VALUES ($1, 'approved', true)", [principal]);
  await pool.query("INSERT INTO annotation_tenants(id, assignment_ref, assigned_by) VALUES ($1, 'synthetic-proof', 'fixture-authority')", [scope.tenantId]);
  await pool.query(`INSERT INTO annotation_workspaces(id, tenant_id, assignment_ref, assigned_by)
    VALUES ($1, $2, 'synthetic-proof', 'fixture-authority')`, [scope.workspaceId, scope.tenantId]);
  await pool.query(`INSERT INTO annotation_memberships(tenant_id, workspace_id, principal, capabilities, assignment_ref, assigned_by)
    VALUES ($1, $2, $3, ARRAY['read','comment'], 'synthetic-proof', 'fixture-authority')`, [scope.tenantId, scope.workspaceId, principal]);
  await pool.query(`INSERT INTO annotation_resources(tenant_id, workspace_id, namespace, kind, resource_id,
    source_version, frozen_digest, current_digest, source_locator, assignment_ref, assigned_by)
    VALUES ($1, $2, $3, $4, $5, 'snapshot-1', $6, $6, 'synthetic-source#pin-1', 'synthetic-proof', 'fixture-authority')`,
  [scope.tenantId, scope.workspaceId, ref.namespace, ref.kind, ref.id, digest]);
});
afterAll(async () => {
  await pool.query("DELETE FROM annotation_resources WHERE tenant_id = $1", [scope.tenantId]);
  await pool.query("DELETE FROM annotation_memberships WHERE tenant_id = $1", [scope.tenantId]);
  await pool.query("DELETE FROM annotation_workspaces WHERE tenant_id = $1", [scope.tenantId]);
  await pool.query("DELETE FROM annotation_tenants WHERE id = $1", [scope.tenantId]);
  await pool.query("DELETE FROM account_users WHERE sub = $1", [principal]);
  await pool.end();
});

describe("authoritative immo assignments in Postgres", () => {
  it("should grant explicit capabilities without granting review to an admin", async () => {
    expect(await host.capabilities.check(principal, "comment", [ref])).toBe(true);
    expect(await host.capabilities.check(principal, "review", [ref])).toBe(false);
    expect(await host.capabilities.check(principal, "read", [{ ...ref, scope: { ...scope, workspaceId: "absent" } }])).toBe(false);
  });
  it("should invalidate a geographic digest without requiring a capture", async () => {
    expect(await host.resolver.resolve(principal, ref)).toBe("exact");
    await pool.query("UPDATE annotation_resources SET current_digest = $1 WHERE tenant_id = $2", ["b".repeat(64), scope.tenantId]);
    expect(await host.resolver.resolve(principal, ref)).toBe("source-changed");
    await pool.query("UPDATE annotation_resources SET current_digest = frozen_digest WHERE tenant_id = $1", [scope.tenantId]);
  });
  it("should recheck account, membership and workspace revocations on each call", async () => {
    await pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = $1", [principal]);
    expect(await host.capabilities.check(principal, "read", [ref])).toBe(false);
    await pool.query("UPDATE account_users SET status = 'approved' WHERE sub = $1", [principal]);
    await pool.query("UPDATE annotation_memberships SET revoked_at = now() WHERE principal = $1", [principal]);
    expect(await host.resolver.resolve(principal, ref)).toBe("unavailable");
    await pool.query("UPDATE annotation_memberships SET revoked_at = NULL WHERE principal = $1", [principal]);
    await pool.query("UPDATE annotation_workspaces SET revoked_at = now() WHERE id = $1", [scope.workspaceId]);
    expect(await host.capabilities.check(principal, "read", [ref])).toBe(false);
  });
});
