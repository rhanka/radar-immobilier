/**
 * 6J import run ledger.
 *
 * One recorded receipt per (workspace, import key): exact retry returns
 * the recorded result, a reused key with a different manifest conflicts.
 * The ledger persists counts plus the pending-cause list so replay is
 * exact without re-reading the manifest.
 */
import type { Database } from "../../../db/client.js";
import { lotImportRuns } from "../../../db/schema.js";
import { FacetError } from "../target.js";
import type { LotMigrationReport } from "../lot-migration-report/manifest.js";

export interface LotImportInput {
  workspaceId: string;
  report: LotMigrationReport;
  actorSub: string;
  importKey: string;
}

export interface LotImportCounts {
  sourceRows: number;
  evidenceStored: number;
  projected: number;
  alreadyProjected: number;
  pending: number;
}

export interface LotImportReceipt {
  status: "complete" | "disabled" | "replayed";
  workspaceId: string;
  importKey: string;
  runId: string | null;
  manifestSha: string;
  counts: LotImportCounts;
  pending: Array<{ sourceId: string; cause: string }>;
}

type ImportTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function recordImportReceipt(
  tx: ImportTx, input: LotImportInput, runId: string, receipt: LotImportReceipt,
  importerVersion: string,
): Promise<void> {
  await tx.insert(lotImportRuns).values({
    id: runId,
    workspaceId: input.workspaceId,
    importKey: receipt.importKey,
    manifestSha: input.report.manifestSha256,
    mappingVersion: input.report.mappingVersion,
    importerVersion,
    sourceSnapshotId: input.report.sourceSnapshotId,
    counts: { counts: receipt.counts, pending: receipt.pending },
    status: "complete",
  }).onConflictDoNothing();
}

export function replayRecordedReceipt(
  existing: typeof lotImportRuns.$inferSelect,
): LotImportReceipt {
  const stored = existing.counts as {
    counts?: LotImportCounts;
    pending?: Array<{ sourceId: string; cause: string }>;
  };
  if (!stored || typeof stored !== "object" || !stored.counts || !Array.isArray(stored.pending)) {
    throw new FacetError(409, "command_context_unresolved");
  }
  return {
    status: "replayed",
    workspaceId: existing.workspaceId,
    importKey: existing.importKey,
    runId: existing.id,
    manifestSha: existing.manifestSha,
    counts: stored.counts,
    pending: stored.pending,
  };
}
