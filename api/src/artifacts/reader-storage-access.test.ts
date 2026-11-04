import type pg from "pg";
import { describe, expect, it } from "vitest";
import { createStoredReader } from "./reader-storage.js";

/**
 * Lot I2 acceptance, automated part (G1 access model, immo binding):
 * - `platform` mode is readable by an approved account, refused to a pending one;
 * - a nominative grant opens `restricted` to exactly one colleague;
 * - a paused share (suspended account, dormant grant) resumes automatically;
 * - `public` mode never grants access here: the sharing policy stays closed
 *   and the 0032 CHECK forbids the value in this database.
 */

const SCOPE = "sharing-i2";
const BASE = "pages.example.test";
const OWNER = "idp-owner";
const FARID = "idp-farid";

interface World {
  artifact: Record<string, unknown> | null;
  approvedSubs: Set<string>;
  grants: Array<{ principal_id: string; permission: string }>;
}

function makeWorld(artifact: Record<string, unknown> | null): World {
  return { artifact, approvedSubs: new Set([OWNER]), grants: [] };
}

async function rightsOf(world: World, readerSub: string, artifactId: string) {
  const pool = {
    query: async (sql: unknown, params: unknown[]) => {
      const text = String(sql);
      if (text.includes("FROM account_users")) {
        const approved = world.approvedSubs.has(String(params[0]));
        return { rows: approved ? [{ "?column?": 1 }] : [], rowCount: approved ? 1 : 0 };
      }
      if (text.includes("FROM artifacts.artifact_access")) {
        return { rows: world.grants, rowCount: world.grants.length };
      }
      return world.artifact ? { rows: [world.artifact], rowCount: 1 } : { rows: [], rowCount: 0 };
    },
  } as unknown as pg.Pool;
  const { authority } = createStoredReader(pool, SCOPE, BASE, { getBlob: async () => undefined });
  return authority.getRights(readerSub, artifactId);
}

const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";

function artifactRow(accessMode: string | null, isPublic = false) {
  return { id: ARTIFACT, owner_id: OWNER, is_public: isPublic,
    ...(accessMode === null ? {} : { access_mode: accessMode }) };
}

describe("reader access on access_mode", () => {
  it("should open platform to an approved account and refuse a pending one", async () => {
    const world = makeWorld(artifactRow("platform"));
    world.approvedSubs.add(FARID);
    const open = await rightsOf(world, FARID, ARTIFACT);
    expect(open?.approved).toBe(true);
    expect(open?.capabilities).toContain("signals.protected-read");
    world.approvedSubs.delete(FARID);
    const closed = await rightsOf(world, FARID, ARTIFACT);
    expect(closed?.approved).toBe(false);
    expect(closed?.capabilities).toEqual([]);
  });

  it("should open restricted to exactly the invited colleague", async () => {
    const world = makeWorld(artifactRow("restricted"));
    world.approvedSubs.add(FARID);
    world.grants = [{ principal_id: FARID, permission: "read" }];
    expect((await rightsOf(world, FARID, ARTIFACT))?.approved).toBe(true);
    expect((await rightsOf(world, "idp-stranger", ARTIFACT))?.approved).toBe(false);
  });

  it("should resume a paused share automatically once the account is approved again", async () => {
    const world = makeWorld(artifactRow("platform"));
    world.approvedSubs.add(FARID);
    expect((await rightsOf(world, FARID, ARTIFACT))?.approved).toBe(true);
    world.approvedSubs.delete(FARID);
    expect((await rightsOf(world, FARID, ARTIFACT))?.approved).toBe(false);
    // The grant row is dormant, never deleted: re-approval reopens access.
    world.approvedSubs.add(FARID);
    expect((await rightsOf(world, FARID, ARTIFACT))?.approved).toBe(true);
  });

  it("should never grant public access under the closed sharing policy", async () => {
    const world = makeWorld(artifactRow("public"));
    world.approvedSubs.add(FARID);
    // Defense in depth: even a public row written outside the API serves
    // nobody here (no SharingPolicyPort, no allowPublicSharing capability).
    expect((await rightsOf(world, FARID, ARTIFACT))?.approved).toBe(false);
    expect((await rightsOf(world, OWNER, ARTIFACT))?.approved).toBe(true);
  });

  it("should keep the owner approved in every mode", async () => {
    for (const mode of ["restricted", "platform", "public"]) {
      const world = makeWorld(artifactRow(mode));
      expect((await rightsOf(world, OWNER, ARTIFACT))?.approved).toBe(true);
    }
  });

  it("should answer null for an unknown artifact", async () => {
    expect(await rightsOf(makeWorld(null), FARID, ARTIFACT)).toBeNull();
  });
});
