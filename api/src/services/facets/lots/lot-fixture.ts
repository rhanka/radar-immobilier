// Disposable synthetic databases for 6J lot destination qualification.
// Builds on the 6I workspace fixture (moderator, contributor, outsider,
// two workspaces, scoped signal epoch), then enables the lot destination
// gate, seeds synthetic lot versions, and grants distinct D4 rights.
// Every identifier, city, and lot number is invented; no operational data.
import { randomUUID } from "node:crypto";
import { describe } from "vitest";
import { lotDestinationState, lotVersions } from "../../../db/schema.js";
import { setLotCapability, type LotCapability } from "./lot-capabilities.js";
import {
  workspaceFixture,
  type WorkspaceFixture,
} from "./../workspace-archive-fixture.js";

export const describeDb: ReturnType<typeof describe.skipIf> = describe.skipIf(
  process.env.LOT_MIGRATION_DB_TEST !== "1");

export const SYNTHETIC_BASKET = "synthetic-historical-favorites";

export interface LotFixture extends WorkspaceFixture {
  selectionBasket: string;
}

/**
 * Enable the lot destination gate with its configured basket, seed two
 * validated synthetic lot versions, and grant the contributor every
 * distinct D4 right in the primary workspace. The outsider keeps no lot
 * right; the moderator keeps moderation plus selection for composites.
 */
export async function lotFixture(): Promise<LotFixture> {
  const f = await workspaceFixture();
  await f.db.insert(lotDestinationState).values({
    workspaceId: f.workspaceId, enabled: true, selectionBasket: SYNTHETIC_BASKET,
  });
  for (const [suffix, canonical, noLot] of [
    ["aa", "lot-canonical-syn-6j-01", "SYN-6J-0001"],
    ["bb", "lot-canonical-syn-6j-02", "SYN-6J-0002"],
  ] as const) {
    await f.db.insert(lotVersions).values({
      id: `6a000000-0000-4000-8000-0000000000${suffix}`,
      canonicalId: canonical,
      noLot,
      citySlug: "synthetic-6j-city",
      reconStatus: "validated",
      validFrom: "2025-01-01",
      knownFrom: new Date("2025-01-01T00:00:00.000Z"),
      rawRef: `synthetic-6j-${suffix}`,
    });
  }
  const grants: Array<{ accountId: string; capability: LotCapability }> = [
    { accountId: f.contributor.id, capability: "lot_select" },
    { accountId: f.contributor.id, capability: "lot_pipeline" },
    { accountId: f.contributor.id, capability: "lot_market" },
    { accountId: f.moderator.id, capability: "lot_select" },
    { accountId: f.moderator.id, capability: "lot_pipeline" },
    { accountId: f.moderator.id, capability: "lot_market" },
  ];
  for (const grant of grants) {
    await setLotCapability(f.db, {
      workspaceId: f.workspaceId,
      targetAccountId: grant.accountId,
      actorSub: f.moderator.sub,
      capability: grant.capability,
      granted: true,
      reason: "synthetic 6J qualification",
      expectedRevision: null,
    });
  }
  return { ...f, selectionBasket: SYNTHETIC_BASKET };
}

export type SyntheticLotTarget = {
  citySlug: string;
  canonicalId: string;
  lotVersionId: string;
};

/** First seeded synthetic lot version. */
export function syntheticLotTarget(index = 0): SyntheticLotTarget {
  const lots = [
    { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-01",
      lotVersionId: "6a000000-0000-4000-8000-0000000000aa" },
    { citySlug: "synthetic-6j-city", canonicalId: "lot-canonical-syn-6j-02",
      lotVersionId: "6a000000-0000-4000-8000-0000000000bb" },
  ] as const;
  const lot = lots[index % lots.length]!;
  return { ...lot };
}

/**
 * Build a displayed version for one seeded lot as the writer expects it:
 * the caller's test resolves the fingerprint through the database, so no
 * fingerprint is invented here. Tests fetch it via `resolveLotSource`.
 */
export function syntheticLotKey(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
