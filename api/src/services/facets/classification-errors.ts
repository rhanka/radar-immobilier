import { randomUUID } from "node:crypto";
import { ScopeError } from "./scope.js";
import { FacetError } from "./target.js";
import { WorkspaceError } from "../workspaces/types.js";

const errors = {
  invalid_query: [400, "The query is invalid.", "correct_query"],
  invalid_cursor: [400, "The cursor is invalid.", "correct_query"],
  incompatible_continuation: [400, "The continuation does not match this query.", "correct_query"],
  workspace_required: [400, "Select a workspace.", "correct_query"],
  workspace_ambiguous: [400, "Select one workspace explicitly.", "correct_query"],
  unauthenticated: [401, "Authentication is required.", "authenticate"],
  session_expired: [401, "The session expired.", "authenticate"],
  account_not_approved: [403, "The account is not approved.", "request_access"],
  workspace_not_authorized: [403, "Workspace access is required.", "request_access"],
  capability_required: [403, "The required capability is missing.", "request_access"],
  delegated_scope_refused: [403, "The delegated scope was refused.", "request_access"],
  target_not_found: [404, "The target was not found.", "correct_query"],
  snapshot_changed: [409, "The classification view changed. Restart the query.", "restart_query"],
  cursor_expired: [409, "The cursor expired. Restart the query.", "restart_query"],
  reveal_required: [409, "Explicit reveal is required.", "request_reveal"],
  request_too_large: [413, "The request is too large.", "reduce_request"],
  request_uri_too_long: [414, "The request URI is too long.", "reduce_request"],
  internal_error: [500, "The classification read failed.", "contact_operator"],
  upstream_bad_payload: [502, "The projection payload is invalid.", "contact_operator"],
  signal_capability_unavailable: [503, "Signal classification is unavailable.", "contact_operator"],
  lot_cutover_closed: [503, "Lot classification is closed.", "contact_operator"],
  personal_history_unresolved: [503, "Personal history is unresolved.", "contact_operator"],
  transport_unavailable: [503, "The read transport is unavailable.", "contact_operator"],
  catalog_unavailable: [503, "The reason catalog is unavailable.", "contact_operator"],
  projection_revision_unstable: [503, "The projection revision is unstable.", "retry_read"],
  projection_payload_too_large: [503, "The projection payload is too large.", "contact_operator"],
} as const;
export type ClassificationCode = keyof typeof errors;
export class ClassificationError extends Error {
  constructor(public code: ClassificationCode, public suggestedLimit?: number) { super(code); }
}
export function classificationFailure(cause: unknown) {
  let error = cause instanceof ClassificationError ? cause : new ClassificationError("internal_error");
  if (cause instanceof ScopeError || cause instanceof WorkspaceError || cause instanceof FacetError) {
    const code = cause.message;
    if (code === "workspace_not_found" || code === "workspace_membership_required") {
      error = new ClassificationError("workspace_not_authorized");
    } else if (code.startsWith("scoped_facet_scope_unavailable:")) {
      error = new ClassificationError("signal_capability_unavailable");
    } else if (Object.hasOwn(errors, code)) error = new ClassificationError(code as ClassificationCode);
  }
  const [status, message, action] = errors[error.code];
  return { status, body: { ok: false as const, error: { code: error.code, message,
    retryable: ["snapshot_changed", "cursor_expired", "projection_revision_unstable"].includes(error.code),
    action: error.suggestedLimit ? "reduce_limit" : action,
    ...(error.suggestedLimit ? { suggestedLimit: error.suggestedLimit } : {}),
  }, requestId: randomUUID() } };
}
