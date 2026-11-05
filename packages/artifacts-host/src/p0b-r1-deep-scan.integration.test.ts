import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";

/**
 * R1 — deep scan across every artifacts_* output (provider 0.2.15
 * projects at the source; the immo host keeps its defence-in-depth
 * pass). No raw IdP sub and no email may appear in any payload: ensure
 * and publish receipts at creation time (owner known -> opaque userRef),
 * revert receipts (v2) or the 503 refusal (v1, unselected), list_access
 * and the set_access grant/revoke receipts, plus every read of a page
 * whose owner row is gone (owner -> `unknown-<hash>`).
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
    });
  }
});
