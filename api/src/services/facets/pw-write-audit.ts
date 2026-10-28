import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { pwWriteAudit } from "../../db/schema-pw-write.js";
import type { WriteTx } from "./signal-write-scope.js";

export type PwAuditResult =
  | "committed" | "replay_denied" | "denied" | "unknown"
  | "receipt_read" | "revoked" | "expired";

export interface PwAuditEntry {
  requestId?: string;
  intentId: string;
  invocationId: string;
  commandId?: string | null;
  operation: string;
  workspaceId: string;
  target?: unknown;
  scope?: "personal" | "workspace" | null;
  artifactRef?: Record<string, unknown>;
  grantRef?: string | null;
  principal: unknown;
  operationDigest: string;
  intentDigest?: string | null;
  result: PwAuditResult;
}

/**
 * Technical audit without cookies, tokens, CSRF keys, payloads or texts.
 * The caller owns commit and rollback; failures throw to roll back.
 */
export async function appendPwAudit(tx: WriteTx, entry: PwAuditEntry): Promise<void> {
  const principal = entry.principal as Record<string, unknown>;
  const artifactRef = Object.fromEntries(["artifactId", "releaseId", "host", "profileName",
    "profileFingerprint", "policyRevision"].flatMap((key) =>
    typeof entry.artifactRef?.[key] === "string" ? [[key, entry.artifactRef[key]]] : []));
  const target = entry.target as Record<string, unknown> | undefined;
  const targetRef = target ? Object.fromEntries(["citySlug", "type", "id"].flatMap((key) =>
    typeof target[key] === "string" ? [[key, target[key]]] : [])) : null;
  await tx.insert(pwWriteAudit).values({
    requestId: (entry.requestId ?? randomUUID()).toLowerCase(),
    intentId: entry.intentId.toLowerCase(),
    invocationId: entry.invocationId.toLowerCase(),
    commandId: entry.commandId ? entry.commandId.toLowerCase() : null,
    operation: entry.operation,
    workspaceId: entry.workspaceId.toLowerCase(),
    target: targetRef,
    scope: entry.scope ?? null,
    artifactRef,
    grantRef: entry.grantRef ?? null,
    principal: { issuer: principal.issuer, sub: principal.sub, tier: principal.tier },
    operationDigest: entry.operationDigest,
    intentDigest: entry.intentDigest ?? null,
    result: entry.result,
  });
}

/** Refusal audit never authorizes a mutation; its own failure refuses too. */
export async function appendPwRefusal(tx: WriteTx,
  entry: Omit<PwAuditEntry, "result"> & { result?: Exclude<PwAuditResult, "committed"> },
): Promise<void> {
  await appendPwAudit(tx, { ...entry, result: entry.result ?? "denied" });
}

export async function readPwAuditForIntent(tx: WriteTx, intentId: string) {
  return tx.select().from(pwWriteAudit)
    .where(eq(pwWriteAudit.intentId, intentId.toLowerCase()))
    .orderBy(sql`${pwWriteAudit.decidedAt} ASC`);
}
