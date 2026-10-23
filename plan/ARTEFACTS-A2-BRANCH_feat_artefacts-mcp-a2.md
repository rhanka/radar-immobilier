# Lane A2 — H4 P4 exchange (request-bound RFC 8693, SDK transport retained)

## Objective

- Implement P4: request-bound RFC 8693 exchange for `search_signals` only.
- Retain the existing SDK MCP transport, twelve tools, sessions and discovery.
- Remove original-bearer forwarding; keep input credentials in the private exchange boundary.
- Write source and tests; Sol A2 verifies, commits and applies runner deltas.

## Branch / environment

- Branch: `feat/artefacts-mcp-a2`, from recorded BASE plan commit `1d4adc1014ec24e02f7e1966edadae56291a9cb1`.
- Lane plan: `plan/ARTEFACTS-A2-BRANCH_feat_artefacts-mcp-a2.md`.
- Environment: `test-artefacts-mcp-a2`, ports API `18942` UI `15942` Maildev `11942`.
- Port availability: `unverified`. No published service ports.

## Scope

Allowed: `packages/immo-mcp/src/{auth-context,invocation-context,data-source,server-http}.ts`,
directly affected handler wiring and tests, new `exchange-client`,
`exchange-token`, `exchange-cache`, `authorized-egress` modules and tests,
`oauth-discovery`, `http-discovery-routes`, `http-401-golden`,
`http-session-egress`, `request-isolation`, `server-http-session` tests,
`exchange.e2e.test.ts`, narrowly scoped isolated issuer fixtures and runner
files under `tools/`. P4 target hunks for `tools/h4-mcp.mk` proposed under
`shared/` only; that file is owned by Sol A2 until accepted A2 HEAD is merged.

Forbidden: manifests, lockfiles, API auth and config, deployments, master
plan, business DB work, product UI, root checkout changes, upstream edits,
push, deploy, `.track` writes, `.env` reads. No new OAuth consent scopes. No
test uses live user credentials. No API receiver replacement, no artifact
activation, no cluster-mesh composition.

## Orchestration Mode (CT-1 through CT-9, verbatim from the master plan)

- [ ] CT-1 — BASE/ARTEFACTS shared-write rule: one conductor-recorded lease holder at a time edits `api/src/app.ts`, `api/src/index.ts` and `api/drizzle/**` across both tracks; include `auth.ts` if both tracks touch it. Neither lane's integrator has an independent concurrent write right.
- [ ] CT-2 — Each lease records holder, receiving branch/HEAD, both input SHAs, exact hunks, migration reservations, tests and resulting commit. The next holder acknowledges that receipt. Nonshared work continues; joining the histories uses merge commits, never whole-file ours/theirs or copied commits.
- [ ] CT-3 — Preserve both sets of mounts/startup dependencies and middleware order: content-host isolation first, control cookie guard, then authenticated business routes; keep H4 and H5 identities distinct. Requalify the named signals API adapter if BASE retires its route; do not reopen a retired route.
- [ ] CT-4 — Reserve `0022_facet_lot_cutover.sql` and `0023_facet_lot_versions_fence.sql` for BASE's pinned 6K import. Allocate artifact technical files from the next globally unreserved number, at least 0024; reservation alone is not migration-order proof. Preserve inherited SQL bytes and hashes.
- [ ] CT-5 — Use the existing common Drizzle journal/migrator. The lease holder assigns each unreleased suffix entry a unique tag and sequential idx, with when greater than the maximum existing journal/applied timestamp. Preserve the applied prefix; never renumber, retime or replace an applied/released entry or edit database migration history.
- [ ] CT-6 — BASE-first is permitted: append artifact entries after the fixed BASE prefix. ARTEFACTS-first is permitted without importing or applying 6K: release its technical suffix on the current baseline, then register still-unreleased BASE entries after that suffix, retaining 0022/0023 SQL bytes and their relative order. Their original lower timestamps must not be inserted behind an already-applied artifact suffix.
- [ ] CT-7 — Freeze one journal order before first persistent use across the target release chain. Reindex/retime only unpublished, unapplied suffix metadata, with provenance; a branch commit or disposable test DB is not a deployment release; BASE owns qualifying its migration assertions by relative prerequisite order rather than obsolete adjacency. If 6K metadata is already immutable, retain its prefix and refuse an incompatible combined upgrade; do not invent a history repair. Applied/deployed state is unverified until an operator receipt.
- [ ] CT-8 — Qualify a standalone delivery on fresh DB, its baseline upgrade and rerun using only its own migrations. Before a combined delivery, also qualify baseline-to-first-track-to-combined with its frozen journal: every expected SQL hash occurs once, none is skipped, technical/business data survive. Alternative orders need their own pre-release qualification. Serialize migration jobs per target DB; never wait for the other track to qualify a standalone delivery.
- [ ] CT-9 — After joining histories, test the exact combined SHA/image: both mount sets, auth/session and 6L2 regressions, BASE with artifacts off, artifacts without optional business capabilities, two-reader API proof and migration history. A shared-image update must retain already-delivered capabilities; no stale branch image may overwrite them. Schema coordination never requires 6K business activation or makes MCP/H5 a BASE prerequisite.
- [ ] H4 file ownership: Sol A2 alone applies/commits P4 deltas in `tools/h4-mcp.mk` under an exclusive lease; Muse A2 proposes hunks only. After accepted A2 HEAD is merged and acknowledged, ownership returns to the ARTEFACTS Sol integrator for A4/P6 and A5/P7; no overlapping edits.

