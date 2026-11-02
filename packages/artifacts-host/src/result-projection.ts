import { randomUUID } from "node:crypto";
import type { HttpResponse } from "@sentropic/artifacts/http";
import { ARTIFACT_PROFILE_DESCRIPTOR } from "./p0b-profile.js";

/** Pre-dispatch domain refusals use the binding's projection too. */
export function artifactRefusalResponse(status: number, code: string, retryable = false,
  extra: Record<string, unknown> = {}, version = ARTIFACT_PROFILE_DESCRIPTOR.resultEnvelopeVersion): HttpResponse {
  return { status, body: version === 1 ? { error: code, ...extra } : {
    ok: false, invocationId: randomUUID(), commitState: "not_committed",
    error: { code, message: code, retriable: retryable, ...(Object.keys(extra).length ? { details: extra } : {}) },
  } };
}
