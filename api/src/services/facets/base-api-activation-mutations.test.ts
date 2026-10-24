/** Discriminating safety mutations; each case fails if its guard is removed. */
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

describe("discriminating activation safety mutations", () => {
  it("rejects an empty reason", () => rejects({ ...validEvidence(), reason: "" }, 400, "invalid_activation_command"));
  it("rejects an overlong reason", () => rejects({ ...validEvidence(), reason: "r".repeat(513) }, 400, "invalid_activation_command"));
  it("rejects a malformed attempt id", () => rejects({ ...validEvidence(), maintenanceAttemptId: "not-a-uuid" }, 400, "invalid_maintenance_attempt"));
  it("rejects an empty release", () => rejects({ ...validEvidence(), releaseId: "" }, 503, "maintenance_evidence_release_required"));
  it("rejects an unparsable coverage timestamp", () => {
    rejects({ ...validEvidence(), drain: { ...proof, completedAt: "not-a-date" } }, 400, "invalid_maintenance_evidence");
  });
  it("validates evidence on 6H drain", async () => {
    const safety = qualifiedActivationSafety(bound, { ...validEvidence(), maintenanceAttemptId: OTHER_ID }, undefined, options);
    await expect(safety.drain(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_attempt_mismatch" });
  });
  it("validates 6H readback before delegating", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, { ...validEvidence(), releaseId: "other-release" }, { readback }, options);
    await expect(safety.readback(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_release_mismatch" });
    expect(readback).not.toHaveBeenCalled();
  });
  it("rejects 6H cross-workspace readback without delegating", async () => {
    const readback = vi.fn(async () => {});
    const safety = qualifiedActivationSafety(bound, validEvidence(), { readback }, options);
    await expect(safety.readback(OTHER_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
    expect(readback).not.toHaveBeenCalled();
  });
  it("validates evidence on 6K drain", async () => {
    const safety = qualifiedLotCutoverSafetyFor(bound,
      { ...validEvidence(), releaseId: "other-release" }, ["dest:city::real"], undefined, options);
    await expect(safety.drainDeliveryPaths(WORKSPACE_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_release_mismatch" });
  });
  it("rejects 6K cross-workspace readback without delegating", async () => {
    const readbackAuthorized = vi.fn(async () => {});
    const safety = qualifiedLotCutoverSafetyFor(bound, validEvidence(), ["dest:city::real"], { readbackAuthorized }, options);
    await expect(safety.readbackAuthorized(OTHER_ID))
      .rejects.toMatchObject({ status: 403, message: "maintenance_evidence_workspace_mismatch" });
    expect(readbackAuthorized).not.toHaveBeenCalled();
  });
  it("delegates a declared empty manifest instead of always rejecting", async () => {
    const readbackAuthorized = vi.fn(async () => {});
    const safety = qualifiedLotCutoverSafetyFor(bound, validEvidence(), [], { readbackAuthorized },
      { ...options, qualifiedEmptyManifest: true });
    await expect(safety.readbackAuthorized(WORKSPACE_ID)).resolves.toBeUndefined();
    expect(readbackAuthorized).toHaveBeenCalledExactlyOnceWith(WORKSPACE_ID);
  });
});
