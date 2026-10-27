import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { parsePersonalActivationArgs, executePersonalActivation } from "../../scripts/base-api-personal-activation.js";
import * as readback from "./activation-readback.js";
import { attach, describeDb, event, fixture } from "./scope-db-fixture.js";
import { scopedEpochFor } from "./activation.js";
import { readScopedPersonalHeads } from "./scoped-reader.js";

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-23T12:00:00Z")); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function args(workspaceId = "00000000-0000-0000-0000-000000000001", actorSub = "synthetic-manager") {
  const maintenanceAttemptId = "00000000-0000-0000-0000-000000000002";
  const instanceIds = ["synthetic-old-a", "synthetic-old-b"];
  const reason = "synthetic rehearsal $(touch must-not-run)";
  const proof = { completedAt: "2026-10-23T11:59:00Z", coveredInstanceIds: instanceIds };
  const evidence = { workspaceId, actorSub, maintenanceAttemptId, releaseId: "synthetic-release",
    instanceIds, reason, drain: proof, shutdown: proof };
  return ["--workspace", workspaceId, "--actor", actorSub, "--reason", reason,
    "--maintenance-attempt", maintenanceAttemptId, "--release", evidence.releaseId,
    "--instance", instanceIds[0]!, "--instance", instanceIds[1]!, "--evidence-json", JSON.stringify(evidence)];
}

describeDb("personal activation operator entry", () => {
  it.each(["--workspace", "--actor", "--reason", "--maintenance-attempt", "--release", "--instance", "--evidence-json"])(
    "should reject missing %s before execution", (flag) => {
      const raw = args().filter((_value, index, values) => values[index - index % 2] !== flag);
      expect(() => parsePersonalActivationArgs(raw)).toThrow();
    });

  it("should retain literal inputs and repeated instance coverage", () => {
    expect(parsePersonalActivationArgs(args())).toMatchObject({ actorSub: "synthetic-manager",
      reason: "synthetic rehearsal $(touch must-not-run)", bound: { instanceIds: ["synthetic-old-a", "synthetic-old-b"] } });
  });

  it.each(["workspaceId", "actorSub", "maintenanceAttemptId", "releaseId"] as const)(
    "should reject evidence bound to another %s", (key) => {
      const raw = args();
      const evidence = JSON.parse(raw.at(-1)!) as Record<string, unknown>;
      evidence[key] = key === "workspaceId" || key === "maintenanceAttemptId" ? randomUUID() : "another";
      raw[raw.length - 1] = JSON.stringify(evidence);
      expect(() => parsePersonalActivationArgs(raw)).toThrow(/mismatch/);
    });

  it.each(["drain", "shutdown"])("should reject missing %s proof", (key) => {
    const raw = args();
    const evidence = JSON.parse(raw.at(-1)!) as Record<string, unknown>;
    delete evidence[key];
    raw[raw.length - 1] = JSON.stringify(evidence);
    expect(() => parsePersonalActivationArgs(raw)).toThrow(`maintenance_${key}_unconfirmed`);
  });

  it("should activate seeded personal history with closed public readers during real readback", async () => {
    const f = await fixture();
    await event(f, { createdAt: new Date("2026-10-23T11:00:00Z") });
    await attach(f);
    const verify = readback.authorizePersonalActivationReadback;
    const spy = vi.spyOn(readback, "authorizePersonalActivationReadback").mockImplementation(async (...input) => {
      const evidence = await verify(...input);
      await expect(scopedEpochFor(f.db, f.workspaceId)).resolves.toBeNull();
      await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
        .rejects.toMatchObject({ status: 503 });
      return evidence;
    });
    await expect(executePersonalActivation(f.db, parsePersonalActivationArgs(args(f.workspaceId, f.actor.sub))))
      .resolves.toMatchObject({ status: "open-success", epoch: "scoped", streamsBound: 1, maintenanceBarrier: false });
    expect(spy).toHaveBeenCalledOnce();
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city")).resolves.toHaveLength(1);
    await expect(readScopedPersonalHeads(f.db, f.actor.sub, f.workspaceId, "synthetic-city")).resolves.toEqual([]);
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.otherId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
  });

  it("should open an explicitly attached empty personal history", async () => {
    const f = await fixture();
    await attach(f);
    await expect(executePersonalActivation(f.db, parsePersonalActivationArgs(args(f.workspaceId, f.actor.sub))))
      .resolves.toMatchObject({ status: "open-success", streamsBound: 0, sealedUnresolved: 0 });
  });

  it("should report committed but closed activation for unresolved personal chains", async () => {
    const f = await fixture();
    const parent = await event(f, { createdAt: new Date("2026-10-23T11:00:00Z") });
    await event(f, { supersedes: parent.id, createdAt: new Date("2026-10-23T11:01:00Z") });
    await attach(f);
    await expect(executePersonalActivation(f.db, parsePersonalActivationArgs(args(f.workspaceId, f.actor.sub))))
      .resolves.toMatchObject({ status: "activation-committed-readback-pending", epoch: "scoped",
        streamsBound: 0, sealedUnresolved: 2, maintenanceBarrier: true });
    await expect(scopedEpochFor(f.db, f.workspaceId)).resolves.toBeNull();
  });

  it("should retain the durable closed barrier when persisted readback loses a seeded head", async () => {
    const f = await fixture();
    await event(f, { createdAt: new Date("2026-10-23T11:00:00Z") });
    await attach(f);
    const verify = readback.authorizePersonalActivationReadback;
    vi.spyOn(readback, "authorizePersonalActivationReadback").mockImplementation(async (...input) => {
      const evidence = await verify(...input);
      // Inject persisted corruption only in this disposable database.
      const client = await f.pool.connect();
      try { await client.query("BEGIN; SET LOCAL session_replication_role = replica; DELETE FROM facet_heads; COMMIT"); }
      finally { client.release(); }
      return evidence;
    });
    await expect(executePersonalActivation(f.db, parsePersonalActivationArgs(args(f.workspaceId, f.actor.sub))))
      .rejects.toMatchObject({ status: 503, message: "activation_projection_mismatch" });
    expect((await f.pool.query("SELECT writer_epoch, maintenance_barrier FROM facet_activation_state WHERE workspace_id = $1",
      [f.workspaceId])).rows).toEqual([{ writer_epoch: "scoped", maintenance_barrier: true }]);
    await expect(readScopedPersonalHeads(f.db, f.member.sub, f.workspaceId, "synthetic-city"))
      .rejects.toMatchObject({ status: 503 });
  });
});
