/**
 * PW-B signal write operations: closed input shapes for the six page
 * operations, pure validation, digests, and admission-window checks.
 * No I/O, no routes. Business transitions stay in scoped-writer.ts and
 * workspace-writer.ts; this module only describes what the coordinator
 * may dispatch.
 */
import { digest, FacetError } from "./target.js";
import type { SignalTarget } from "./target.js";
import type { Basket } from "./writer.js";

export const PERSONAL_WRITE_OPERATIONS = [
  "facets.signals.personal.select.v1",
  "facets.signals.personal.deselect.v1",
  "facets.signals.personal.discard.v1",
  "facets.signals.personal.restore.v1",
] as const;

export const WORKSPACE_WRITE_OPERATIONS = [
  "facets.signals.workspace.discard.v1",
  "facets.signals.workspace.restore.v1",
] as const;

export type SignalWriteOperation =
  | (typeof PERSONAL_WRITE_OPERATIONS)[number]
  | (typeof WORKSPACE_WRITE_OPERATIONS)[number];

const OPERATIONS: readonly string[] = [
  ...PERSONAL_WRITE_OPERATIONS,
  ...WORKSPACE_WRITE_OPERATIONS,
];

export function isPersonalOperation(operation: SignalWriteOperation): boolean {
  return (PERSONAL_WRITE_OPERATIONS as readonly string[]).includes(operation);
}

export interface SignalWriteInput {
  operation: SignalWriteOperation;
  workspaceId: string;
  target: SignalTarget;
  basket?: Basket | undefined;
  reasonCode?: string | undefined;
  deselect?: Basket[] | undefined;
  expectedHeadId: string | null;
  expectedSelectionHeads?: Partial<Record<Basket, string | null>> | undefined;
  displayedFingerprint: string;
  expectedProjectionToken: string;
  commandKey: string;
  expiresAtMs: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;
const CITY_PATTERN = /^[a-z0-9-]+$/;
const REASON_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;
const BASKETS: readonly string[] = ["pertinent", "a_surveiller"];

function fail(): never {
  throw new FacetError(400, "invalid_facet_command");
}

function assertUuid(value: unknown): asserts value is string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) fail();
}

function assertHex64(value: unknown): asserts value is string {
  if (typeof value !== "string" || !HEX64_PATTERN.test(value)) fail();
}

function assertTarget(target: unknown): asserts target is SignalTarget {
  if (target === null || typeof target !== "object" || Array.isArray(target)) fail();
  const row = target as Record<string, unknown>;
  if (typeof row.citySlug !== "string" || row.citySlug.length < 1
    || row.citySlug.length > 128 || !CITY_PATTERN.test(row.citySlug)) fail();
  if (row.type !== "Signal" && row.type !== "DesignationEvent") fail();
  if (typeof row.id !== "string" || row.id.length < 1 || row.id.length > 512) fail();
  if (Object.keys(row).length !== 3) fail();
}

/** Closed runtime shape check; reason-code semantics stay with the writers. */
const ALLOWED_KEYS: readonly string[] = ["operation", "workspaceId", "target",
  "basket", "reasonCode", "deselect", "expectedHeadId", "expectedSelectionHeads",
  "displayedFingerprint", "expectedProjectionToken", "commandKey", "expiresAtMs"];

export function assertSignalWriteInput(input: unknown): asserts input is SignalWriteInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) fail();
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (!ALLOWED_KEYS.includes(key)) fail();
  }
  if (typeof row.operation !== "string" || !OPERATIONS.includes(row.operation)) fail();
  const operation = row.operation as SignalWriteOperation;
  assertUuid(row.workspaceId);
  assertTarget(row.target);
  if (row.basket !== undefined) {
    if (typeof row.basket !== "string" || !BASKETS.includes(row.basket)) fail();
  }
  if (row.reasonCode !== undefined) {
    if (typeof row.reasonCode !== "string" || row.reasonCode.length > 128
      || !REASON_PATTERN.test(row.reasonCode)) fail();
  }
  if (row.deselect !== undefined) {
    if (!Array.isArray(row.deselect) || row.deselect.length > 2
      || new Set(row.deselect).size !== row.deselect.length) fail();
    for (const entry of row.deselect) {
      if (typeof entry !== "string" || !BASKETS.includes(entry)) fail();
    }
  }
  if (row.expectedHeadId !== null) assertUuid(row.expectedHeadId);
  if (row.expectedSelectionHeads !== undefined) {
    if (row.expectedSelectionHeads === null || typeof row.expectedSelectionHeads !== "object"
      || Array.isArray(row.expectedSelectionHeads)) fail();
    for (const [key, value] of Object.entries(row.expectedSelectionHeads)) {
      if (!BASKETS.includes(key)) fail();
      if (value !== null) assertUuid(value);
    }
  }
  assertHex64(row.displayedFingerprint);
  assertHex64(row.expectedProjectionToken);
  assertUuid(row.commandKey);
  if (typeof row.expiresAtMs !== "number" || !Number.isSafeInteger(row.expiresAtMs)
    || row.expiresAtMs < 0) fail();
  const personal = isPersonalOperation(operation);
  if (operation.endsWith(".select.v1") || operation.endsWith(".deselect.v1")) {
    if (row.basket === undefined || (operation.endsWith(".deselect.v1") && row.reasonCode !== undefined)
      || row.deselect !== undefined || row.expectedSelectionHeads !== undefined) fail();
    if (!personal) fail();
  }
  if (operation.endsWith(".discard.v1")) {
    if (row.basket !== undefined) fail();
    if (typeof row.reasonCode !== "string") throw new FacetError(422, "reason_code_required");
    if (personal) {
      const removals = (row.deselect ?? []) as string[];
      const heads = Object.keys(row.expectedSelectionHeads ?? {}).sort();
      if (removals.length === 0 ? row.expectedSelectionHeads !== undefined
        : heads.length !== removals.length || heads.some((key, i) => key !== [...removals].sort()[i])) fail();
    }
  }
  if (operation.endsWith("restore.v1")) {
    if (row.basket !== undefined || row.reasonCode !== undefined
      || row.deselect !== undefined || row.expectedSelectionHeads !== undefined) fail();
  }
  if (!personal && (row.basket !== undefined || row.deselect !== undefined
    || row.expectedSelectionHeads !== undefined)) fail();
}

/** Content digest of the admitted order; the idempotency key stays identity. */
export function signalWriteOperationDigest(input: SignalWriteInput): string {
  assertSignalWriteInput(input);
  const body: Record<string, unknown> = {
    expectedHeadId: input.expectedHeadId, displayedFingerprint: input.displayedFingerprint,
  };
  for (const key of ["basket", "reasonCode", "deselect", "expectedSelectionHeads"] as const) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  if (input.deselect !== undefined) body.deselect = [...input.deselect].sort();
  return digest({
    version: "pw-signal-write-v1",
    operation: input.operation,
    workspace: input.workspaceId.toLowerCase(),
    target: input.target,
    body,
    expectedProjectionToken: input.expectedProjectionToken,
  });
}

/** Pre- and post-wait expiry control; expiry never extends the intent. */
export function assertAdmissionWindow(nowMs: number, expiresAtMs: number): void {
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(expiresAtMs)) fail();
  if (nowMs >= expiresAtMs) throw new FacetError(409, "challenge_expired");
}
