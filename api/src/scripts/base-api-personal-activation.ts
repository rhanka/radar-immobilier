/**
 * base-api-personal-activation — 6H protected operator entry (B4.1).
 *
 * Validates explicit flags and qualified maintenance evidence BEFORE any mutation,
 * then calls runPersonalAttachmentActivation. Attachment alone is never activation;
 * resume arrives in the next slice. A scoped receipt with a still-closed destination
 * is never "open-success". No environment file discovery, no silent default.
 */
import { eq, sql } from "drizzle-orm";
import { loadConfig } from "../config.js";
import { createDb, type Database } from "../db/client.js";
import { facetActivationState } from "../db/schema.js";
import { runPersonalAttachmentActivation } from "../services/facets/activation-run.js";
import { authorizePersonalActivationReadback, verifyPersonalActivationPersistence } from "../services/facets/activation-readback.js";
import {
  qualifiedActivationSafety,
  validateQualifiedMaintenanceEvidence,
  type MaintenanceBinding,
} from "../services/facets/activation-maintenance-safety.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USAGE = "usage: --workspace <uuid> --actor <sub> --reason <text> --maintenance-attempt <uuid> "
  + "--release <id> --instance <id> [--instance <id>] --evidence-json '<json>'";

function takeValues(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && index + 1 < args.length) values.push(args[index + 1]!);
  }
  return values;
}

function takeValue(args: string[], flag: string): string | null {
  const values = takeValues(args, flag);
  return values.length > 0 ? values[values.length - 1]! : null;
}
export interface PersonalActivationCommand {
  workspaceId: string;
  actorSub: string;
  reason: string;
  bound: MaintenanceBinding;
  evidence: unknown;
}

/** Parse flags and qualify evidence. Throws usage error before any mutation. */
export function parsePersonalActivationArgs(rawArgs: string[]): PersonalActivationCommand {
  const workspaceId = takeValue(rawArgs, "--workspace");
  const actorSub = takeValue(rawArgs, "--actor");
  const reason = takeValue(rawArgs, "--reason");
  const maintenanceAttemptId = takeValue(rawArgs, "--maintenance-attempt");
  const releaseId = takeValue(rawArgs, "--release");
  const instanceIds = takeValues(rawArgs, "--instance");
  const rawEvidence = takeValue(rawArgs, "--evidence-json");
  if (!workspaceId || !UUID_PATTERN.test(workspaceId)) throw new Error(`${USAGE}: --workspace needs a uuid`);
  if (!actorSub) throw new Error(`${USAGE}: --actor is required`);
  if (!reason || reason.length > 512) throw new Error(`${USAGE}: --reason needs 1..512 chars`);
  if (!maintenanceAttemptId || !UUID_PATTERN.test(maintenanceAttemptId)) {
    throw new Error(`${USAGE}: --maintenance-attempt needs a uuid`);
  }
  if (!releaseId) throw new Error(`${USAGE}: --release is required`);
  if (instanceIds.length === 0) throw new Error(`${USAGE}: at least one --instance is required`);
  if (!rawEvidence) throw new Error(`${USAGE}: --evidence-json is required`);
  let evidence: unknown;
  try {
    evidence = JSON.parse(rawEvidence) as unknown;
  } catch { throw new Error(`${USAGE}: --evidence-json is not valid JSON`); }
  const bound: MaintenanceBinding = { workspaceId, actorSub, maintenanceAttemptId, releaseId, instanceIds };
  validateQualifiedMaintenanceEvidence(evidence, bound);
  return { workspaceId, actorSub, reason, bound, evidence };
}

export interface PersonalActivationReport {
  workspaceId: string;
  epoch: string;
  streamsBound: number;
  sealedUnresolved: number;
  pendingReceipts: number;
  maintenanceBarrier: boolean;
  status: "open-success" | "activation-committed-readback-pending";
}

/** Run validated activation behind the real internal readback gate. */
export async function executePersonalActivation(
  db: Database, command: PersonalActivationCommand,
): Promise<PersonalActivationReport> {
  const safety = qualifiedActivationSafety(command.bound, command.evidence, {
    readback: async (workspaceId) => {
      await authorizePersonalActivationReadback(db, workspaceId, command.actorSub);
      // Derive expectations from attached history, never from possibly missing projections.
      const counts = await db.execute<{ streams: number; bindings: number }>(sql`
        SELECT count(*)::int AS bindings, count(DISTINCT (e.owner_id, e.city_slug,
          e.node_type, e.node_id, e.facet, e.basket))::int AS streams
        FROM facet_events e JOIN facet_stream_attachments a ON a.account_id = e.owner_id
        WHERE a.workspace_id = ${workspaceId} AND a.status = 'attached' AND e.scope = 'personal'`);
      const expected = counts.rows[0]!;
      await verifyPersonalActivationPersistence(db, workspaceId, command.actorSub,
        { ...expected, heads: expected.streams });
    },
  });
  const receipt = await runPersonalAttachmentActivation(db, {
    workspaceId: command.workspaceId, actorSub: command.actorSub, reason: command.reason,
  }, safety);
  const [state] = await db.select().from(facetActivationState)
    .where(eq(facetActivationState.workspaceId, command.workspaceId));
  const maintenanceBarrier = state?.maintenanceBarrier ?? true;
  const open = receipt.sealedUnresolved.length === 0 && maintenanceBarrier === false;
  const status = open ? "open-success" : "activation-committed-readback-pending";
  return {
    workspaceId: receipt.workspaceId,
    epoch: receipt.epoch,
    streamsBound: receipt.streamsBound,
    sealedUnresolved: receipt.sealedUnresolved.length,
    pendingReceipts: receipt.pendingReceipts,
    maintenanceBarrier,
    status,
  };
}

export async function main(rawArgs: string[]): Promise<void> {
  const command = parsePersonalActivationArgs(rawArgs);
  const config = loadConfig();
  const { db, pool } = createDb(config);
  try {
    const report = await executePersonalActivation(db, command);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await pool.end();
  }
}

const invoked = /base-api-personal-activation\.(ts|js)$/.test(process.argv[1] ?? "");
if (invoked) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
