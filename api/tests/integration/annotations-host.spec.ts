import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalJson, sha256Hex, COMMAND_CAPABILITIES } from "@sentropic/comments";
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
let membershipId: string;

beforeAll(async () => {
  await pool.query("INSERT INTO account_users(sub, status, is_admin) VALUES ($1, 'approved', true)", [principal]);
  await pool.query("INSERT INTO annotation_tenants(id, assignment_ref, assigned_by) VALUES ($1, 'synthetic-proof', 'fixture-authority')", [scope.tenantId]);
  await pool.query(`INSERT INTO annotation_workspaces(id, tenant_id, assignment_ref, assigned_by)
    VALUES ($1, $2, 'synthetic-proof', 'fixture-authority')`, [scope.workspaceId, scope.tenantId]);
  const membership = await pool.query(`INSERT INTO annotation_memberships(tenant_id, workspace_id, principal, capabilities, assignment_ref, assigned_by)
    VALUES ($1, $2, $3, ARRAY['read','comment'], 'synthetic-proof', 'fixture-authority') RETURNING id`, [scope.tenantId, scope.workspaceId, principal]);
  membershipId = membership.rows[0].id;
  await pool.query(`INSERT INTO annotation_resources(tenant_id, workspace_id, namespace, kind, resource_id,
    source_version, frozen_digest, current_digest, source_locator, assignment_ref, assigned_by)
    VALUES ($1, $2, $3, $4, $5, 'snapshot-1', $6, $6, 'synthetic-source#pin-1', 'synthetic-proof', 'fixture-authority')`,
  [scope.tenantId, scope.workspaceId, ref.namespace, ref.kind, ref.id, digest]);
});
afterAll(async () => {
  await pool.query("DELETE FROM annotation_resource_links WHERE tenant_id = $1", [scope.tenantId]);
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
  it("should retain assignment history and match the shared capability vocabulary", async () => {
    await pool.query("UPDATE annotation_memberships SET capabilities = ARRAY['read'] WHERE principal = $1", [principal]);
    const history = await pool.query(`SELECT previous_state, assigned_state FROM annotation_assignment_history
      WHERE entity_kind = 'annotation_memberships' AND assigned_state->>'id' = $1 ORDER BY sequence`, [membershipId]);
    expect(history.rows.map((r) => r.assigned_state.capabilities)).toEqual([["read", "comment"], ["read"]]);
    expect(history.rows[1].previous_state.capabilities).toEqual(["read", "comment"]);
    await expect(pool.query("UPDATE annotation_assignment_history SET operation = 'DELETE'")).rejects.toThrow(/append-only/);
    await pool.query("UPDATE annotation_memberships SET capabilities = ARRAY['read','comment'] WHERE principal = $1", [principal]);
    const constraint = await pool.query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'annotation_memberships'::regclass AND conname = 'annotation_memberships_capabilities_check'`);
    const names = [...constraint.rows[0].definition.matchAll(/'([^']+)'::text/g)].map((match) => match[1]);
    expect(names.sort()).toEqual([...COMMAND_CAPABILITIES].sort());
  });
  it("should link distinct source versions with evidence instead of editing a registered snapshot", async () => {
    const next = snapshotResource({ scope, namespace: ref.namespace, citySlug: "synthetic-city",
      kind: ref.kind, nativeId: "pin-1", sourceVersion: "snapshot-2" });
    await pool.query(`INSERT INTO annotation_resources(tenant_id, workspace_id, namespace, kind, resource_id,
      source_version, frozen_digest, current_digest, source_locator, assignment_ref, assigned_by)
      VALUES ($1,$2,$3,$4,$5,'snapshot-2',$6,$6,'synthetic-source#pin-1','synthetic-proof','fixture-authority')`,
    [scope.tenantId, scope.workspaceId, next.namespace, next.kind, next.id, "b".repeat(64)]);
    await pool.query(`INSERT INTO annotation_resource_links(tenant_id,workspace_id,from_namespace,from_kind,from_id,
      to_namespace,to_kind,to_id,relation,evidence_ref) VALUES ($1,$2,$3,$4,$5,$3,$4,$6,'same-native-object','synthetic-link-proof')`,
    [scope.tenantId, scope.workspaceId, ref.namespace, ref.kind, ref.id, next.id]);
    expect(await repository.resourceLinks(ref)).toEqual([{ target: next, relation: "same-native-object",
      evidenceRef: "synthetic-link-proof", canonicalConversionRef: null }]);
    await expect(pool.query("UPDATE annotation_resources SET source_version = 'snapshot-3' WHERE resource_id = $1", [ref.id]))
      .rejects.toThrow(/snapshots are immutable/);
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
