import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileHostArtifactProfile } from "./p0b-profile.js";
import { p0bFixture } from "./p0b.test-support.js";

/**
 * R1 — `list_versions` must never emit a raw IdP sub (provider 0.2.13
 * emits `author` / `authorPrincipalId` unprojected). The immo host
 * projects both through the directory: known account -> opaque userRef,
 * missing account -> `unknown-<hash>`.
 */
const v1 = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.p0b.v1",
  requireExpectedCurrentReleaseId: false, resultEnvelopeVersion: 1 });
const v2 = compileHostArtifactProfile({ profileRevisionId: "immo-artifacts.v2",
  requireExpectedCurrentReleaseId: true, resultEnvelopeVersion: 2 });

function versionsOf(body: unknown): Record<string, unknown>[] {
  const root = body as Record<string, unknown>;
  const output = root.output as Record<string, unknown> | undefined;
  if (output && Array.isArray(output.versions)) return output.versions as Record<string, unknown>[];
  if (Array.isArray(root.versions)) return root.versions as Record<string, unknown>[];
  if (Array.isArray(root.releases)) return root.releases as Record<string, unknown>[];
  throw new Error(`unexpected list_versions shape: ${JSON.stringify(body).slice(0, 200)}`);
}

function authorOf(entry: Record<string, unknown>): unknown {
  return entry.authorPrincipalId ?? entry.author;
}

describe.skipIf(!process.env.P0B_DATABASE_URL)("list_versions author projection (R1)", () => {
  const cases = [
    // v1 (envelope 1) never selects list_versions: the facade refuses 503.
    // The v1 wire shape is still projected at the host layer, verified here
    // through host.execute; the 503 refusal itself must carry no sub either.
    { name: "v1", profile: v1, needsCas: false, selected: false },
    { name: "v2", profile: v2, needsCas: true, selected: true },
  ] as const;
  for (const { name, profile, needsCas, selected } of cases) {
    describe(`profile ${name}`, () => {
      let fixture: Awaited<ReturnType<typeof p0bFixture>>;
      let artifactId: string;
      let aliceId: string;
      beforeAll(async () => {
        fixture = await p0bFixture(profile);
        aliceId = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'alice'")).rows[0]!.id;
        const ensured = await fixture.call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() });
        expect(ensured.status).toBe(201);
        artifactId = (ensured.body as { artifactId: string }).artifactId ??
          ((ensured.body as { output: { artifactId: string } }).output.artifactId);
        const files = [{ path: "index.html", mimeType: "text/html", text: "<h1>Before</h1>" }];
        const published = await fixture.call("publish", { artifactId, files, idempotencyKey: randomUUID(),
          ...(needsCas ? { expectedCurrentReleaseId: null } : {}) });
        expect(published.status).toBe(201);
      });
      afterAll(async () => { await fixture?.close(); });

      it("should project a known author to the opaque userRef with no raw sub anywhere", async () => {
        const listed = await fixture.call("list_versions", { artifactId }, "alice");
        if (!selected) {
          // v1 never selects list_versions: the refusal itself must leak nothing.
          expect(listed.status).toBe(503);
          expect(JSON.stringify(listed.body)).not.toContain("alice");
          expect(JSON.stringify(listed.body)).not.toContain("idp-");
          return;
        }
        expect(listed.status).toBe(200);
        const raw = JSON.stringify(listed.body);
        expect(raw).not.toContain("alice");
        expect(raw).not.toContain("idp-");
        const entries = versionsOf(listed.body);
        expect(entries.length).toBeGreaterThanOrEqual(1);
        for (const entry of entries) expect(authorOf(entry)).toBe(aliceId);
      });

      it("should project a deleted author to unknown- with no raw sub anywhere", async () => {
        await fixture.pool.query(
          "INSERT INTO account_users (sub, status, email, name) VALUES ('idp-gone', 'approved', 'gone@example.test', 'Gone')");
        const ensured = await fixture.call("ensure", { bindingName: randomUUID(), idempotencyKey: randomUUID() }, "idp-gone");
        expect(ensured.status).toBe(201);
        const goneArtifact = (ensured.body as { artifactId: string }).artifactId ??
          ((ensured.body as { output: { artifactId: string } }).output.artifactId);
        const files = [{ path: "index.html", mimeType: "text/html", text: "<h1>Gone</h1>" }];
        const published = await fixture.call("publish", { artifactId: goneArtifact, files, idempotencyKey: randomUUID(),
          ...(needsCas ? { expectedCurrentReleaseId: null } : {}) }, "idp-gone");
        expect(published.status).toBe(201);
        const bobId = (await fixture.pool.query<{ id: string }>(
          "SELECT id FROM account_users WHERE sub = 'idp-bob'")).rows[0]!.id;
        const granted = await fixture.call("set_access", { artifactId: goneArtifact, action: "grant",
          principalId: bobId, grant: "read", idempotencyKey: randomUUID() }, "idp-gone");
        expect(granted.status).toBe(200);
        await fixture.pool.query("DELETE FROM account_users WHERE sub = 'idp-gone'");
        const listed = await fixture.call("list_versions", { artifactId: goneArtifact }, "idp-bob");
        if (!selected) {
          expect(listed.status).toBe(503);
          expect(JSON.stringify(listed.body)).not.toContain("idp-gone");
          return;
        }
        expect(listed.status).toBe(200);
        const raw = JSON.stringify(listed.body);
        expect(raw).not.toContain("idp-gone");
        expect(raw).not.toContain("gone@example.test");
        expect(raw).toContain("unknown-");
        for (const entry of versionsOf(listed.body)) {
          expect(String(authorOf(entry))).toMatch(/^unknown-[0-9a-f]{12}$/);
        }
      });
    });
  }
});
