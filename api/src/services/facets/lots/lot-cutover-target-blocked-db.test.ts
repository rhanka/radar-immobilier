/**
 * 6K cutover target guard: a pending native identity stays unavailable
 * across read, single write, and batch after its source qualifies.
 *
 * An archive history stored without a qualified destination keeps the
 * target out of activation under its native canonical key. When the
 * source version later validates, the same canonical identity must still
 * refuse reads and commands with an explicit pending status instead of
 * serving empty facets or accepting unreconciled writes.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { lotVersions } from "../../../db/schema.js";
import { readLotState } from "./lot-reader.js";
import { writeLotFacet } from "./lot-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { resolveLotSource } from "./lot-target.js";
import { cutoverImportKeyFor, readLotCutover, runLotCutover } from "./lot-cutover.js";
import { recomputeLotManifest } from "./lot-manifest-refresh.js";
import { lotCommand, lotEventCount } from "./lot-test-helpers.js";
import { LOT_6J_AA } from "./lot-import-input.js";
import {
  CUTOVER_CITY,
  cutoverFixture,
  describeDb,
  recordingCutoverSafety,
} from "./cutover-fixture.js";

const V4 = "6c000000-0000-4000-8000-0000000000d4";
const V4_CANON = "lot-canonical-syn-6k-04";
const V5 = "6c000000-0000-4000-8000-0000000000d5";
const V5_CANON = "lot-canonical-syn-6k-05";
const MARK_MAPPED = "7b000000-0000-4000-8000-00000000000a";
const MARK_UNRESOLVED = "7b000000-0000-4000-8000-00000000000b";

const LEGACY_INSERT =
  "INSERT INTO prospect_marks (id, lot_version_id, no_lot, city_slug, dimension, statut, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7)";

const MAPPING = {
  mappingVersion: "mapping-syn-6k-review-v1",
  importerVersion: "importer-syn-6k-review-v1",
  destinationsQualified: true,
};

describeDb("6K cutover target guard under native identity", () => {
  it("should keep a late-qualified native history pending across read, write, and batch", async () => {
    const f = await cutoverFixture();
    await f.db.insert(lotVersions).values([
      { id: V4, canonicalId: V4_CANON, noLot: "SYN-6K-0004", citySlug: CUTOVER_CITY,
        reconStatus: "pending", validFrom: "2025-01-01",
        knownFrom: new Date("2025-01-01T00:00:00.000Z"), rawRef: "synthetic-6k-d4" },
      { id: V5, canonicalId: V5_CANON, noLot: "SYN-6K-0005", citySlug: CUTOVER_CITY,
        reconStatus: "validated", validFrom: "2025-01-01",
        knownFrom: new Date("2025-01-01T00:00:00.000Z"), rawRef: "synthetic-6k-d5" },
    ]);
    await f.pool.query(LEGACY_INSERT, [MARK_MAPPED, LOT_6J_AA,
      "SYN-6J-0001", CUTOVER_CITY, "pipeline", "ecarte", f.moderator.id]);
    await f.pool.query(LEGACY_INSERT, [MARK_UNRESOLVED, V4,
      "SYN-6K-0004", CUTOVER_CITY, "pipeline", "ecarte", f.moderator.id]);
    const report = await recomputeLotManifest(f.db, MAPPING);
    const byId = new Map(report.rows.map((row) => [row.sourceId, row]));
    expect(byId.get(MARK_MAPPED)?.disposition).toBe("mapped");
    expect(byId.get(MARK_UNRESOLVED)?.disposition).toBe("unresolved");

    const receipt = await runLotCutover(f.db, {
      workspaceId: f.workspaceId, actorSub: f.moderator.sub, report,
      importKey: cutoverImportKeyFor(f.workspaceId), confirmCutover: true,
      recomputeManifest: () => recomputeLotManifest(f.db, MAPPING),
    }, recordingCutoverSafety().safety);
    expect(receipt.status).toBe("complete");
    expect(await readLotCutover(f.db, f.workspaceId))
      .toMatchObject({ maintenanceBarrier: true, destinationOpen: true });

    await f.db.update(lotVersions).set({ reconStatus: "validated" })
      .where(eq(lotVersions.id, V4));
    const target = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: CUTOVER_CITY, canonicalId: V4_CANON };
    const displayed = (await resolveLotSource(f.db, target)).displayed;
    const before = await lotEventCount(f);
    await expect(readLotState(f.db, f.contributor.sub, f.workspaceId, "real", target))
      .rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace",
      lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket })))
      .rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    await expect(writeLotBatch(f.db, f.contributor.sub, f.workspaceId, "workspace", {
      contract_version: "lot-facets-v1", command_key: randomUUID(), mode: "real",
      items: [{ target, displayed_version: displayed, expected_head_id: null,
        mutation: { action: "select", basket_id: f.selectionBasket } }],
    })).rejects.toMatchObject({ status: 409, message: "lot_target_pending" });
    expect(await lotEventCount(f)).toBe(before);

    const mapped = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: CUTOVER_CITY, canonicalId: "lot-canonical-syn-6j-01" };
    const current = await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", mapped);
    expect(current.targetAvailable).toBe(true);
    const fresh = { type: "Lot" as const, authority: "lot_versions" as const,
      citySlug: CUTOVER_CITY, canonicalId: V5_CANON };
    expect((await readLotState(f.db, f.contributor.sub, f.workspaceId, "real", fresh))
      .targetAvailable).toBe(true);
  });
});
