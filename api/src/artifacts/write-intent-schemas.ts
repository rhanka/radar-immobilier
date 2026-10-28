import { FacetError } from "../services/facets/target.js";
import { assertSignalWriteInput, type SignalWriteInput } from "../services/facets/signal-write-operations.js";

export type WritePrepareBody = Omit<SignalWriteInput, "commandKey" | "expiresAtMs">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reuse PW-B's closed six-operation schema without accepting server fields. */
export function assertWritePrepareBody(body: unknown): asserts body is WritePrepareBody {
  if (body === null || typeof body !== "object" || Array.isArray(body)
    || "commandKey" in body || "expiresAtMs" in body) {
    throw new FacetError(400, "invalid_facet_command");
  }
  assertSignalWriteInput({ ...body, commandKey: "00000000-0000-4000-8000-000000000000", expiresAtMs: 0 });
  const id = (body as WritePrepareBody).target.id;
  if (Buffer.from(id, "utf8").toString("utf8") !== id) throw new FacetError(400, "invalid_facet_command");
}

export function assertIdempotencyKey(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new FacetError(400, "invalid_idempotency_key");
}

export type WriteIntentState = "pending" | "committed" | "rejected" | "expired" | "revoked";

export function assertWriteIntentState(value: unknown): asserts value is WriteIntentState {
  if (value !== "pending" && value !== "committed" && value !== "rejected"
    && value !== "expired" && value !== "revoked") throw new FacetError(400, "invalid_facet_command");
}
