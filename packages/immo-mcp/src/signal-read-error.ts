/** Public signal errors contain only fixed messages and allowlisted codes. */
const definitions = {
  signal_cutover_in_progress: [true, "retry_later", "Signal search is temporarily unavailable during activation. Retry later."],
  signal_route_retired: [false, "contact_operator", "The signal route has been retired. Contact the operator."],
  signal_capability_unavailable: [false, "contact_operator", "Signal search is unavailable for this context."],
  signal_history_unresolved: [false, "contact_operator", "Signal history requires operator resolution."],
  signal_projection_unstable: [true, "retry_later", "Signal data changed during the read. Retry later."],
  workspace_missing: [false, "contact_operator", "No authorized workspace is available."],
  workspace_ambiguous: [false, "contact_operator", "Multiple workspaces require operator configuration."],
  workspace_malformed: [false, "contact_operator", "The workspace identifier is invalid."],
  workspace_not_authorized: [false, "contact_operator", "The requested workspace is not authorized."],
  workspace_context_changed: [true, "retry_later", "The workspace context changed. Invoke the search again."],
  unauthenticated: [false, "reconnect_account", "The API credential was refused. Reconnect your account."],
  forbidden: [false, "contact_operator", "Signal access was refused."],
  account_not_approved: [false, "contact_operator", "The account is not approved."],
  workspace_membership_required: [false, "contact_operator", "Active workspace membership is required."],
  delegated_scope_refused: [false, "contact_operator", "The delegated request is outside the authorized profile."],
  signal_endpoint_unavailable: [false, "contact_operator", "The signal endpoint is unavailable."],
  radar_api_bad_payload: [false, "contact_operator", "The signal API response is invalid."],
  radar_api_unavailable: [true, "retry_later", "The signal API is temporarily unavailable."],
  radar_api_unreachable: [true, "retry_later", "The signal API could not be reached."],
} as const;
export type RadarSignalReadCode = keyof typeof definitions;

export class RadarSignalReadError extends Error {
  readonly retryable: boolean;
  readonly action: string;
  constructor(readonly code: RadarSignalReadCode, readonly upstreamStatus?: number) {
    const [retryable, action, message] = definitions[code];
    super(message);
    this.name = "RadarSignalReadError";
    this.retryable = retryable;
    this.action = action;
  }
  toPublicPayload(tool: string, correlationId: string) {
    return { error: this.code, message: this.message, retryable: this.retryable,
      action: this.action, ...(this.upstreamStatus === undefined ? {} : { upstreamStatus: this.upstreamStatus }),
      tool, correlationId };
  }
}

/** Decode only recognized status/code pairs; never follow successor text. */
export async function decodeSignalReadError(response: Response): Promise<RadarSignalReadError> {
  const status = response.status;
  let code: unknown;
  try { code = (await response.json() as { error?: unknown } | null)?.error; } catch { /* Fixed fallback below. */ }
  if (status === 401) return new RadarSignalReadError("unauthenticated", status);
  if (status === 404) return new RadarSignalReadError("signal_endpoint_unavailable", status);
  if (status === 410 && code === "legacy_retired") return new RadarSignalReadError("signal_route_retired", status);
  if (status === 503) {
    if (code === "legacy_cutover_closed") return new RadarSignalReadError("signal_cutover_in_progress", status);
    if (typeof code === "string"
      && /^scoped_maintenance_in_progress:[0-9a-f-]{36}$/i.test(code)) {
      return new RadarSignalReadError("signal_cutover_in_progress", status);
    }
    if (code === "capability_unavailable" ||
      (typeof code === "string" && /^scoped_facet_scope_unavailable:[0-9a-f-]{36}$/i.test(code))) {
      return new RadarSignalReadError("signal_capability_unavailable", status);
    }
    if (code === "personal_history_unresolved") return new RadarSignalReadError("signal_history_unresolved", status);
    if (code === "projection_revision_unstable") return new RadarSignalReadError("signal_projection_unstable", status);
  }
  const allowed: Record<number, readonly RadarSignalReadCode[]> = {
    400: ["workspace_malformed"],
    403: ["workspace_missing", "workspace_not_authorized", "account_not_approved",
      "workspace_membership_required", "delegated_scope_refused"],
    409: ["workspace_ambiguous", "workspace_context_changed"],
  };
  if (typeof code === "string" && allowed[status]?.includes(code as RadarSignalReadCode)) {
    return new RadarSignalReadError(code as RadarSignalReadCode, status);
  }
  return new RadarSignalReadError(status === 403 ? "forbidden" : "radar_api_unavailable", status);
}
