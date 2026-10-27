/**
 * 6H scoped stream identity: pure helpers shared by attachment, activation,
 * scoped readers, and the scoped writer. No I/O, no defaults, no inference
 * from the current screen: every workspace is explicit.
 */

export const SCOPED_PERSONAL = "personal" as const;
export const LEGACY_EPOCH = "legacy" as const;
export const SCOPED_EPOCH = "scoped" as const;
export const SCOPED_MAINTENANCE_IN_PROGRESS = "scoped_maintenance_in_progress" as const;

/** Distinct maintenance code: retryable, never confused with unavailable scope. */
export function maintenanceScopeError(workspaceId: string): string {
  return `${SCOPED_MAINTENANCE_IN_PROGRESS}:${workspaceId}`;
}

export type FacetWriterEpoch = typeof LEGACY_EPOCH | typeof SCOPED_EPOCH;

export interface StreamIdentity {
  workspaceId: string;
  scope: typeof SCOPED_PERSONAL;
  ownerId: string;
  targetType: "signal";
  citySlug: string;
  nodeType: "Signal" | "DesignationEvent";
  nodeId: string;
  facet: "selection" | "archive";
  basket: "pertinent" | "a_surveiller" | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ScopeError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

/** Preserve the sampled refusal while keeping the BASE scope error contract. */
export class ScopedMaintenanceError extends ScopeError {
  constructor(workspaceId: string) {
    super(503, `scoped_facet_scope_unavailable:${workspaceId}`);
  }
}

/** Canonical identity key: two workspaces never share a stream. */
export function streamKey(identity: StreamIdentity): string {
  return JSON.stringify([
    "facet-stream",
    identity.workspaceId.toLowerCase(),
    identity.scope,
    identity.ownerId.toLowerCase(),
    identity.targetType,
    identity.citySlug,
    identity.nodeType,
    identity.nodeId,
    identity.facet,
    identity.basket,
  ]);
}

export function assertStreamIdentity(identity: StreamIdentity): void {
  if (!UUID_PATTERN.test(identity.workspaceId) || !UUID_PATTERN.test(identity.ownerId)) {
    throw new ScopeError(400, "invalid_scoped_identity");
  }
  if (identity.scope !== SCOPED_PERSONAL) throw new ScopeError(400, "invalid_scoped_identity");
  if (identity.targetType !== "signal") throw new ScopeError(400, "invalid_scoped_identity");
  if (identity.citySlug.length === 0 || identity.nodeId.length === 0) {
    throw new ScopeError(400, "invalid_scoped_identity");
  }
  const basketOk = identity.facet === "selection"
    ? identity.basket === "pertinent" || identity.basket === "a_surveiller"
    : identity.basket === null;
  if (!basketOk) throw new ScopeError(400, "invalid_scoped_identity");
}

/**
 * D3 mapping decision for one account. Exactly one explicit destination
 * attaches; zero or several destinations stay pending (ambiguous). A
 * personal archive is never converted into a workspace archive: the
 * disposition carries no scope conversion.
 */
export type AttachmentDecision =
  | { kind: "attach"; workspaceId: string }
  | { kind: "pending-ambiguous"; workspaceIds: string[] };

export function decideAttachment(
  accountId: string, candidateWorkspaceIds: string[],
): AttachmentDecision {
  if (!UUID_PATTERN.test(accountId)) throw new ScopeError(400, "invalid_scoped_identity");
  const distinct = [...new Set(candidateWorkspaceIds.map((id) => id.toLowerCase()))];
  if (distinct.length === 1) return { kind: "attach", workspaceId: distinct[0]! };
  return { kind: "pending-ambiguous", workspaceIds: distinct.sort() };
}

/** Scoped reads stay unavailable until the workspace epoch is scoped. */
export function requireScopedEpoch(epoch: string | null | undefined, workspaceId: string): void {
  if (epoch !== SCOPED_EPOCH) {
    throw new ScopeError(503, `scoped_facet_scope_unavailable:${workspaceId}`);
  }
}
