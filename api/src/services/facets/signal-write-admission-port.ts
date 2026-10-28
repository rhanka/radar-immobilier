import type { WriteTx } from "./signal-write-scope.js";
import type { SignalWriteInput } from "./signal-write-operations.js";
import type { SignalWriteResult } from "./signal-write-admission.js";

export interface SignalWriteReservation {
  actorId: string;
  commandKey: string;
  operationDigest: string;
}

/**
 * PW-D implements every hook using the supplied transaction, with no network
 * call or independent commit. Missing storage/authority must fail closed.
 * The immutable prepared record is the only source of `input`.
 */
export interface SignalWriteAdmission {
  /** Acquire H5 fences and intent lock BEFORE any BASE lock; verify principal. */
  lockAuthority(tx: WriteTx, input: Readonly<SignalWriteInput>): Promise<void>;
  /** Verify the immutable actor/key/digest reservation and current authority.
   * A terminal consumed challenge throws challenge_consumed before old 6L1.
   * A changed intent/body/context throws idempotency_key_conflict.
   */
  reserve(tx: WriteTx, reservation: SignalWriteReservation): Promise<void>;
  /** Reserve quota and conditionally consume the still-pending challenge. */
  consume(tx: WriteTx): Promise<void>;
  /** Persist committed intent, receipt link, and mandatory audit/outbox. */
  recordCommit(tx: WriteTx, result: SignalWriteResult): Promise<void>;
}