## Design

- Exchange only for `search_signals`. Six public-data tools send no bearer.
- Five `not_wired_yet` stubs perform no exchange. Missing `immo:search`
- scope causes zero exchange.
- Human `sub` retained. Exact environment API audience, configured workload
- `act.sub` and `client_id`, `immo:search` scope and valid token types required.
- Issued lifetime positive, at most 300 seconds and at most subject lifetime.
- Cache deadline at most `min(issued.exp, subject.exp, insertedAt + 60s)`
- with an early-use margin. Authenticate each request before cache lookup.
- Cache key separates issuer, token identity, human, client, workload,
- environment, membership, target, effective scopes, confirmation context and
- policy revision. Capacity bounded; concurrent exchange single-flight with a
- bound; invalidation on supported signals, credential or policy change and
- downstream rejection. Cold issuer outage fails; warm entry lasts only until
- its deadline. No retry with broader authority, stale credentials or a
- service user. No redirect, oversized response, refresh token or proof-bound
- input accepted.
- Discovery historical and canonical preserved; local shim removal waits for
- the qualified library. Missing coarse-scope 401 to 403 recorded as intended
- delta; invalid authentication stays 401. Strict receiver and cluster-mesh
- composition stay out of scope.
- Live issuer, configuration and deployed receipts stay `unverified` until
- supplied. Isolated issuer proof does not replace them.

## Commit slices for Sol (each at most 150 lines with tests and plan updates)

- [ ] `chore(mcp): align qualified auth dependencies` (shared delta only)
- [ ] `feat(mcp): bind the RFC 8693 exchange client`
- [ ] `feat(mcp): validate delegated token authority`
- [ ] `feat(mcp): bound delegated token caching`
- [ ] `feat(mcp): isolate exchanged authority per request`
- [ ] `fix(mcp): remove original bearer forwarding`
- [ ] `test(mcp): cover exchange refusal and cache isolation`
- [ ] `fix(mcp): preserve discovery on the auth upgrade`
- [ ] `test(mcp): qualify exchange with the real issuer`
- [ ] `docs(mcp): record exchange and workload receipts`

## Acceptance

- Returned-token actor, audience, subject, scope, type and lifetime refusals.
- Redirect, oversized-response, refresh-token and proof-binding refusals.
- Cache isolation, capacity, expiry and invalidation.
- Same-session concurrent users and reduced scopes without authority bleed.
- Missing scope causes zero exchange. Public and stub behavior unchanged.
- Session ownership and immutable per-request authority preserved.
- Signed-token exchange through the supplied isolated issuer build, MCP and API.
- Published tuple and deployed exchange receipts remain explicit prerequisites.

## Open waits (`unverified`)

- Qualified `mcp-auth` publication, provenance and compatibility.
- Isolated and deployed RFC 8693 issuer, identity configuration and workload references.
- Receiving-environment and operator evidence, publication GO and CI.

- [x] Added exchange configuration and bounded response reader.

- [x] Added single-request exchange client and response-boundary assertions.
