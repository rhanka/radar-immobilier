import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { p0bFixture } from "./p0b.test-support.js";

/**
 * Reader consent LOT 1 — self-revocation through the generic host port.
 * The revoke tool withdraws the caller's own persistent consent only: an
 * unknown page stays a `not_found` refusal with no oracle, a missing row
 * revokes nothing, and one reader's revocation never touches another
 * reader's live row. The provider answers the write through the same error
 * order as every capability (syntax → visibility → store gate).
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("reader consent self-revocation", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  let named: { artifactId: string };
  beforeAll(async () => {
    fixture = await p0bFixture();
    named = await fixture.page();
    // Revocation checks visibility first (no oracle): the consent holder
    // reads the page, exactly like the screen flow that granted consent.
    await fixture.pool.query(`INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
      VALUES ($1, 'idp-bob', 'read')`, [named.artifactId]);
  });
  afterAll(async () => { await fixture?.close(); });

  async function seedConsent(reader: string, artifactId: string): Promise<string> {
    const consentId = randomUUID();
    await fixture.pool.query(`INSERT INTO artifacts.reader_consents
      (consent_id, storage_scope_id, reader_account_id, artifact_id, scope_id, scope_version, granted_via)
      VALUES ($1, 'p0b', $2, $3, 'reader', 'v1', 'reader_screen')`, [consentId, reader, artifactId]);
    return consentId;
  }

  async function liveCount(reader: string, artifactId: string): Promise<number> {
    const { rows } = await fixture.pool.query<{ count: string }>(`SELECT COUNT(*) AS count
      FROM artifacts.reader_consents WHERE storage_scope_id = 'p0b' AND reader_account_id = $1
      AND artifact_id = $2 AND revoked_at IS NULL`, [reader, artifactId]);
    return Number(rows[0]!.count);
  }

  it("should refuse an unknown page without oracle and revoke nothing without a row", async () => {
    const unknown = await fixture.call("revoke_reader_consent",
      { artifactId: randomUUID(), idempotencyKey: randomUUID() }, "idp-bob");
    expect(unknown.status).toBe(404);
    const empty = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, idempotencyKey: randomUUID() }, "idp-bob");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ artifactId: named.artifactId, scopeId: null, changed: false, revoked: 0 });
  });

  it("should revoke the caller's own live row once, then report no change", async () => {
    await seedConsent("idp-bob", named.artifactId);
    const first = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, idempotencyKey: randomUUID() }, "idp-bob");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ artifactId: named.artifactId, scopeId: null, changed: true, revoked: 1 });
    expect(await liveCount("idp-bob", named.artifactId)).toBe(0);
    const second = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, idempotencyKey: randomUUID() }, "idp-bob");
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ changed: false, revoked: 0 });
  });

  it("should revoke one scope only when scope is named", async () => {
    await seedConsent("idp-bob", named.artifactId);
    const scoped = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, scope: "reader", idempotencyKey: randomUUID() }, "idp-bob");
    expect(scoped.status).toBe(200);
    expect(scoped.body).toMatchObject({ artifactId: named.artifactId, scopeId: "reader", changed: true });
    expect((scoped.body as { revokedAt?: string }).revokedAt).toEqual(expect.any(String));
    expect(await liveCount("idp-bob", named.artifactId)).toBe(0);
  });

  it("should never revoke another reader's row (self-revocation only)", async () => {
    await seedConsent("idp-bob", named.artifactId);
    const other = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, idempotencyKey: randomUUID() }, "alice");
    expect(other.status).toBe(200);
    expect(other.body).toMatchObject({ changed: false, revoked: 0 });
    // Bob's own live row survives Alice's call; Bob still revokes it himself.
    expect(await liveCount("idp-bob", named.artifactId)).toBe(1);
    const own = await fixture.call("revoke_reader_consent",
      { artifactId: named.artifactId, idempotencyKey: randomUUID() }, "idp-bob");
    expect(own.body).toMatchObject({ changed: true, revoked: 1 });
  });
});
