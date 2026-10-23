# ARTEFACTS-A1 — H3 and r2 provider binding

Lane of `feat/artefacts-mcp`. BASE plan commit (Git prerequisite, not the
BASE business track): `1d4adc1014ec24e02f7e1966edadae56291a9cb1`,
descending from `9a81508704b8ee247e3d402f9cbf15d458edfe2a`.

- Branch: `feat/artefacts-mcp-a1`.
- Environment: `test-artefacts-mcp-a1`.
- Ports: `API_PORT=18941`, `UI_PORT=15941`, `MAILDEV_UI_PORT=11941`.
  Availability `unverified`. No published PostgreSQL/S3 ports.
- Owner: Muse writes source and tests; Sol runs verification and commits.
- No Python anywhere. Never read `.env` or credentials; synthetic data only.
- Common Muse/Sol instructions and CT-1 through CT-9 apply. CT-1 through
  CT-9 stay authoritative in the master plan; the verbatim copy for BASE
  travels through `shared/base-ct1-ct9.md` for the single integration
  writer. No concurrent shared-file writer; no manual lockfile merge.

## Allowed paths

- `packages/artifacts-host/src/**` (composition, facade, storage,
  idempotency, admission, index, mcp-app-adapter, plus narrowly scoped
  profile, transaction-authority, provider-quota-binding and
  persistent-ledger modules with matching tests).
- `api/src/artifacts/control-route-startup.ts` and its tests.
- Pinned PR908 acceptance, finalization-authorization and provider-failure
  suites and their helpers, adapted without weakened assertions.
- Existing `api/tests/integration/artifacts-*` suites, extended as needed.
- This lane plan; ignored evidence under the lane worktree.

## Forbidden paths

- Manifests, lockfiles, SQL/journal numbering, `api/src/app.ts`,
  `api/src/index.ts`, common runners, the master plan. Exact dependency,
  migration, runner and startup deltas travel under `shared/` for the
  single integration writer only.

## Work slices (each subject <= 150 lines with tests and plan updates)

- [ ] contracts/profile slice first (A6 seam, no candidate needed)
- [ ] transactional commit authorization participant
- [ ] authorization after commit waits (tests)
- [ ] durable provider reservations (ensure-only, failed-publish accounting)
- [ ] last-reservation concurrency proof (tests)
- [ ] typed publication outcomes + persistent ledger with invocation
- [ ] atomic replacement of post-response authorization and failure-probe
- [ ] production admission and ledger wiring in startup
- [ ] PR908 helper binding to the real provider (tests)
- [ ] replay across processes and restart (tests)
- [ ] failure projection and cleanup (tests)
- [ ] provider qualification record

## Acceptance (expected, Sol-observed)

- Revocation during lock, connection and S3 waits prevents durable success.
- Ensure and publish cannot bypass finalization authorization.
- Reauthorization cannot replay success from a refused attempt.
- Last-reservation race: exactly one winner; replay consumes no extra.
- Typed timeout/connection loss maps to 503/provider_unavailable; genuine
  conflict maps to 409/provider_conflict; HTTP/MCP projections agree.
- Restart retains authorized state and cannot promote refused work.
- Preparation objects stay attributed and are cleaned within the provider
  bound; referenced/shared objects survive.
- Real-provider qualification executes; skipped or missing-contract cases
  never count as PASS. Missing candidate blocks dependent qualification.

## Shared deltas (integration writer applies)

- `shared/0024_artifacts_commit_outcomes.sql` (candidate number, CT-4).
- `shared/drizzle-journal-proposal.json` (tag/idx/when assigned by writer).
- `shared/provider-tuple-proposal.md` (no manifest edit here).
- `shared/base-ct1-ct9.md` (verbatim CT copy for BASE).

## Handoff

Uncommitted `RAPPORT-MUSE-ARTEFACTS-A1.md`: files, proposed partitions and
line counts, expected tests, shared deltas, exact missing interfaces and
unverified evidence. ETA unchanged: 14-23 agent hours, complete A1 circuit.

## Integration evidence (Sol)

- [x] Import PR908 committed bytes through merge
  `39e38e2156ee142ff0e9570c5a15744cf58764c2`, second parent
  `81e8e729feb6aa8f8255b754320f8a9581ddd1c3`; no copied commits.
- [x] Correct the proposed CT-8 copy to match all nine master checkboxes.
- [ ] Conductor lease, applied-prefix receipt and frozen migration order:
  absent; `shared/0024_*` remains a proposal, not registered SQL.
- [ ] Candidate archive, actual r2 construction API and published tuple:
  absent; dependent qualification remains open.
- [x] Retain the provider-neutral immutable profile and authority types for A6.
- [ ] Candidate-dependent Muse code is preserved in ignored evidence/pending
  files; it is not accepted or wired into production by this preparation slice.
- [x] Two owner-requested independent Astra reviews of `c04d09a0`: preserve
  findings and correct non-string selection coercion and shared race keys.
- [ ] Race variants still require joint execution on the actual candidate;
  structural tests and typechecking cannot qualify that concurrency behavior.

## Fix1 review corrections

- [x] Implement bounded race draining and process exit, including SIGKILL escalation.
- [x] Add SQL/S3 regression fixtures for failed winners, stuck workers and purge effects.
- [x] Release and collect both race branches; assert shared retention and exclusive deletion.
- [x] Guard client end events, bound SQL cleanup and retain typed connection causes.
- [x] Use a nonempty S3 prefix in acceptance teardown; keep r2 qualification open.
- [x] Preserve bounded shutdown while reporting exit failure outside a finally block.
