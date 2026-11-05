import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryStaging, createMemoryUploadSessionStore, createMemoryUploadSigner,
  stagingKey } from "@sentropic/artifacts/server/uploads";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";
import { createArtifactControl } from "./facade.js";

/**
 * R1 — deep scan across every artifacts_* output (provider 0.2.15
 * projects at the source; the immo host keeps its defence-in-depth
 * pass). No raw IdP sub and no email may appear in any payload. The
 * mechanical enumeration below covers every tool output: ensure,
 * publish, create_upload / commit_upload / publish_bundle receipts,
 * create_upload_page mint, list_assets, publish_bundle_v2, list, meta,
 * get_source, list_versions (receipt on v2, 503 refusal on v1),
 * lookup_people (opaque userRef, masked email hint), list_access and the
 * set_access grant/revoke receipts, the delete confirmation_required
 * receipt (v1) or precondition refusal (v2), the
 * revoke_reader_consent refusal, the revert receipt (v2) or the 503
 * refusal (v1, unselected), plus every read of a page whose owner row
 * is gone (owner -> `unknown-<hash>`).
 */
const v1 = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.p0b.v1",
  requireExpectedCurrentReleaseId: false, resultEnvelopeVersion: 1 });
const v2 = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.v2",
  requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });

/** Fail on any raw internal id or email in a model-visible payload. */
function expectNoRawIdentity(body: unknown, label: string): void {
  const raw = JSON.stringify(body);
  expect(raw, `${label} leaks a raw sub`).not.toContain("alice");
  expect(raw, `${label} leaks a raw sub`).not.toContain("idp-");
  expect(raw, `${label} leaks an email`).not.toContain("@example.test");
  expect(raw, `${label} leaks a gone address`).not.toContain("gone@example.test");
}

// v2 wraps receipts in the output envelope; v1 keeps them at the root.
function out<T>(body: unknown): T {
  return ((body as { output?: unknown }).output ?? body) as T;
}

