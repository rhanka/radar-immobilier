# PW-B signal admission contract

PW-B implements the BASE part of conception v7 sections 7.4–7.7. It does not
mount a route, open H5, or implement PW-D persistence. Six signal operations
dispatch to the existing personal and workspace BASE transition logic.

## Transaction ownership

`coordinateSignalWrite(db, sub, preparedInput, admission, clock?)` opens one
READ COMMITTED transaction. `executeSignalWriteInTx(tx, ...)` joins an existing
transaction with that isolation; it refuses REPEATABLE READ and SERIALIZABLE.
No cast from a transaction to a database and no nested transaction are used.
Public BASE wrappers retain their DTOs, receipts, historical recovery and errors.

Every input is copied before asynchronous admission. Its operation, workspace,
target, body, heads, displayed fingerprint and original 6L1 token are immutable.
The versioned canonical operation digest uses BASE canonical JSON (UTF-8,
recursive key sorting); the validated semantic values are strings, nulls,
objects and arrays. Optional absence is preserved, deselections are unique
and sorted. The key and transport expiry are excluded from this operation
digest; PW-D's immutable intent digest also binds them and the H5 principal/context.
Duplicate JSON members must be rejected by PW-A/C before calling this object API.

## Required PW-D port

`SignalWriteAdmission` has four mandatory transaction-bound hooks. No production
implementation or permissive default is supplied; a missing hook closes admission.

1. `lockAuthority(tx, preparedInput)`: acquire tier/policy/release/delegation,
   reader/P/grant and intent/challenge fences in normative order. Re-read the
   immutable prepared record, principal and authority references. No network I/O.
2. `reserve(tx, {actorId,commandKey,operationDigest})`: under the BASE actor/key
   lock, verify the durable reservation belongs to this exact intention and
   digest, including H5 context and the original expiry. Different bindings
   refuse `idempotency_key_conflict`. A consumed terminal challenge refuses
   `challenge_consumed` before any comparison with its old 6L1 token.
3. `consume(tx)`: recheck deadlines, reserve transactional quota and conditionally
   consume the pending challenge. All changes must roll back if BASE refuses.
4. `recordCommit(tx, result)`: link the immutable BASE receipt, mark the intention
   committed and append mandatory audit/outbox. Throw on any failure.

The hooks must never open another transaction or independently commit. They own
intent/challenge storage, durable key reservations, terminal state, H5 revocation,
quota and audit. No PW-D table or migration is created by PW-B. The synthetic test
port uses disposable audit rows and is imported only by tests; it is not a backend.

## Lock, snapshot and deadline guarantees

After H5 fences, order is workspace → approved actor row FOR SHARE → actor/key →
city/source → BASE streams. Authority is re-read after waits. All existing BASE
writers and membership changes use the workspace fence; graph writers use the
city fence. The first 6L1 read occurs only after the city fence is held, under
READ COMMITTED. BASE stream locks and exact head/fingerprint/reason checks then
remain the responsibility of the shared executors. The complete composite
discard, receipt and revisions commit with the hooks, or all roll back.

Lock timeout is 1 second; statement timeout is 5 seconds. Current wall time is
sampled after source waits and after every write, scope read and audit hook.
Equality with expiry is expired. Admission lasting at least 5 seconds rolls back.
This bounds admission, not the arrival of a network acknowledgement after COMMIT.

A pending intention encountering any existing BASE receipt or command context
refuses `command_context_unresolved`; it never adopts an unrelated receipt.
The POST is not an idempotent success/recovery endpoint. PW-D must serialize
concurrent confirmations and return `challenge_consumed` for the terminal replay.

## Receipt consultation and unknown outcomes

`readCommittedSignalReceipt` returns the original strict PW signal event projection
after current approval/membership/epoch/history checks in one transaction. It does
not compare an old 6L1 token or call a writer. Owner/actor, source payload and BASE
command context are excluded. A missing receipt is distinct from a null no-op.
PW-D must first authorize the intention, page/application principal, revocation
state and its exact committed receipt link; this helper alone is not a status API.

PW-C/D must revalidate disclosure authority after commit and construct their
public envelope. `toWriteRefusal` normalizes known BASE refusals and masks unknown
details. It does not assert an attempt outcome: lost commit acknowledgement or
transport failure remains unknown, preserves intention/key, and requires status
consultation. It must never cause a new command or imply rollback after commit.
