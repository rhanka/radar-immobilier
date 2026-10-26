import type { Context } from "hono";
import { FacetError } from "../services/facets/target.js";
import { PwWriteError } from "../services/facets/pw-write-errors.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { toWriteRefusal } from "../services/facets/signal-write-receipt.js";
import { writeRefusal } from "./write-intent-refusal.js";

/** Preserve domain refusals; unexpected storage errors never reach the client. */
export function writeIntentError(c: Context, error: unknown): Response {
  if (error instanceof PwWriteError) return writeRefusal(c, error.message, error.status);
  if (error instanceof FacetError || error instanceof ScopeError || error instanceof WorkspaceError) {
    const mapped = toWriteRefusal(error);
    return writeRefusal(c, mapped.code === "internal_error" ? error.message : mapped.code,
      mapped.code === "internal_error" ? error.status : mapped.status);
  }
  return writeRefusal(c, "write_outcome_unknown", 504, "unknown");
}
