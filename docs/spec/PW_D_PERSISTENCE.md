# PW-D persistence contract

This backend adds no HTTP route or H5 operation. It joins PW-B's READ COMMITTED
transaction through `createDurableWriteAdmission`; no hook commits independently.
`confirmPwSignalWrite` additionally counts attempts in a separate shared limiter
before invoking PW-B. Rejected replays consume attempt quota, never admission quota.

PW-A/C must verify the normal application cookie, exact identity domain, Origin,
CSRF and the challenge MAC before supplying `PwConfirmation`. Its claims bind
the random 256-bit challenge identifier, immutable intent digest, fixed key ID
and expiry. This module verifies those claims and the complete principal again
inside admission. It does not create a MAC, authenticate a browser, issue grants,
or substitute for the authority's existence/permission checks. Missing confirmation
or any of the seven authority references closes admission.

`PwConfirmation.sessionExpiresAtMs` carries the authenticated application's cookie
deadline separately from the immutable challenge expiry. PW-D checks it after
authority waits and before consumption. `confirmPwSignalWrite` supplies BASE's
admission clock with a session guard, including its final synchronous sample
after all awaited hooks and audit/outbox SQL. Expiry rolls back
BASE, consumption, admission accounting and outbox together.

Preparation stores the entire validated PW-B input. The original projection token,
expiry, command, principal, artifact context, grant and authority references cannot
be replaced. The intent digest is recomputed from persisted bytes at confirmation.
Retries with the same actor/key and semantic request return the original intent;
different context refuses. A renewed transport grant does not extend an intent.
After payload purge, the reservation remains and never creates a second intent.

Authority checks acquire shared transaction advisory locks in tier, policy, release,
delegation, reader, grant and page-session order before locking the intention.
Revocation takes the matching exclusive lock and records an immutable tombstone
before acknowledgement. All authority producers/revokers must use these same
references and locks; the future H5 adapter remains responsible for that wiring.
An unlocked initial read supplies immutable references; the locked record and
confirmation are rechecked after waits. Intent revocation locks the same row as
confirmation, checks owner and full principal, and preserves committed execution.

Preparation/pending caps and rate accounting are shared PostgreSQL operations.
Quota reservations serialize on their bucket; admission accounting, consumption,
BASE receipt/link, audit and outbox share one commit. Minute budgets and token
bursts are computed from the append-only ledger. Audit persists only technical
references. Export failures retry outbox delivery; they never invoke BASE.

`readPwWriteStatus` requires the authenticated original page-session reference.
A persistent I/P budget fixes the first read timestamp, counts at most 60 reads
within 120 seconds, spaces them by at least 2 seconds, then requires 30 seconds
between manual reads. It never reopens the initial window. This budget and the
global reader/workspace status limiter share one transaction; a refusal debits
neither. Connections, reloads and tabs share the same row and lock.

Terminal BASE conflicts persist a public status/code independently of outbox
delivery. Later confirmation and status return the same refusal, including after
a lost response. Rejection state, refusal, audit and outbox are atomic. Known
refusals, including attempt exhaustion, retain the caller's requestId and record
`denied`; consumed replays record `replay_denied`, uncertain results `unknown`.
Preparation compares normalized binding/command keys before any reservation or
prepare debit. Foreign revocation ownership is indistinguishable from absence.

Migration `0027_pw_write_persistence` follows the published actor quota
`0025_artifacts_actor_quotas` and reader ticket `0026_artifacts_reader_tickets`
migrations. Its SQL bytes are unchanged from the approved PW-A candidate.
All earlier SQL bytes, timestamps and journal ordering remain frozen.
Qualification exercises fresh installation, coordinator 0024 through quotas
and tickets, the PW-D upgrade, migrator rerun and direct SQL replay.
No activation or combined-image CT-9 claim is made.
