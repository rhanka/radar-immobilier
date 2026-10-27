/**
 * 6I workspace-archive UI client: intentions and effective-hiding helpers.
 *
 * Personal and workspace archive heads stay separate so the UI can explain
 * effective hiding without exposing another member's private state. The
 * client never supplies an actor, an owner, or a workspace default: every
 * command carries the explicit workspace, the expected workspace head,
 * and the displayed source fingerprint captured with the intention.
 */

export interface WorkspaceArchiveTarget {
  citySlug: string;
  type: "Signal" | "DesignationEvent";
  id: string;
}

export interface WorkspaceArchiveHeadView {
  id: string;
  state: string;
  reasonCode: string | null;
  targetAvailable: boolean;
  changedSinceArchive: boolean | null;
}

export interface WorkspaceArchiveView {
  target: WorkspaceArchiveTarget;
  personal: WorkspaceArchiveHeadView | null;
  workspace: WorkspaceArchiveHeadView | null;
  effectiveDiscarded: boolean;
  capabilities: { discardPersonally: boolean; moderateArchive: boolean };
}

export class WorkspaceArchiveClientError extends Error {
  constructor(message: string) {
    super(message);
  }
}

const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Effective hiding: an active archive in either scope hides the target. */
export function effectiveWorkspaceHiding(
  view: Pick<WorkspaceArchiveView, "personal" | "workspace">,
): boolean {
  return view.personal?.state === "active" || view.workspace?.state === "active";
}

export type ArchiveHidingExplanation =
  | "visible"
  | "hidden-by-personal"
  | "hidden-by-workspace"
  | "hidden-by-both";

/** Explain which scope hides the target; never names another member. */
export function explainWorkspaceHiding(
  view: Pick<WorkspaceArchiveView, "personal" | "workspace">,
): ArchiveHidingExplanation {
  const personal = view.personal?.state === "active";
  const workspace = view.workspace?.state === "active";
  if (personal && workspace) return "hidden-by-both";
  if (workspace) return "hidden-by-workspace";
  if (personal) return "hidden-by-personal";
  return "visible";
}

export interface WorkspaceArchiveBody {
  target: WorkspaceArchiveTarget;
  reasonCode?: string;
  expectedHeadId: string | null;
  displayedFingerprint: string;
}

/**
 * Build a workspace discard/restore body. The expected head must be
 * explicit (null means no workspace head); a restore never carries a
 * reason code.
 */
export function buildWorkspaceArchiveBody(
  action: "discard" | "restore",
  body: WorkspaceArchiveBody,
): Record<string, unknown> {
  if (body.target.citySlug.length === 0 || body.target.id.length === 0) {
    throw new WorkspaceArchiveClientError("invalid_facet_command");
  }
  if (body.expectedHeadId !== null && !UUID_PATTERN.test(body.expectedHeadId)) {
    throw new WorkspaceArchiveClientError("invalid_facet_command");
  }
  if (!FINGERPRINT_PATTERN.test(body.displayedFingerprint)) {
    throw new WorkspaceArchiveClientError("invalid_facet_command");
  }
  if (action === "discard") {
    if (!body.reasonCode || body.reasonCode.length === 0) {
      throw new WorkspaceArchiveClientError("reason_code_required");
    }
    return { target: body.target, reasonCode: body.reasonCode,
      expectedHeadId: body.expectedHeadId, displayedFingerprint: body.displayedFingerprint };
  }
  if (body.reasonCode !== undefined) {
    throw new WorkspaceArchiveClientError("invalid_facet_command");
  }
  return { target: body.target,
    expectedHeadId: body.expectedHeadId, displayedFingerprint: body.displayedFingerprint };
}
