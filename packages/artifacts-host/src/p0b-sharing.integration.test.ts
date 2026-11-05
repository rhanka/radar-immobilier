import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { p0bFixture } from "./p0b.test-support.js";

/**
 * I2 on G2 — share tooling through the I2 seams: opaque directory lookup
 * over approved accounts, userRef grants, projected access listing, platform
 * mode, public refusal, and the single-named-colleague collab right (owner
 * Q1). The G1 mirror (named belt, audit, mode guards) stays covered by
 * p0b.integration; this file covers the G2 directory binding only.
 */
describe.skipIf(!process.env.P0B_DATABASE_URL)("I2 sharing on G2", () => {
  let fixture: Awaited<ReturnType<typeof p0bFixture>>;
  // The host rate-limits commit attempts per actor and minute; the file
  // shares two pages (one for the grant cycle, one for the collab guard).
  let named: { artifactId: string };
  let collab: { artifactId: string };
  beforeAll(async () => {
    fixture = await p0bFixture();
    await fixture.pool.query(
      `INSERT INTO account_users (sub, status, email, name) VALUES
       ('idp-chloe', 'approved', 'chloe@example.test', 'Chloé Tremblay'),
       ('idp-mallory', 'pending', 'mallory@example.test', 'Mallory')`);
    named = await fixture.page();
    collab = await fixture.page();
  });
  afterAll(async () => { await fixture?.close(); });

  async function colleagueRef(query: string): Promise<string> {
    const found = await fixture.call("lookup_people", { query }, "alice");
    expect(found.status, `lookup ${query}`).toBe(200);
    const matches = (found.body as { matches: { userRef: string; displayName: string; emailHint: string }[] }).matches;
    expect(matches).toHaveLength(1);
    return matches[0]!.userRef;
  }

  it("should resolve approved colleagues through the opaque directory only", async () => {
    const found = await fixture.call("lookup_people", { query: "chloe" }, "alice");
    expect(found.status).toBe(200);
    // Accent-insensitive match on the IdP name; opaque userRef out, masked
    // email hint out, never the sub or the full address.
    expect((found.body as { matches: unknown[] }).matches).toEqual([{
      userRef: expect.stringMatching(/^[0-9a-f-]{36}$/),
      displayName: "Chloé Tremblay",
      emailHint: "c***@example.test",
    }]);
    // A pending account never surfaces, even by exact email.
    const hidden = await fixture.call("lookup_people", { query: "mallory@example.test" }, "alice");
    expect(hidden.status).toBe(200);
    expect((hidden.body as { matches: unknown[] }).matches).toEqual([]);
    // Directory enumeration itself requires an approved caller.
    expect((await fixture.call("lookup_people", { query: "chloe" }, "pending")).status).toBe(403);
  });

  it("should grant, read, list, revoke and refuse through userRef", async () => {
    const { artifactId } = named;
    const userRef = await colleagueRef("tremblay");
    const granted = await fixture.call("set_access", { artifactId, action: "grant",
      principalId: userRef, grant: "read", idempotencyKey: randomUUID() });
    expect(granted.status).toBe(200);
    expect(granted.body).toMatchObject({ accessMode: "restricted" });
    // The receipt projects the opaque reference, never the internal sub.
    expect((granted.body as { grants: { principalId: string }[] }).grants).toEqual([
      expect.objectContaining({ principalId: userRef, grant: "read" }),
    ]);
    expect((await fixture.call("meta", { artifactId }, "idp-chloe")).status).toBe(200);
    const listed = await fixture.call("list_access", { artifactId }, "alice");
    expect(listed.status).toBe(200);
    // Least-privilege directory (hotfix): describePrincipal projects the
    // opaque userRef only (no name/email columns), so the access listing
    // carries the opaque reference. Colleague names still resolve through
    // artifacts_lookup_people (pinned above).
    expect(listed.body).toMatchObject({ artifactId, accessMode: "restricted", canManage: true,
      owner: { displayName: expect.any(String) },
      grants: [{ userRef, displayName: userRef, grant: "read", effective: true }] });
    // A simple reader only sees its own entry.
    const readerView = await fixture.call("list_access", { artifactId }, "idp-chloe");
    expect(readerView.status).toBe(200);
    expect((readerView.body as { grants: unknown[] }).grants).toHaveLength(1);
    // The provider schema forbids grant on revoke (oneOf): a revoke names
    // only the userRef it removes.
    const revoked = await fixture.call("set_access", { artifactId, action: "revoke",
      principalId: userRef, idempotencyKey: randomUUID() });
    expect(revoked.status).toBe(200);
    expect((await fixture.call("meta", { artifactId }, "idp-chloe")).status).toBeGreaterThanOrEqual(400);
    // A suspended (non-approved) target is refused without oracle.
    const mallory = (await fixture.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'idp-mallory'")).rows[0]!.id;
    const refused = await fixture.call("set_access", { artifactId, action: "grant",
      principalId: mallory, grant: "read", idempotencyKey: randomUUID() });
    expect(refused.status).toBe(422);
    expect((refused.body as { error: string }).error).toBe("person_not_shareable");
  });

  it("should serve platform mode and refuse public sharing", async () => {
    // Reuses the grant-cycle page once revoked: no nominative grant left.
    const { artifactId } = named;
    const platform = await fixture.call("set_access", { artifactId, action: "grant",
      principalId: "sentropic:platform", grant: "read", idempotencyKey: randomUUID() });
    expect(platform.status).toBe(200);
    expect(platform.body).toMatchObject({ accessMode: "platform" });
    // Any approved account reads; no nominative grant needed.
    expect((await fixture.call("meta", { artifactId }, "idp-bob")).status).toBe(200);
    const listed = await fixture.call("list_access", { artifactId }, "idp-bob");
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ accessMode: "platform", canManage: false });
    // Public is OFF on this host: the double lock refuses it.
    const refused = await fixture.call("set_access", { artifactId, action: "grant",
      principalId: "sentropic:public", grant: "read", idempotencyKey: randomUUID() });
    expect(refused.status).toBe(403);
    expect((refused.body as { error: string }).error).toBe("public_sharing_disabled");
  });

  it("should never expose a raw sub for a deleted account (R1 opaque projection)", async () => {
    // Zero provider commits here (the file shares two pages for the
    // per-actor per-minute attempt budget): the dangling grant is seeded
    // the way the collab test seeds its source grant, then the account row
    // is erased like a Loi 25 deletion. Reuses the grant-cycle page after
    // its exact-grants assertions ran.
    await fixture.pool.query(`INSERT INTO account_users (sub, status, email, name) VALUES
      ('idp-gone', 'approved', 'gone@example.test', 'Gone')`);
    await fixture.pool.query(`INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission)
      VALUES ($1, 'idp-gone', 'read')`, [named.artifactId]);
    await fixture.pool.query("DELETE FROM account_users WHERE sub = 'idp-gone'");
    const listed = await fixture.call("list_access", { artifactId: named.artifactId }, "alice");
    expect(listed.status).toBe(200);
    const body = JSON.stringify(listed.body);
    expect(body).not.toContain("idp-gone");
    expect(body).toContain("unknown-");
    const got = await fixture.call("meta", { artifactId: named.artifactId }, "alice");
    expect(got.status).toBe(200);
    expect(JSON.stringify(got.body)).not.toContain("idp-gone");
  });

  it("should refuse an unapproved userRef (N3 approved-only resolution)", async () => {
    const mallory = (await fixture.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'idp-mallory'")).rows[0]!.id;
    // N3: the directory resolves approved accounts only; the miss merges
    // into person_not_shareable like every other resolution failure. The
    // legacy sub form still grants for an approved account (pinned by the
    // p0b contract suite); the model never learns subs because outputs only
    // ever carry userRef, so no extra grant cycle is spent here.
    const refused = await fixture.call("set_access", { artifactId: named.artifactId, action: "grant",
      principalId: mallory, grant: "read", idempotencyKey: randomUUID() });
    expect(refused.status).toBe(422);
    expect((refused.body as { error: string }).error).toBe("person_not_shareable");
  });

  // R5 — fixed provider-side in 0.2.15 (assertShareable gates grant only;
  // revoke stays allowed for dormant principals). Revoke converges: the
  // grant is gone and the re-approved colleague stays refused.
  describe("dormant grant revocation (provider R5)", () => {
    it("should revoke a suspended beneficiary grant and keep it revoked after re-approval", async () => {
      // Bob owns this page: alice already spent the per-actor per-minute
      // attempt budget (two pages plus the grant-cycle, platform and N3
      // writes), and the budget is enforced per actor.
      const ensured = await fixture.call("ensure",
        { bindingName: randomUUID(), idempotencyKey: randomUUID() }, "idp-bob");
      expect(ensured.status).toBe(201);
      const dormant = (ensured.body as { artifactId: string }).artifactId;
      const published = await fixture.call("publish", { artifactId: dormant,
        files: [{ path: "index.html", mimeType: "text/html", text: "<h1>R5</h1>" }],
        idempotencyKey: randomUUID() }, "idp-bob");
      expect(published.status).toBe(201);
      const userRef = await colleagueRef("chloe");
      expect((await fixture.call("set_access", { artifactId: dormant, action: "grant",
        principalId: userRef, grant: "read", idempotencyKey: randomUUID() }, "idp-bob")).status).toBe(200);
      await fixture.pool.query("UPDATE account_users SET status = 'suspended' WHERE sub = 'idp-chloe'");
      const revoked = await fixture.call("set_access", { artifactId: dormant, action: "revoke",
        principalId: userRef, idempotencyKey: randomUUID() }, "idp-bob");
      expect(revoked.status).toBe(200);
      const listed = await fixture.call("list_access", { artifactId: dormant }, "idp-bob");
      expect(JSON.stringify((listed.body as { grants: unknown }).grants)).not.toContain(userRef);
      // Row convergence for suspended beneficiaries: no grant row survives
      // the 200. (Erased beneficiaries keep their row — no tombstone by
      // design — and are pinned by the restricted R5 erasure test.)
      const remaining = await fixture.pool.query(
        "SELECT principal_id FROM artifacts.artifact_access WHERE artifact_id = $1", [dormant]);
      expect(remaining.rows).toEqual([]);
      await fixture.pool.query("UPDATE account_users SET status = 'approved' WHERE sub = 'idp-chloe'");
      expect((await fixture.call("meta", { artifactId: dormant }, "idp-chloe")).status)
        .toBeGreaterThanOrEqual(400);
    });
  });

  it("should keep the collab source right to a single named colleague", async () => {
    const { artifactId } = collab;
    // No catalogue tool grants source: the schema only knows read.
    const direct = await fixture.call("set_access", { artifactId, action: "grant",
      principalId: await colleagueRef("chloe"), grant: "source", idempotencyKey: randomUUID() });
    expect(direct.status).toBe(400);
    // Owner Q1, schema level: at most one source grant per artifact, in
    // restricted mode only.
    const chloe = (await fixture.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'idp-chloe'")).rows[0]!.id;
    const bob = (await fixture.pool.query<{ id: string }>(
      "SELECT id FROM account_users WHERE sub = 'idp-bob'")).rows[0]!.id;
    await fixture.pool.query(
      "INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'source')",
      [artifactId, "idp-chloe"]);
    expect(chloe).toMatch(/^[0-9a-f-]{36}$/);
    await expect(fixture.pool.query(
      "INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1, $2, 'source')",
      [artifactId, "idp-bob"])).rejects.toThrow();
    expect(bob).toMatch(/^[0-9a-f-]{36}$/);
  });
});
