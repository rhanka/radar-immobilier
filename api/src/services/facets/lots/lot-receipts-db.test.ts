import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { workspaceSignal } from "../workspace-archive-fixture.js";
import { writeWorkspaceArchiveFacet } from "../workspace-writer.js";
import { writeLotBatch } from "./lot-batch.js";
import { setLotCapability } from "./lot-capabilities.js";
import { describeDb, lotFixture } from "./lot-fixture.js";
import { displayedFor, lotCommand } from "./lot-test-helpers.js";
import { writeLotFacet } from "./lot-writer.js";

describeDb("6J shared command receipts", () => {
  it.each(["single", "batch"] as const)(
    "should serialize %s lot commands with signal commands across workspaces", async (family) => {
      const f = await lotFixture();
      const { target, displayed } = await displayedFor(f);
      const signal = await workspaceSignal(f);
      const commandKey = randomUUID();
      const command = { ...lotCommand(target, displayed,
        { action: "select", basket_id: f.selectionBasket }), command_key: commandKey };
      const blocker = await f.pool.connect();
      const pending: Promise<unknown>[] = [];
      const waitForBlocked = (count: number) => vi.waitFor(async () => {
        const result = await f.pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event = 'advisory'`);
        expect(result.rows[0].n).toBe(count);
      });
      try {
        await blocker.query("SELECT pg_advisory_lock(hashtextextended($1, 0))",
          [JSON.stringify(["lot-source", target.citySlug, target.canonicalId])]);
        await blocker.query("SELECT pg_advisory_lock(hashtext($1))", [`graph-city:${signal.target.citySlug}`]);
        pending.push(family === "single"
          ? writeLotFacet(f.db, f.moderator.sub, f.workspaceId, "workspace", command)
          : writeLotBatch(f.db, f.moderator.sub, f.workspaceId, "workspace", {
            contract_version: "lot-facets-v1", command_key: commandKey, mode: "real", items: [command],
          }));
        await waitForBlocked(1);
        pending.push(writeWorkspaceArchiveFacet(f.db, f.moderator.sub, f.otherId, {
          action: "discard", target: signal.target, reasonCode: "N-NON-RES",
          displayedFingerprint: signal.fingerprint, expectedHeadId: null, commandKey,
        }));
        await waitForBlocked(2);
      } finally {
        await blocker.query("SELECT pg_advisory_unlock_all()");
        blocker.release();
        await Promise.allSettled(pending);
      }
      const outcomes = await Promise.allSettled(pending);
      expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
      const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason)
        .toMatchObject({ status: 409, message: "idempotency_key_conflict" });
      for (const table of ["facet_commands", "facet_events"]) {
        expect((await f.pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(1);
      }
    });

  it("should recheck a revoked D4 right before replaying a single receipt", async () => {
    const f = await lotFixture();
    const { target, displayed } = await displayedFor(f);
    const command = lotCommand(target, displayed, { action: "select", basket_id: f.selectionBasket });
    await writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", command);
    await setLotCapability(f.db, { workspaceId: f.workspaceId, targetAccountId: f.contributor.id,
      actorSub: f.moderator.sub, capability: "lot_select", granted: false,
      expectedRevision: 1, reason: "synthetic receipt revocation" });
    await expect(writeLotFacet(f.db, f.contributor.sub, f.workspaceId, "workspace", command))
      .rejects.toMatchObject({ status: 403, message: "workspace_capability_required" });
  });
});
