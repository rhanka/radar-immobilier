import { randomUUID } from "node:crypto";
import type { Context } from "hono";

const MESSAGES: Record<string, string> = {
  invalid_facet_command: "Invalid facet command.", invalid_idempotency_key: "Invalid idempotency key.",
  method_not_allowed: "Method not allowed.", unsupported_media_type: "JSON content type required.",
  request_too_large: "Request exceeds the allowed size.", unauthenticated: "Authentication required.",
  session_expired: "Application session expired.", cookie_required: "Application cookie required.",
  page_session_expired: "Page session expired.", write_grant_expired: "Write grant expired.",
  write_grant_required: "Valid write grant required.", delegated_scope_refused: "Delegated scope refused.",
  write_grant_revoked: "Write grant revoked.", page_session_revoked: "Page session revoked.",
  account_not_approved: "Account is not approved.", workspace_not_authorized: "Workspace access refused.",
  capability_required: "Required capability is unavailable.", csrf_refused: "Application CSRF validation refused.",
  challenge_invalid: "Invalid confirmation challenge.", confirmation_identity_mismatch: "Confirmation identity mismatch.",
  write_intent_not_found: "Write intent not found.", target_not_found: "Target not found.",
  challenge_expired: "Confirmation challenge expired.", write_intent_revoked: "Write intent revoked.",
  challenge_consumed: "Confirmation challenge already consumed.", projection_revision_conflict: "Projection revision changed.",
  facet_head_conflict: "Facet head changed.", facet_target_version_conflict: "Target version changed.",
  workspace_revision_conflict: "Workspace revision changed.", idempotency_key_conflict: "Idempotency key conflict.",
  command_context_unresolved: "Command context is unresolved.", personal_history_unresolved: "Personal history is unresolved.",
  reason_code_required: "Reason code required.", invalid_reason_code: "Invalid reason code.",
  write_rate_limited: "Write request rate exceeded.", write_quota_exceeded: "Write admission quota exceeded.",
  write_transport_closed: "Write transport is closed.", write_authority_unavailable: "Write authority is unavailable.",
  write_fence_unavailable: "Write authority fence is unavailable.", write_audit_unavailable: "Write audit is unavailable.",
  signal_capability_unavailable: "Signal capability is unavailable.", source_unavailable: "Source is unavailable.",
  upstream_bad_payload: "Invalid upstream response.", write_outcome_unknown: "Write outcome is unknown.",
  internal_error: "Internal error.",
};

function actionFor(code: string, status: number, unknown: boolean): string {
  if (unknown) return "read_status";
  if (status === 401) return "authenticate";
  if (["csrf_refused", "challenge_invalid", "confirmation_identity_mismatch"].includes(code)) return "confirm_in_application";
  if (status === 403) return "request_access";
  if (status === 404) return "refresh_state";
  if (["challenge_consumed", "challenge_expired", "write_intent_revoked"].includes(code)) return "read_status";
  if (["idempotency_key_conflict", "command_context_unresolved", "personal_history_unresolved"].includes(code)) return "resolve_command";
  if (status === 409) return "refresh_and_confirm";
  if (status === 429) return "wait_then_check_status";
  if (status === 503) return "contact_operator";
  return status === 422 ? "correct_and_confirm" : "correct_request";
}

export function isWriteRefusalCode(code: unknown): code is string {
  return typeof code === "string" && Object.hasOwn(MESSAGES, code);
}

/** Public fixed messages only; request IDs are server-generated, never echoed. */
export function writeRefusal(c: Context, code: string, status: number,
  attemptOutcome: "not_executed" | "unknown" = "not_executed",
  verb: "prepare" | "confirm" | "revoke" | "status" | null = null): Response {
  if (!Object.hasOwn(MESSAGES, code)) { code = "internal_error"; status = 500; attemptOutcome = "unknown"; }
  const action = actionFor(code, status, attemptOutcome === "unknown");
  if (status === 429) c.header("Retry-After", "2");
  const resolved = verb ?? (c.req.path === "/__reader/api/facets.write-intents.prepare.v1"
    || c.req.path === "/api/v1/artifacts/reader/facets/write-intents"
    || c.req.path === "/write-intents" ? "prepare"
    : c.req.path.endsWith("/confirm") ? "confirm" : c.req.path.endsWith("/revoke") ? "revoke" : "status");
  return c.json({ operation: `facets.write-intents.${resolved}.v1`, requestId: randomUUID(),
    error: { code, message: MESSAGES[code], action,
      retryable: status === 429, attemptOutcome } }, status as 400);
}
