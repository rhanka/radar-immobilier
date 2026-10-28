/**
 * PW-A write profile: the closed H5 signal write surface.
 * Read profiles stay unchanged; this module only names the write release.
 * No I/O, no grants, no routes.
 */
import {
  PERSONAL_WRITE_OPERATIONS,
  WORKSPACE_WRITE_OPERATIONS,
  type SignalWriteOperation,
} from "../services/facets/signal-write-operations.js";

export const WRITE_PROFILE_NAME = "h5-signal-write-v2";
export const WRITE_GRANT_AUDIENCE = "radar-artifact-write";
export const WRITE_GRANT_TTL_SECONDS = 120;
export const WRITE_PROFILE_PERMITS_WRITES = true;

export const SIGNAL_WRITE_OPERATIONS: readonly SignalWriteOperation[] = [
  ...PERSONAL_WRITE_OPERATIONS,
  ...WORKSPACE_WRITE_OPERATIONS,
];

export type WriteCapability =
  | "facets.signals.personal.select"
  | "facets.signals.personal.deselect"
  | "facets.signals.personal.discard"
  | "facets.signals.personal.restore"
  | "facets.signals.workspace.discard"
  | "facets.signals.workspace.restore";

export function writeCapabilityForOperation(operation: SignalWriteOperation): WriteCapability {
  return operation.replace(/\.v1$/, "") as WriteCapability;
}

export function isWriteOperation(value: unknown): value is SignalWriteOperation {
  return typeof value === "string"
    && (SIGNAL_WRITE_OPERATIONS as readonly string[]).includes(value);
}

export function assertWriteOperationsClosed(operations: readonly string[]): void {
  if (operations.length === 0 || operations.length > SIGNAL_WRITE_OPERATIONS.length) {
    throw new Error("write_operations_out_of_range");
  }
  const allowed = new Set<string>(SIGNAL_WRITE_OPERATIONS);
  for (const operation of operations) {
    if (operation.includes("*") || !allowed.has(operation)) {
      throw new Error("write_operation_refused");
    }
  }
  if (new Set(operations).size !== operations.length) {
    throw new Error("write_operations_not_unique");
  }
}
