/** PW-D typed errors; PW-C maps them to the section 7.7 envelope. */
export type PwWriteErrorCode =
  | "invalid_facet_command"
  | "write_intent_not_found"
  | "idempotency_key_conflict"
  | "command_context_unresolved"
  | "challenge_consumed"
  | "challenge_expired"
  | "challenge_invalid"
  | "session_expired"
  | "projection_revision_conflict"
  | "facet_head_conflict"
  | "facet_target_version_conflict"
  | "workspace_revision_conflict"
  | "invalid_reason_code"
  | "reason_code_required"
  | "confirmation_identity_mismatch"
  | "write_intent_revoked"
  | "write_grant_revoked"
  | "page_session_revoked"
  | "write_authority_unavailable"
  | "write_fence_unavailable"
  | "write_audit_unavailable"
  | "write_rate_limited"
  | "write_quota_exceeded"
  | "target_not_found";

export class PwWriteError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    message: PwWriteErrorCode,
  ) {
    super(message);
  }
}
