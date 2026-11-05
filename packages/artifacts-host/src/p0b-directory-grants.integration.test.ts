import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { composeArtifactHost } from "./composition.js";
import { createAccountDirectory } from "./directory.js";
import { createDeleteConfirmation } from "./delete-confirmation.js";
import { createArtifactControl } from "./facade.js";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";
import {
  applyServiceRoleGrants,
  IMMO_MCP_ARTIFACT_WRITER_ROLE,
} from "../../../api/src/db/service-role-grants.js";

/**
 * Preprod regression (post-#1004): the MCP process runs as
 * `immo_mcp_artifact_writer` (column SELECT on `id, sub, status` only), but
 * principal resolution selected `name, email` — every write failed with
 * `permission denied for table account_users`.
 *
 * This test connects AS the writer role with exactly the production grants
 * and drives ensure/publish/list/list_versions through the MCP control path.
 * It fails on origin/main (permission denied on the name/email projection)
 * and passes with the least-privilege resolution.
 */

const WRITER_PASSWORD = "writer-test-only-pw";
const v2 = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.v2",
  requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });

function writerUrlFrom(superuserUrl: string): string {
  const url = new URL(superuserUrl);
  url.username = IMMO_MCP_ARTIFACT_WRITER_ROLE;
  url.password = WRITER_PASSWORD;
  return url.toString();
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("artifact directory under production writer grants", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  let writerPool: pg.Pool;
  let writerHost: Awaited<ReturnType<typeof composeArtifactHost>>;
  let call: (op: string, args: unknown, actor?: string) => ReturnType<ReturnType<typeof createArtifactControl>["handle"]>;
  let aliceId: string;
  let artifactId: string;

  beforeAll(async () => {
    // v2 profile throughout: the host_policy revision must match the writer
    // host below (INSERT ... ON CONFLICT DO NOTHING keeps the first writer).
    fixture = await p0bFixture(v2);
    // The p0b fixture carries no membership tables; the production grants
    // reference them, so mirror the production columns before applying.
    await fixture.pool.query(`CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id UUID NOT NULL, account_id UUID NOT NULL, status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), revoked_at TIMESTAMPTZ,
      PRIMARY KEY (workspace_id, account_id))`);
    // The grants carry UPDATE(created_at) on both tables; production rows
    // have it, the p0b fixture does not.
    await fixture.pool.query(`ALTER TABLE account_users
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`);
    await fixture.pool.query(`DROP ROLE IF EXISTS ${IMMO_MCP_ARTIFACT_WRITER_ROLE}`);
    await fixture.pool.query(
      `CREATE ROLE ${IMMO_MCP_ARTIFACT_WRITER_ROLE} WITH LOGIN PASSWORD '${WRITER_PASSWORD}'`);
    await applyServiceRoleGrants(fixture.pool);
    writerPool = new pg.Pool({ connectionString: writerUrlFrom(process.env.P0B_DATABASE_URL!),
      max: 8, options: "-c statement_timeout=5000 -c lock_timeout=1000" });
    writerHost = await composeArtifactHost(writerPool,
      { enabled: true, storageScope: "p0b", orgId: "test", s3Bucket: "test",
        s3Endpoint: "http://unused.test", s3Region: "test", s3AccessKey: "test", s3SecretKey: "test" },
      fixture.blobs,
      { confirmation: createDeleteConfirmation(writerPool, "p0b", "https://app.test"),
        contentBase: "pages.test", profile: v2,
        readActivation: () => ({ enabled: true, subjects: [], expiresAtMs: Number.POSITIVE_INFINITY, mode: "general" }),
        uploadPage: { cookieSecret: "test-upload-page-secret-32-bytes-padding",
          controlOrigin: "https://app.test", pageBaseUrl: "https://app.test/api/v1", s3Origins: [] } });
    const control = createArtifactControl(writerHost, "p0b", "pages.test", undefined,
      { directory: createAccountDirectory(writerPool) });
    call = (op, args, actor = "alice") => control.handle(op, actor, args);
    aliceId = (await fixture.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'alice'")).rows[0]!.id;
  }, 120_000);

  afterAll(async () => {
    try { writerHost?.close(); } catch { /* test teardown */ }
    try { await writerPool?.end(); } catch { /* test teardown */ }
    try { await fixture?.pool.query(`DROP ROLE IF EXISTS ${IMMO_MCP_ARTIFACT_WRITER_ROLE}`); } catch { /* test teardown */ }
    await fixture?.close();
  });

  it("should ensure, publish, list and list_versions as the writer role", async () => {
    const ensured = await call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
    expect(ensured.status, JSON.stringify(ensured.body).slice(0, 300)).toBe(201);
    artifactId = (ensured.body as { artifactId: string }).artifactId ??
      ((ensured.body as { output: { artifactId: string } }).output.artifactId);
    const published = await call("publish",
      { artifactId, files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Grants</h1>" }],
        idempotencyKey: randomUUID(), expectedCurrentReleaseId: null });
    expect(published.status, JSON.stringify(published.body).slice(0, 300)).toBe(201);
    const listed = await call("list", { limit: 20, offset: 0 });
    expect(listed.status, JSON.stringify(listed.body).slice(0, 300)).toBe(200);
    const versions = await call("list_versions", { artifactId });
    expect(versions.status, JSON.stringify(versions.body).slice(0, 300)).toBe(200);
    const raw = JSON.stringify(versions.body);
    expect(raw).not.toContain("alice");
    expect(raw).not.toContain("idp-");
    expect(raw).toContain(aliceId);
  });

  it("should fail people lookup cleanly without breaking the other tools", async () => {
    const directory = createAccountDirectory(writerPool);
    await expect(directory.searchPeople("p0b", "alice", 10))
      .rejects.toMatchObject({ code: "directory_lookup_unavailable" });
    const lookup = await call("lookup_people", { query: "alice" });
    // Pinned public contract (review 1005 §3): under the writer role the
    // directory throw surfaces as internal_error, never a pg message, and
    // the next tool still answers 200.
    expect(lookup.status, JSON.stringify(lookup.body).slice(0, 300)).toBe(500);
    expect(lookup.body).toMatchObject({ error: { code: "internal_error" } });
    expect(JSON.stringify(lookup.body)).not.toContain("permission denied");
    const listed = await call("list", { limit: 20, offset: 0 });
    expect(listed.status, JSON.stringify(listed.body).slice(0, 300)).toBe(200);
  });
});
