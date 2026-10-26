import { describe, expect, it } from "vitest";
import { decodeSignalReadError, RadarSignalReadError } from "./signal-read-error.js";

describe("public signal failures", () => {
  it.each([
    [503, "legacy_cutover_closed", "signal_cutover_in_progress", true, "retry_later"],
    [410, "legacy_retired", "signal_route_retired", false, "contact_operator"],
    [404, "anything", "signal_endpoint_unavailable", false, "contact_operator"],
    [503, "scoped_facet_scope_unavailable:12345678-1234-4234-9234-123456789abc", "signal_capability_unavailable", false, "contact_operator"],
    [503, "scoped_maintenance_in_progress:12345678-1234-4234-9234-123456789abc", "signal_cutover_in_progress", true, "retry_later"],
    [503, "personal_history_unresolved", "signal_history_unresolved", false, "contact_operator"],
    [503, "projection_revision_unstable", "signal_projection_unstable", true, "retry_later"],
    [401, "secret", "unauthenticated", false, "reconnect_account"],
    [403, "secret", "forbidden", false, "contact_operator"],
    [409, "workspace_ambiguous", "workspace_ambiguous", false, "contact_operator"],
    [500, "legacy_cutover_closed", "radar_api_unavailable", true, "retry_later"],
  ] as const)("decodes %s/%s to a bounded public error", async (status, upstream, code, retryable, action) => {
    const error = await decodeSignalReadError(Response.json({ error: upstream,
      successor: "https://internal/secret-token", detail: "private-subject" }, { status }));
    expect(error).toBeInstanceOf(RadarSignalReadError);
    expect(error.toPublicPayload("search_signals", "request-id")).toMatchObject({
      error: code, retryable, action, upstreamStatus: status, tool: "search_signals", correlationId: "request-id",
    });
    expect(JSON.stringify(error.toPublicPayload("search_signals", "request-id")))
      .not.toMatch(/internal|secret-token|private-subject|12345678/);
  });
  it("uses fixed fallbacks for malformed upstream bodies and payload errors", async () => {
    expect((await decodeSignalReadError(new Response("secret", { status: 503 }))).code).toBe("radar_api_unavailable");
    expect(new RadarSignalReadError("radar_api_bad_payload").toPublicPayload("search_signals", "id"))
      .toMatchObject({ error: "radar_api_bad_payload", retryable: false, action: "contact_operator" });
  });
});
