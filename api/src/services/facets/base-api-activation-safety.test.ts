/** Pure maintenance validation; operational readback is qualified separately. */
import { describe, expect, it, vi } from "vitest";
import {
  qualifiedActivationSafety, qualifiedLotCutoverSafetyFor,
  validateQualifiedMaintenanceEvidence, type QualifiedMaintenanceEvidence,
} from "./activation-maintenance-safety.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-23T12:00:00.000Z");
const bound = { workspaceId: WORKSPACE_ID, actorSub: "synthetic-actor-1",
  maintenanceAttemptId: ATTEMPT_ID, releaseId: "synthetic-release-1", instanceIds: ["api-1", "worker-1"] };
const options = { now: NOW };
const proof = { completedAt: NOW.toISOString(), coveredInstanceIds: bound.instanceIds };
function validEvidence(): QualifiedMaintenanceEvidence {
  return { ...bound, reason: "synthetic maintenance window", drain: proof, shutdown: proof };
}
function rejects(evidence: unknown, status: number, message: string) {
  expect(() => validateQualifiedMaintenanceEvidence(evidence, bound, options))
    .toThrowError(expect.objectContaining({ status, message }));
}

describe("qualified maintenance safety", () => {
  it("accepts fully bound evidence", () => {
    expect(() => validateQualifiedMaintenanceEvidence(validEvidence(), bound, options)).not.toThrow();
  });
  it("rejects missing evidence as closed", () => rejects(undefined, 503, "maintenance_evidence_required"));
  it.each([
    ["workspaceId", OTHER_ID, "workspace"], ["actorSub", "other-actor", "actor"],
    ["maintenanceAttemptId", OTHER_ID, "attempt"], ["releaseId", "other-release", "release"],
    ["instanceIds", ["api-1"], "instances"],
  ])("rejects mismatched %s", (field, value, error) => {
    rejects({ ...validEvidence(), [field as string]: value }, 403, `maintenance_evidence_${error}_mismatch`);
  });
  it("rejects empty instance sets", () => {
    rejects({ ...validEvidence(), instanceIds: [] }, 503, "maintenance_evidence_instances_required");
  });
  it.each(["drain", "shutdown"] as const)("rejects missing %s proof", (field) => {
    rejects({ ...validEvidence(), [field]: undefined }, 503, `maintenance_${field}_unconfirmed`);
  });
  it.each(["drain", "shutdown"] as const)("rejects partial %s coverage", (field) => {
    rejects({ ...validEvidence(), [field]: { ...proof, coveredInstanceIds: ["api-1"] } },
      503, `maintenance_${field}_unconfirmed`);
  });
  it("keeps instance identifiers case sensitive", () => {
    rejects({ ...validEvidence(), drain: { ...proof, coveredInstanceIds: ["API-1", "worker-1"] } },
      503, "maintenance_drain_unconfirmed");
  });
  it.each([-30 * 86400_000, 1])("rejects obsolete or future evidence (%s)", (offset) => {
    rejects({ ...validEvidence(), drain: { ...proof, completedAt: new Date(NOW.getTime() + offset).toISOString() } },
      503, "maintenance_evidence_obsolete");
  });
  it("rejects an invalid clock", () => {
    expect(() => validateQualifiedMaintenanceEvidence(validEvidence(), bound, { now: new Date("invalid") }))
      .toThrowError(expect.objectContaining({ status: 400 }));
  });
  it("rejects delegated readback absence instead of succeeding empty", async () => {
    await expect(qualifiedActivationSafety(bound, validEvidence(), undefined, options).readback(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 503, message: "activation_readback_unconfirmed" });
  });
  it("delegates 6H readback only after validation", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, validEvidence(), { readback }, options);
    await safety.drain(WORKSPACE_ID);
    await safety.readback(WORKSPACE_ID);
    expect(readback).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
  });
  it("does not call readback when shutdown is unconfirmed", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, { ...validEvidence(), shutdown: undefined }, { readback }, options);
    await expect(safety.readback(WORKSPACE_ID)).rejects.toMatchObject({ status: 503 });
    expect(readback).not.toHaveBeenCalled();
  });
  it("propagates a real reader failure", async () => {
    const readback = vi.fn(async () => { throw new Error("persisted-state mismatch"); });
    await expect(qualifiedActivationSafety(bound, validEvidence(), { readback }, options).readback(WORKSPACE_ID))
      .rejects.toThrow("persisted-state mismatch");
  });
  it("rejects 6K empty ready-target iteration", async () => {
    const readbackAuthorized = vi.fn(async () => {});
    await expect(qualifiedLotCutoverSafetyFor(bound, validEvidence(), [], { readbackAuthorized }, options)
      .readbackAuthorized(WORKSPACE_ID)).rejects.toMatchObject({ status: 503, message: "lot_cutover_readback_unconfirmed" });
    expect(readbackAuthorized).not.toHaveBeenCalled();
  });
  it("rejects 6K cross-workspace reuse", async () => {
    await expect(qualifiedLotCutoverSafetyFor(bound, validEvidence(), ["dest:city::real"], undefined, options)
      .drainDeliveryPaths(OTHER_ID)).rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
  });
  it("delegates 6K readback and preserves rejection", async () => {
    const readbackAuthorized = vi.fn(async () => { throw new Error("lot mismatch"); });
    const safety = qualifiedLotCutoverSafetyFor(bound, validEvidence(), ["dest:city::real"], { readbackAuthorized }, options);
    await safety.drainDeliveryPaths(WORKSPACE_ID);
    await expect(safety.readbackAuthorized(WORKSPACE_ID)).rejects.toThrow("lot mismatch");
    expect(readbackAuthorized).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
  });
});
