/**
 * 6K cutover shared contracts: stages, gate verdicts, D5 decisions, and
 * safety hooks. No I/O; every value is explicit.
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  LotMigrationReport,
  ManifestRow,
} from "../lot-migration-report/manifest.js";

export type { ManifestRow };

/** The nine protected cutover stages, in order (§6K). */
export const LOT_CUTOVER_STAGES = [
  "commit-barrier",
  "stop-publishers",
  "close-readers",
  "destroy-buffers",
  "recompute-manifest",
  "reconcile-heads",
  "switch-authority",
  "verify-reads",
  "open-destination",
] as const;

export type LotCutoverStage = (typeof LOT_CUTOVER_STAGES)[number];

export interface LotCutoverStatus {
  workspaceId: string;
  maintenanceBarrier: boolean;
  destinationOpen: boolean;
  manifestSha: string | null;
  activatedAt: string | null;
}

export interface PendingTarget {
  targetKey: string;
  cause: string;
}

export interface StoredCutoverTargets {
  unavailable: string[];
  pending: PendingTarget[];
}

export interface ActivationGate {
  workspaceId: string;
  manifestSha: string;
  requiresD5: boolean;
  activatable: boolean;
  reasons: string[];
  ready: string[];
  unavailable: string[];
  pending: PendingTarget[];
  /** Winning source rows named by `activate` dispositions. */
  activatedSourceIds: string[];
}

export interface D5Decision {
  targetKey: string;
  decision: "activate" | "keep-pending";
  reason: string;
  /**
   * Winning source row for `activate`. Required: without an explicit
   * winning row the target stays unavailable (no automatic newest-wins).
   */
  sourceId?: string | undefined;
}

export interface CutoverSafety {
  drainDeliveryPaths: (workspaceId: string) => Promise<void>;
  readbackAuthorized: (workspaceId: string) => Promise<void>;
}

export interface RunLotCutoverInput {
  workspaceId: string;
  actorSub: string;
  report: LotMigrationReport;
  importKey: string;
  confirmCutover: boolean;
  recomputeManifest: () => Promise<LotMigrationReport>;
}

export interface LotCutoverReceipt {
  status: "complete" | "replayed";
  workspaceId: string;
  manifestSha: string;
  stages: LotCutoverStage[];
  counts: { ready: number; pending: number; unavailable: number };
  pending: PendingTarget[];
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHA_PATTERN = /^[a-f0-9]{64}$/;

/** Deterministic import key for cutover reconciliation (stable retries). */
export function cutoverImportKeyFor(workspaceId: string): string {
  const hex = createHash("sha256").update(`lot-cutover-v1:${workspaceId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(16, 19)}-${hex.slice(19, 31)}`;
}

export function newCutoverId(): string {
  return randomUUID();
}
