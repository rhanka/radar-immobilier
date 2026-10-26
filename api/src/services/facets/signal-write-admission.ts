/** One commit for PW-D admission and the existing BASE executors. */
import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { facetCommandContexts, facetCommands } from "../../db/schema.js";
import { lockWorkspace } from "../workspaces/mutations.js";
import { approvedAccountId, resolveWorkspaceAccess } from "../workspaces/store.js";
import { WorkspaceError } from "../workspaces/types.js";
import { lockCityGraph } from "../graph/graph-store.js";
import { writeScopedPersonalFacetInTx } from "./scoped-writer.js";
import { writeWorkspaceArchiveFacetInTx } from "./workspace-writer.js";
import { ScopeError } from "./scope.js";
import { FacetError } from "./target.js";
import {
  assertAdmissionWindow, assertSignalWriteInput, isPersonalOperation,
  signalWriteOperationDigest, type SignalWriteInput,
} from "./signal-write-operations.js";
import { assertScopeTokenMatches, readScopeTokenInTx, type WriteTx } from "./signal-write-scope.js";
import type { SignalWriteAdmission } from "./signal-write-admission-port.js";
import { projectSignalWriteEvent, type SignalWriteEvent } from "./signal-write-receipt.js";

export type { SignalWriteInput };
export interface SignalWriteResult {
  event: SignalWriteEvent | null;
  scopeBefore: string;
  scopeAfter: string;
}

function actionFor(input: SignalWriteInput): "select" | "deselect" | "discard" | "restore" {
  if (input.operation.endsWith(".select.v1")) return "select";
  if (input.operation.endsWith(".deselect.v1")) return "deselect";
  if (input.operation.endsWith(".discard.v1")) return "discard";
  return "restore";
}

/** Public BASE wrapper; PW-D must supply its transactional admission port. */
export async function coordinateSignalWrite(
  db: Database, sub: string, input: SignalWriteInput, admission: SignalWriteAdmission,
  clock: () => number = Date.now,
): Promise<SignalWriteResult> {
  assertSignalWriteInput(input);
  // Copy before any await: callers cannot replace a prepared value mid-admission.
  const prepared = JSON.parse(JSON.stringify(input)) as SignalWriteInput;
  return db.transaction((tx) => executeSignalWriteInTx(tx, sub, prepared, admission, clock),
    { isolationLevel: "read committed" });
}

/** PW-D may join its own READ COMMITTED transaction here, never a savepoint facade. */
export async function executeSignalWriteInTx(
  tx: WriteTx, sub: string, input: SignalWriteInput, admission: SignalWriteAdmission,
  clock: () => number = Date.now,
): Promise<SignalWriteResult> {
  try {
    return await admitSignalWriteInTx(tx, sub, input, admission, clock);
  } catch (error) {
    // Only execution failures are known pre-commit; never catch COMMIT acknowledgement here.
    const seen = new Set<unknown>();
    let cause: unknown = error;
    while (cause && typeof cause === "object" && !seen.has(cause)) {
      seen.add(cause);
      const detail = cause as { code?: unknown; cause?: unknown };
      if (detail.code === "55P03") {
        const refusal = new ScopeError(503, "write_fence_unavailable");
        refusal.cause = error;
        throw refusal;
      }
      cause = detail.cause;
    }
    throw error;
  }
}

async function admitSignalWriteInTx(
  tx: WriteTx, sub: string, input: SignalWriteInput, admission: SignalWriteAdmission,
  clock: () => number,
): Promise<SignalWriteResult> {
  assertSignalWriteInput(input);
  input = JSON.parse(JSON.stringify(input)) as SignalWriteInput;
  if (!admission || [admission.lockAuthority, admission.reserve, admission.consume,
    admission.recordCommit].some((hook) => typeof hook !== "function")) {
    throw new ScopeError(503, "write_authority_unavailable");
  }
  const started = clock();
  await tx.execute(sql`SET LOCAL lock_timeout = '1s'`);
  await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
  const isolation = await tx.execute<{ isolation: string }>(sql`
    SELECT current_setting('transaction_isolation') AS isolation`);
  if (isolation.rows[0]?.isolation !== "read committed") {
    throw new ScopeError(503, "write_fence_unavailable");
  }
  await admission.lockAuthority(tx, input);
  await lockWorkspace(tx, input.workspaceId);
  const actorId = await approvedAccountId(tx, sub, true);
  const access = await resolveWorkspaceAccess(tx, input.workspaceId, sub);
  if (!isPersonalOperation(input.operation) && !access.moderateArchive) {
    throw new WorkspaceError(403, "workspace_capability_required");
  }
  const key = input.commandKey.toLowerCase();
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(
    ["scoped-command", actorId, key])}, 0))`);
  await admission.reserve(tx, { actorId, commandKey: key,
    operationDigest: signalWriteOperationDigest(input) });
  // A pending intent must never adopt a receipt created by another BASE path.
  const [receipt] = await tx.select().from(facetCommands).where(sql`
    ${facetCommands.ownerId} = ${actorId} AND ${facetCommands.commandKey} = ${key}`);
  const [context] = await tx.select().from(facetCommandContexts).where(sql`
    ${facetCommandContexts.ownerId} = ${actorId} AND ${facetCommandContexts.commandKey} = ${key}`);
  if (receipt || context) throw new FacetError(409, "command_context_unresolved");
  await lockCityGraph(tx, input.target.citySlug);
  const before = await readScopeTokenInTx(tx, sub, input.workspaceId, input.target.citySlug);
  assertScopeTokenMatches(input.expectedProjectionToken, before);
  assertAdmissionWindow(clock(), input.expiresAtMs);
  await admission.consume(tx);
  const action = actionFor(input);
  const command = { action, target: input.target, basket: input.basket,
    reasonCode: input.reasonCode, deselect: input.deselect,
    expectedHeadId: input.expectedHeadId, expectedSelectionHeads: input.expectedSelectionHeads,
    displayedFingerprint: input.displayedFingerprint, commandKey: key };
  const event = isPersonalOperation(input.operation)
    ? await writeScopedPersonalFacetInTx(tx, sub, input.workspaceId, command)
    : await writeWorkspaceArchiveFacetInTx(tx, sub, input.workspaceId, {
      action: action as "discard" | "restore", target: input.target,
      reasonCode: input.reasonCode, expectedHeadId: input.expectedHeadId,
      displayedFingerprint: input.displayedFingerprint, commandKey: key,
    });
  const after = await readScopeTokenInTx(tx, sub, input.workspaceId, input.target.citySlug);
  const result = { event: projectSignalWriteEvent(event), scopeBefore: before, scopeAfter: after };
  await admission.recordCommit(tx, result);
  // Last clock sample follows every hook, lock, writer, receipt, and audit wait.
  const now = clock();
  assertAdmissionWindow(now, input.expiresAtMs);
  if (now - started >= 5_000) throw new ScopeError(503, "write_fence_unavailable");
  return result;
}
