/**
 * 6J synthetic importer: qualified 6F evidence into head-only destination
 * projections.
 *
 * Disabled by default: without an explicit opt-in the importer stores
 * nothing and projects nothing. When enabled against an explicitly
 * enabled workspace destination, every manifest row is stored exactly once
 * as immutable source evidence (chain links and exact values preserved),
 * and only the qualified terminal head of each destination stream is
 * projected — head-only initialization, never three active facets from one
 * chain. Cross-facet chains stay intact in source history while the
 * destination uses independent streams. Mixed, unqualified, or conflicting
 * histories stay pending; D5 dispositions belong to the 6K gate, never to
 * this importer. Documentary `author_id` values are stored as observed
 * facts only and never assign stream ownership.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../../db/client.js";
import {
  lotImportRuns,
  lotSourceRows,
} from "../../../db/schema.js";
import { lockWorkspace } from "../../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../../workspaces/store.js";
import { requireScopedEpoch } from "../scope.js";
import { scopedEpochFor } from "../activation.js";
import { digest, FacetError } from "../target.js";
import type { ManifestRow } from "../lot-migration-report/manifest.js";
import { requireLotDestination } from "./lot-gate.js";
import { isProjectableHead, projectTerminalHeads } from "./lot-project.js";
import {
  recordImportReceipt,
  replayRecordedReceipt,
  type LotImportInput,
  type LotImportReceipt,
} from "./lot-import-runs.js";

export const LOT_IMPORTER_VERSION = "lot-importer-v1";
export type {
  LotImportCounts,
  LotImportInput,
  LotImportReceipt,
} from "./lot-import-runs.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runLotImport(
  db: Database, input: LotImportInput, options: { enabled?: boolean } = {},
): Promise<LotImportReceipt> {
  const key = input.importKey.toLowerCase();
  if (!UUID_PATTERN.test(key)) throw new FacetError(400, "invalid_facet_command");
  if (options.enabled !== true) {
    return {
      status: "disabled", workspaceId: input.workspaceId, importKey: key,
      runId: null, manifestSha: input.report.manifestSha256,
      counts: { sourceRows: 0, evidenceStored: 0, projected: 0, alreadyProjected: 0, pending: 0 },
      pending: [],
    };
  }
  return db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId);
    const actorId = await approvedAccountId(tx, input.actorSub, true);
    const access = await resolveWorkspaceAccess(tx, input.workspaceId, input.actorSub);
    if (!access.moderateArchive) throw new FacetError(403, "workspace_capability_required");
    const destination = await requireLotDestination(tx, input.workspaceId);
    requireScopedEpoch(await scopedEpochFor(tx, input.workspaceId), input.workspaceId);
    const [existing] = await tx.select().from(lotImportRuns).where(and(
      eq(lotImportRuns.workspaceId, input.workspaceId),
      eq(lotImportRuns.importKey, key)));
    if (existing) {
      if (existing.manifestSha !== input.report.manifestSha256) {
        throw new FacetError(409, "idempotency_key_conflict");
      }
      return replayRecordedReceipt(existing);
    }
    const runId = randomUUID();
    const mappingQualified = input.report.destinationsQualified === true;
    const ordered = [...input.report.rows].sort((left, right) =>
      left.sourceId < right.sourceId ? -1 : 1);
    let evidenceStored = 0;
    for (const row of ordered) {
      const inserted = await tx.insert(lotSourceRows).values({
        workspaceId: input.workspaceId,
        sourceId: row.sourceId,
        chainId: row.chainId,
        nativeTarget: row.nativeTarget,
        disposition: row.disposition,
        diagnostics: [...row.diagnostics],
        destination: row.destination,
        observed: row.observed,
        manifestSha: input.report.manifestSha256,
        importRunId: runId,
      }).onConflictDoNothing().returning();
      if (inserted.length > 0) evidenceStored += 1;
      else {
        const [stored] = await tx.select().from(lotSourceRows).where(and(
          eq(lotSourceRows.workspaceId, input.workspaceId), eq(lotSourceRows.sourceId, row.sourceId)));
        if (!stored || stored.chainId !== row.chainId || stored.nativeTarget !== row.nativeTarget
          || digest(stored.observed) !== digest(row.observed)) {
          throw new FacetError(409, "lot_source_evidence_conflict");
        }
      }
    }
    const projection = await projectTerminalHeads(tx, {
      workspaceId: input.workspaceId, key, runId, actorId,
      selectionBasket: destination.selectionBasket,
    }, ordered, mappingQualified);
    const pending = [
      ...ordered.filter((row) => !isProjectableHead(row, mappingQualified))
        .map((row) => ({ sourceId: row.sourceId, cause: pendingCause(row, mappingQualified) })),
      ...projection.skipped,
    ].sort((left, right) => (left.sourceId < right.sourceId ? -1 : 1));
    const receipt: LotImportReceipt = {
      status: "complete",
      workspaceId: input.workspaceId,
      importKey: key,
      runId,
      manifestSha: input.report.manifestSha256,
      counts: {
        sourceRows: ordered.length,
        evidenceStored,
        projected: projection.projected,
        alreadyProjected: projection.alreadyProjected,
        pending: pending.length,
      },
      pending,
    };
    await recordImportReceipt(tx, input, runId, receipt, LOT_IMPORTER_VERSION);
    return receipt;
  });
}

function pendingCause(row: ManifestRow, mappingQualified: boolean): string {
  if (!mappingQualified && row.disposition === "mapped") return "destination-unqualified";
  if (row.disposition !== "mapped") return row.disposition;
  if (row.destination === null) return "no-destination";
  if ((row.observed.supersededBy ?? null) !== null) return "non-terminal";
  return "pending";
}