function manifestOf(body: unknown): { ownerId?: unknown } {
  const root = body as Record<string, unknown>;
  const output = root.output as Record<string, unknown> | undefined;
  const manifest = (output?.manifest ?? root.manifest) as string;
  return JSON.parse(manifest) as { ownerId?: unknown };
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("R1 deep scan across every artifacts_* output", () => {
  const cases = [
    { name: "v1", profile: v1, needsCas: false, revertSelected: false },
    { name: "v2", profile: v2, needsCas: true, revertSelected: true },
  ] as const;
  for (const { name, profile, needsCas, revertSelected } of cases) {
    describe(`profile ${name}`, () => {
      let fixture: Awaited<ReturnType<typeof p0bFixture>>;
      let artifactId: string;
      let releaseId: string;
      let goneArtifactId: string;
      let aliceId: string;
      let bobId: string;
      beforeAll(async () => {
        fixture = await p0bFixture(profile);
        aliceId = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'alice'")).rows[0]!.id;
        bobId = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'idp-bob'")).rows[0]!.id;
        const ensured = await fixture.call("ensure",
          { bindingName: randomUUID(), idempotencyKey: randomUUID() });
        expect(ensured.status).toBe(201);
        expectNoRawIdentity(ensured.body, "ensure receipt");
        // v1 receipts stay minimal (no owner field); v2 carries the summary.
        if (revertSelected) expect(JSON.stringify(ensured.body)).toContain(aliceId);
        artifactId = (ensured.body as { artifactId: string }).artifactId ??
          ((ensured.body as { output: { artifactId: string } }).output.artifactId);
        const published = await fixture.call("publish", { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Before</h1>" }],
          idempotencyKey: randomUUID(), ...(needsCas ? { expectedCurrentReleaseId: null } : {}) });
        expect(published.status).toBe(201);
        expectNoRawIdentity(published.body, "publish receipt");
        expect(manifestOf(published.body).ownerId).toBe(aliceId);
        releaseId = (published.body as { releaseId: string }).releaseId ??
          ((published.body as { output: { releaseId: string } }).output.releaseId);
        // Deleted-owner page: published while known, read after the Loi 25
        // erasure. The grant for bob is nominative userRef, never a sub.
        await fixture.pool.query(
          "INSERT INTO account_users (sub, status, email, name) VALUES ('idp-gone', 'approved', 'gone@example.test', 'Gone')");
        const goneEnsured = await fixture.call("ensure",
          { bindingName: randomUUID(), idempotencyKey: randomUUID() }, "idp-gone");
        expect(goneEnsured.status).toBe(201);
        goneArtifactId = (goneEnsured.body as { artifactId: string }).artifactId ??
          ((goneEnsured.body as { output: { artifactId: string } }).output.artifactId);
        const gonePublished = await fixture.call("publish", { artifactId: goneArtifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Gone</h1>" }],
          idempotencyKey: randomUUID(), ...(needsCas ? { expectedCurrentReleaseId: null } : {}) },
        "idp-gone");
        expect(gonePublished.status).toBe(201);
        expectNoRawIdentity(gonePublished.body, "gone publish receipt");
        const granted = await fixture.call("set_access", { artifactId: goneArtifactId,
          action: "grant", principalId: bobId, grant: "read", idempotencyKey: randomUUID() },
        "idp-gone");
        expect(granted.status).toBe(200);
        expectNoRawIdentity(granted.body, "set_access grant receipt");
        await fixture.pool.query("DELETE FROM account_users WHERE sub = 'idp-gone'");
      });
      afterAll(async () => { await fixture?.close(); });

      it("should carry no raw identity in the revert receipt or refusal", async () => {
        if (!revertSelected) {
          const refused = await fixture.call("revert", { artifactId, targetReleaseId: releaseId,
            expectedCurrentReleaseId: releaseId, idempotencyKey: randomUUID() });
          expect(refused.status).toBe(503);
          expectNoRawIdentity(refused.body, "revert refusal");
          return;
        }
        const second = await fixture.call("publish", { artifactId,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>After</h1>" }],
          idempotencyKey: randomUUID(), expectedCurrentReleaseId: releaseId });
        expect(second.status).toBe(201);
        const secondId = (second.body as { output: { releaseId: string } }).output.releaseId;
        const reverted = await fixture.call("revert", { artifactId, targetReleaseId: releaseId,
          expectedCurrentReleaseId: secondId, idempotencyKey: randomUUID() });
        expect(reverted.status).toBe(201);
        expectNoRawIdentity(reverted.body, "revert receipt");
        expect(manifestOf(reverted.body).ownerId).toBe(aliceId);
      });

      it("should list a deleted owner as unknown with no raw identity", async () => {
        const listed = await fixture.call("list_access", { artifactId: goneArtifactId }, "idp-bob");
        expect(listed.status).toBe(200);
        expectNoRawIdentity(listed.body, "list_access");
        expect(JSON.stringify(listed.body)).toContain("unknown-");
        const got = await fixture.call("meta", { artifactId: goneArtifactId }, "idp-bob");
        expect(got.status).toBe(200);
        expectNoRawIdentity(got.body, "get after owner deletion");
        expect(JSON.stringify(got.body)).toContain("unknown-");
      });

      it("should carry no raw identity in the set_access grant and revoke receipts", async () => {
        const granted = await fixture.call("set_access", { artifactId, action: "grant",
          principalId: bobId, grant: "read", idempotencyKey: randomUUID() });
        expect(granted.status).toBe(200);
        expectNoRawIdentity(granted.body, "set_access grant receipt");
        expect(JSON.stringify(granted.body)).toContain(bobId);
        const revoked = await fixture.call("set_access", { artifactId, action: "revoke",
          principalId: bobId, idempotencyKey: randomUUID() });
        expect(revoked.status).toBe(200);
        expectNoRawIdentity(revoked.body, "set_access revoke receipt");
        // The revoke really removed the row: the receipt carries no grant
        // entry at all (and therefore no identity either).
        expect((revoked.body as { grants?: unknown[] }).grants ??
          (revoked.body as { output?: { grants?: unknown[] } }).output?.grants).toEqual([]);
      });

      it("should carry no raw identity across every remaining tool output", async () => {
        // Mechanical enumeration of every output the set_access-focused
        // tests above do not scan. A fresh approved actor keeps its own
        // per-minute attempt budget, far from the shared alice budget.
        await fixture.pool.query(
          "INSERT INTO account_users (sub, status, email, name) VALUES " +
          "('idp-scan', 'approved', NULL, NULL), " +
          "('idp-scan-reader', 'approved', 'scan-reader@example.test', 'Scan Reader')");
        const scan = (body: unknown, label: string) => expectNoRawIdentity(body, label);
        const ensured = await fixture.call("ensure",
          { bindingName: randomUUID(), idempotencyKey: randomUUID() }, "idp-scan");
        expect(ensured.status).toBe(201);
        scan(ensured.body, "ensure receipt");
        const scanArtifactId = out<{ artifactId: string }>(ensured.body).artifactId;
        // Agent-channel uploads ride memory doubles (same semantics as the
        // S3 staging); the provider receipts are what the scan asserts on.
        const staging = createMemoryStaging();
        const signerDouble = createMemoryUploadSigner();
        const memHost = await fixture.connect(undefined,
          { uploads: { sessions: createMemoryUploadSessionStore(), staging, signer: signerDouble.signer } });
        const memCall = (op: string, args: unknown, actor = "idp-scan") =>
          createArtifactControl(memHost, "p0b", "pages.test").handle(op, actor, args);
        async function stage(bytes: Uint8Array, path: string): Promise<string> {
          const created = await memCall("create_upload",
            { artifactId: scanArtifactId, mimeType: "image/png", maxSize: bytes.length });
          expect(created.status, `create ${path}`).toBe(201);
          scan(created.body, "create_upload receipt");
          const body = out<{ uploadId: string; requiredHeaders: Record<string, string> }>(created.body);
          const key = stagingKey("p0b", body.uploadId);
          signerDouble.put({ key, contentType: "image/png", contentLength: bytes.length }, bytes,
            { ...body.requiredHeaders,
              "x-amz-checksum-sha256": createHash("sha256").update(bytes).digest("base64") });
          await staging.put(key, bytes);
          const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
          const committed = await memCall("commit_upload", { artifactId: scanArtifactId,
            uploadId: body.uploadId, path, mimeType: "image/png", digest,
            size: bytes.length, idempotencyKey: randomUUID() });
          expect(committed.status, `commit ${path}`).toBe(201);
          scan(committed.body, "commit_upload receipt");
          return body.uploadId;
        }
        const png = (seed: number): Uint8Array => {
          const bytes = randomBytes(1024);
          bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
          return bytes;
        };
        const minted = await fixture.call("create_upload_page", { artifactId: scanArtifactId }, "idp-scan");
        expect(minted.status).toBe(201);
        scan(minted.body, "create_upload_page receipt");
        const uploadIdA = await stage(png(1), "assets/first.png");
        const bundled = await memCall("publish_bundle", { artifactId: scanArtifactId,
          idempotencyKey: randomUUID(), expectedCurrentReleaseId: null,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Scan</h1>" }],
          assets: [{ path: "assets/first.png", uploadId: uploadIdA }] });
        expect(bundled.status).toBe(201);
        scan(bundled.body, "publish_bundle receipt");
        const bundleReleaseId = out<{ releaseId: string }>(bundled.body).releaseId;
        const assets = await fixture.call("list_assets", { artifactId: scanArtifactId }, "idp-scan");
        expect(assets.status).toBe(200);
        scan(assets.body, "list_assets");
        const uploadIdB = await stage(png(2), "assets/second.png");
        const bundledV2 = await memCall("publish_bundle_v2", { artifactId: scanArtifactId,
          idempotencyKey: randomUUID(), expectedCurrentReleaseId: bundleReleaseId,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Scan v2</h1>" }],
          assets: [{ path: "assets/second.png", uploadId: uploadIdB }] });
        expect(bundledV2.status).toBe(201);
        scan(bundledV2.body, "publish_bundle_v2 receipt");
        for (const [op, args] of [
          ["list", {}],
          ["meta", { artifactId: scanArtifactId }],
          ["get_source", { artifactId: scanArtifactId }],
        ] as const) {
          const response = await fixture.call(op, args, "idp-scan");
          expect(response.status, op).toBe(200);
          scan(response.body, `${op} output`);
        }
        const versions = await fixture.call("list_versions", { artifactId: scanArtifactId }, "idp-scan");
        if (!revertSelected) {
          expect(versions.status).toBe(503);
        } else {
          expect(versions.status).toBe(200);
        }
        scan(versions.body, "list_versions output");
        // Directory outputs carry the masked email hint by design (never the
        // raw sub, never the full address): assert that contract exactly.
        const readerRef = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'idp-scan-reader'")).rows[0]!.id;
        const found = await fixture.call("lookup_people", { query: "scan" }, "idp-scan");
        expect(found.status).toBe(200);
        expect(out<{ matches: unknown[] }>(found.body).matches).toEqual([{
          userRef: readerRef,
          displayName: "Scan Reader",
          emailHint: expect.stringMatching(/^s\*+@example\.test$/),
        }]);
        const foundRaw = JSON.stringify(found.body);
        expect(foundRaw).not.toContain("idp-");
        expect(foundRaw).not.toContain("scan-reader@example.test");
        const access = await fixture.call("list_access", { artifactId: scanArtifactId }, "idp-scan");
        expect(access.status).toBe(200);
        scan(access.body, "list_access");
        // First delete call only mints the human confirmation (v1) or
        // refuses the missing precondition (strict v2): no deletion happens.
        const deleted = await fixture.call("delete",
          { artifactId: scanArtifactId, idempotencyKey: randomUUID() }, "idp-scan");
        expect(deleted.status).toBeGreaterThanOrEqual(400);
        scan(deleted.body, "delete first-call output");
        const revokedConsent = await fixture.call("revoke_reader_consent",
          { artifactId: scanArtifactId, idempotencyKey: randomUUID() }, "idp-scan");
        scan(revokedConsent.body, "revoke_reader_consent output");
      });

      it("should allow revoke after erasure without oracle while row convergence stays suspended-only (R5 erasure)", async () => {
        await fixture.pool.query(
          "INSERT INTO account_users (sub, status, email, name) VALUES " +
          "('idp-erased', 'approved', 'erased@example.test', 'Erased')");
        const userRef = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'idp-erased'")).rows[0]!.id;
        const ensured = await fixture.call("ensure",
          { bindingName: randomUUID(), idempotencyKey: randomUUID() }, "alice");
        expect(ensured.status).toBe(201);
        const target = out<{ artifactId: string }>(ensured.body).artifactId;
        const published = await fixture.call("publish", { artifactId: target,
          files: [{ path: "index.html", mimeType: "text/html", text: "<h1>Erasure</h1>" }],
          idempotencyKey: randomUUID(), ...(needsCas ? { expectedCurrentReleaseId: null } : {}) }, "alice");
        expect(published.status).toBe(201);
        const granted = await fixture.call("set_access", { artifactId: target, action: "grant",
          principalId: userRef, grant: "read", idempotencyKey: randomUUID() }, "alice");
        expect(granted.status).toBe(200);
        // Loi 25 erasure: the account row is gone while the grant row still
        // names the internal principal. No tombstone exists by design (no
        // erased-person mapping is retained), so the provider falls back to
        // the raw userRef and the sub-form row survives the 200. Row
        // convergence (absence de ligne) is therefore claimed for suspended
        // beneficiaries only (proven in p0b-sharing); after erasure the
        // listing must still project the survivor as unknown with no raw
        // leak, and this test pins that restricted contract.
        await fixture.pool.query("DELETE FROM account_users WHERE sub = 'idp-erased'");
        const revoked = await fixture.call("set_access", { artifactId: target, action: "revoke",
          principalId: userRef, idempotencyKey: randomUUID() }, "alice");
        expect(revoked.status).toBe(200);
        const remaining = await fixture.pool.query(
          "SELECT principal_id FROM artifacts.artifact_access WHERE artifact_id = $1", [target]);
        expect(remaining.rows).toEqual([{ principal_id: "idp-erased" }]);
        const listed = await fixture.call("list_access", { artifactId: target }, "alice");
        expect(listed.status).toBe(200);
        const raw = JSON.stringify(listed.body);
        expect(raw).not.toContain("idp-erased");
        expect(raw).not.toContain("erased@example.test");
        expect(raw).toContain("unknown-");
      });
    });
  }
});
