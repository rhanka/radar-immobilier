# Requests to cluster mesh (sentropic: `packages/cluster-mesh`, `packages/llm-gateway`)

From: radar-immobilier conductor, on behalf of radar and geo. Date: 2026-10-31.
Context (not repeated here): `consensus-v2.md`. In short: geo runs PV extraction as an s3-dag DAG of k8s Jobs and
needs cluster mesh as its LLM egress and identity control plane. No DAG, cron or byte transport is requested.

Baseline read on sentropic main `fb454cb4c` (cluster-mesh 0.25.0). "Exists" = seen in code; everything under
"Expected contract" is a proposal for the maintainers to accept, amend or refuse.

Priority: **P1** blocks parallel extraction in geo; **P2** needed before radar retires its refresh; **P3** hardening.

---

## F-CM1 — Gateway pool state for a k8s batch profile (P1)

**Why.** Radar extraction runs as a singleton because LLM seats live in an encrypted keyring on an RWO PVC guarded by
`flock`; two pods attaching it caused a 4 h 30 Pending incident (2026-10-09). Geo needs N parallel `extract` Jobs.
**Exists.** `llm-gateway/src/ports/pool.ts`: pool interfaces, "INTERFACES + minimal stubs only — no DB, no KMS wiring";
account selection via `AccountTransportCoordinator.acquire()`. h2a `gateway-host` already wires `CodexRuntimeClient` and
`CloudCodeRuntimeClient` (laptop daemon).
**Expected contract.**
- A deployable gateway profile (container + config) where pool state (accounts, leases, reservations, cooldown, audit)
  lives in a control-plane store, and secrets in an envelope-encrypted store; replicas share that state.
- Callers are k8s Jobs authenticated per F-CM3; they never hold provider credentials.
- Lease semantics as already specified in `pool.ts` (short transaction, `SKIP LOCKED`, no lock during streams, no
  silent rebind); a lease survives a caller crash only until its deadline.
- Runtimes covered: Codex and Cloud Code (current radar policy), Gemini (fallback/verification).
**Acceptance.** 4 concurrent callers on one pool in preprod, no shared volume, no credential in pod spec; killing a
caller frees its lease at deadline. **Blocked by owner decision** on pooling personal seats (consensus Q1).

## F-CM2 — Budget admission and shared 429 cooldown across replicas (P1)

**Why.** Radar's model policy skips a primary model known to be rate-limited using in-memory state in one pod. With N
workers, the cooldown and the budget must be common, or every worker hits the 429 again.
**Exists.** `llm-gateway/src/ports/budget.ts`: opt-in `BudgetAdmissionPort` (`admit` -> `admitted|over-budget|unavailable`,
settlement through `RouteMeteringSink.settleRoute`); host owns pricing and ledger.
**Expected contract.**
- A reference `BudgetAdmissionPort` adapter backed by the F-CM1 store, keyed by caller (tenant `geo`, workspace
  `geo-pv`, lane) with a configurable ceiling per period.
- A shared per-(provider, model, account) cooldown written on provider 429 and read before dispatch; `over-budget`
  and `cooldown` returned as distinct typed refusals with `resetAtMs`.
**Acceptance.** Two replicas: a 429 seen by one is honoured by the other on the next call; ceiling reached -> typed
refusal, no dispatch.

## F-CM3 — Workload identity for k8s lane service accounts (P1)

**Why.** s3-dag requires a dedicated identity per lane (`packages/s3-dag/src/identity.ts` in geo, map
`deploy/k8s/s3dag-c1-identity-workspace-map.json`: tenant `geo`, workspace `geo-pv`). The gateway must bind each call
to a lane and its budget without long-lived secrets in pods.
**Exists.** `cluster-mesh/src/token-exchange.ts` (RFC 8693 client, issuer interface, typed refusals, cache);
`cluster-mesh/src/nhi.ts` (`NhiLifecyclePort`, implemented through the h2a CLI runner).
**Expected contract.**
- Token exchange accepts a k8s projected service-account token as subject and returns a short-lived gateway token
  whose claims carry tenant, workspace and lane resolved from validated membership, never copied from the request.
- NHI attest and offboard callable from inside the cluster (no dependency on a local h2a CLI), with an audit record
  per issuance and revocation.
**Acceptance.** A Job with service account `s3dag-pv-extract` (name illustrative) obtains a token, calls the gateway,
and is refused within one token lifetime after offboarding.

## F-CM4 — Durable usage-receipt ledger with export (P2)

**Why.** The geo -> radar contract carries `model_receipts` per document (provider, model, effort, fallback and
verification status, attempts, latency); radar writes them to `refresh_document_outcomes`; monthly cost reports need
tokens and cost per caller. No queryable ledger was found.
**Exists.** `RouteMeteringSink.settleRoute(RouteRequestSettlement)` (`llm-gateway/src/route-flow-core.ts`).
**Expected contract.**
- A persistent `RouteMeteringSink` implementation; each settlement keyed by gateway request id (idempotent).
- Caller-supplied correlation fields passed through untouched: `run_id`, `node`, `doc_sha`.
- Export by caller and period (JSON lines or paginated API): tokens in/out, cost, model, effort, attempts, latency.
**Acceptance.** Re-settling the same request id does not double-count; an export for workspace `geo-pv` over one day
reconciles with the DAG receipts by `run_id`.

## F-CM5 — MCP supervision namespace over the s3-dag read-model (P2)

**Why.** Agents and immo-mcp need PV freshness and run status without k8s rights. s3-dag already serves
`/v1/refresh/{overview,runs,freshness}` (`packages/s3-dag/src/http.ts` in geo).
**Exists.** `./mcp/registry`, `./compose/mcp` exports in cluster-mesh.
**Expected contract.** A composable read-only MCP module taking an HTTP base URL and a caller token, exposing three tools
mapped 1:1 to those routes, tenant-scoped by F-CM3 claims; no write tool.
**Acceptance.** immo-mcp lists freshness per city for `geo-pv` with a read-only token granted on workspace `geo-pv`; a token of
another tenant is refused.

## F-CM6 — Run-provenance attestation and remote signed projections (P3)

**Why.** Radar should verify which producer, `run_id` and policy produced a contract snapshot, without relying only on
bucket permissions.
**Expected contract.** Sign `{snapshot_sha256, run_id, profile_digest, policy}` at promotion; verification API usable by
radar offline from the signature and a published key set. Status of the corresponding seams in 0.25.0: `unverified`.
**Acceptance.** Tampered snapshot or unknown signer -> verification fails closed.

## F-CM7 — Restart-durable messaging (P3)

**Why.** Wake `radar-pv-consume` on "contract promoted" instead of polling. M01 messaging is process-local
(`design/M01-messaging.md`: restart discards messages). Polling the CAS pointer is the accepted fallback.
**Expected contract.** At-least-once delivery that survives store restart, consumer cursor persisted, topic per tenant.

## F-CM8 — Cross-server discovery and member revocation (P3)

**Why.** Only needed if a second cluster or the conductor workstation must join the same mesh.
**Expected contract.** Discover, admit and revoke members across servers; revocation propagates to F-CM3 tokens.

---

**Out of scope (do not build for us):** DAG scheduling, cron, PV byte transport, OCR.
**Reply expected:** accept / amend / refuse per ID, target version, and whether F-CM1 and F-CM2 land in
`llm-gateway` or in a `cluster-mesh` compose module.
