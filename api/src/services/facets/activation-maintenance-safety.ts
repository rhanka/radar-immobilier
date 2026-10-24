/** Internal 6H/6K evidence validation; real readback remains mandatory. */
import type { ActivationSafety } from "./activation.js";
import type { CutoverSafety } from "./lots/lot-cutover-types.js";
import { ScopeError } from "./scope.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface MaintenanceCoverageProof {
  completedAt: string;
  coveredInstanceIds: string[];
}

export interface MaintenanceBinding {
  workspaceId: string;
  actorSub: string;
  maintenanceAttemptId: string;
  releaseId: string;
  instanceIds: string[];
}
export interface QualifiedMaintenanceEvidence extends MaintenanceBinding {
  reason: string;
  drain: MaintenanceCoverageProof;
  shutdown: MaintenanceCoverageProof;
}

export interface MaintenanceEvidenceOptions {
  now?: Date;
  maxAgeMs?: number;
  /** Explicitly declared qualified empty history; undeclared emptiness stays refused. */
  qualifiedEmptyManifest?: boolean;
  /** Real zero-head proof scope required when qualifiedEmptyManifest is set. */
  emptyReadbackScope?: { citySlugs: string[]; modes: ("real" | "simulation")[] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkCoverage(
  proof: unknown, instances: Set<string>, missing: "maintenance_drain_unconfirmed" | "maintenance_shutdown_unconfirmed",
  nowMs: number, maxAgeMs: number,
): void {
  if (!isRecord(proof)) throw new ScopeError(503, missing);
  const completedAt = proof["completedAt"];
  const covered = proof["coveredInstanceIds"];
  if (typeof completedAt !== "string" || !Array.isArray(covered)) throw new ScopeError(503, missing);
  const atMs = Date.parse(completedAt);
  if (Number.isNaN(atMs)) throw new ScopeError(400, "invalid_maintenance_evidence");
  if (atMs > nowMs || atMs < nowMs - maxAgeMs) throw new ScopeError(503, "maintenance_evidence_obsolete");
  const coveredSet = new Set(covered.filter((id): id is string => typeof id === "string"));
  for (const id of instances) {
    if (!coveredSet.has(id)) throw new ScopeError(503, missing);
  }
}

/** Reject missing, mismatched or obsolete maintenance evidence with closed errors. */
export function validateQualifiedMaintenanceEvidence(
  evidence: unknown, bound: MaintenanceBinding,
  options: MaintenanceEvidenceOptions = {},
): asserts evidence is QualifiedMaintenanceEvidence {
  if (!isRecord(evidence)) throw new ScopeError(503, "maintenance_evidence_required");
  const workspaceId = evidence["workspaceId"];
  const actorSub = evidence["actorSub"];
  const reason = evidence["reason"];
  const maintenanceAttemptId = evidence["maintenanceAttemptId"];
  const releaseId = evidence["releaseId"];
  const instanceIds = evidence["instanceIds"];
  if (typeof workspaceId !== "string" || !UUID_PATTERN.test(workspaceId)) {
    throw new ScopeError(503, "maintenance_evidence_required");
  }
  if (workspaceId.toLowerCase() !== bound.workspaceId.toLowerCase()) {
    throw new ScopeError(403, "maintenance_evidence_workspace_mismatch");
  }
  if (typeof actorSub !== "string" || actorSub.length === 0) {
    throw new ScopeError(503, "maintenance_evidence_required");
  }
  if (actorSub !== bound.actorSub) throw new ScopeError(403, "maintenance_evidence_actor_mismatch");
  if (typeof reason !== "string" || reason.length === 0 || reason.length > 512) {
    throw new ScopeError(400, "invalid_activation_command");
  }
  if (typeof maintenanceAttemptId !== "string" || !UUID_PATTERN.test(maintenanceAttemptId)) {
    throw new ScopeError(400, "invalid_maintenance_attempt");
  }
  if (maintenanceAttemptId !== bound.maintenanceAttemptId) throw new ScopeError(403, "maintenance_evidence_attempt_mismatch");
  if (typeof releaseId !== "string" || releaseId.length === 0) {
    throw new ScopeError(503, "maintenance_evidence_release_required");
  }
  if (releaseId !== bound.releaseId) throw new ScopeError(403, "maintenance_evidence_release_mismatch");
  if (!Array.isArray(instanceIds) || instanceIds.length === 0
    || !instanceIds.every((id): id is string => typeof id === "string" && id.length > 0)) {
    throw new ScopeError(503, "maintenance_evidence_instances_required");
  }
  const instances = new Set(instanceIds as string[]);
  if (!bound.instanceIds.length || instances.size !== bound.instanceIds.length
    || !bound.instanceIds.every((id) => instances.has(id))) throw new ScopeError(403, "maintenance_evidence_instances_mismatch");
  const nowMs = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw new ScopeError(400, "invalid_maintenance_evidence");
  checkCoverage(evidence["drain"], instances, "maintenance_drain_unconfirmed", nowMs, maxAgeMs);
  checkCoverage(evidence["shutdown"], instances, "maintenance_shutdown_unconfirmed", nowMs, maxAgeMs);
}

function checkBoundWorkspace(boundWorkspaceId: string, workspaceId: string): void {
  if (workspaceId.toLowerCase() !== boundWorkspaceId.toLowerCase()) {
    throw new ScopeError(403, "maintenance_evidence_workspace_mismatch");
  }
}

/** 6H safety bound to the current authorized actor and workspace. Internal only. */
export function qualifiedActivationSafety(
  bound: MaintenanceBinding, evidence: unknown,
  delegate?: { readback: (workspaceId: string) => Promise<void> },
  options: MaintenanceEvidenceOptions = {},
): ActivationSafety {
  return {
    drain: async (workspaceId: string) => {
      checkBoundWorkspace(bound.workspaceId, workspaceId);
      validateQualifiedMaintenanceEvidence(evidence, bound, options);
    },
    readback: async (workspaceId: string) => {
      checkBoundWorkspace(bound.workspaceId, workspaceId);
      validateQualifiedMaintenanceEvidence(evidence, bound, options);
      if (!delegate) throw new ScopeError(503, "activation_readback_unconfirmed");
      await delegate.readback(workspaceId);
    },
  };
}

/** 6K adapter bound to the current authorized actor and workspace. Internal only. */
export function qualifiedLotCutoverSafetyFor(
  bound: MaintenanceBinding, evidence: unknown, readyTargets: string[],
  delegate?: { readbackAuthorized: (workspaceId: string) => Promise<void> },
  options: MaintenanceEvidenceOptions = {},
): CutoverSafety {
  return {
    drainDeliveryPaths: async (workspaceId: string) => {
      checkBoundWorkspace(bound.workspaceId, workspaceId);
      validateQualifiedMaintenanceEvidence(evidence, bound, options);
    },
    readbackAuthorized: async (workspaceId: string) => {
      checkBoundWorkspace(bound.workspaceId, workspaceId);
      validateQualifiedMaintenanceEvidence(evidence, bound, options);
      if (readyTargets.length === 0 && options.qualifiedEmptyManifest !== true) {
        throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
      }
      if (!delegate) throw new ScopeError(503, "lot_cutover_readback_unconfirmed");
      await delegate.readbackAuthorized(workspaceId);
    },
  };
}
