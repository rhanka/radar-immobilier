# SPEC — Artifact Build SLO (immo consumer of the Sentropic artifact builder)

> **Status**: draft for owner review — immo-side consumer specification.
> The Sentropic artifact builder is the provider; this repository
> (`radar-immobilier`, "immo") is the consumer and host.
> **Date**: 2026-11-11
> **Owner requirement (verbatim)**: « un artefact doit se construire en
> moins d'1 min » + « ça doit être une spec »
> **Card**: #1066 (immo base `main` or prod tag)
> **Environments**: preprod first, then prod (same SLOs, measured separately)

Tags used below: `[FACT]` = measured or proven on 2026-11-10/11 with the
source named inline; `[TARGET]` = normative requirement of this spec;
`[OPEN]` = unresolved question in §8. `source-gap` = no source available
on the immo side.

---

## 1. Requirement and scope

### 1.1 Requirement

`[TARGET]` A new artifact, from creation to a published URL, must build
in **under 1 minute** on an already-known lockfile (§3). This is a
**hard per-run maximum**, not a percentile allowance: no single
end-to-end run (S6) and no single static publish (S5) may reach 60 s.
The p95 targets in §3.1 are tighter operational targets on top of that
hard maximum; they never authorise a run at or above 60 s. Every phase
of the flow carries its own measurable SLO (§3), and **no failure may
be silent**: every failure surfaces a typed error code and a structured
log line (§3.4).

This spec is the consumer contract. It does not re-specify the builder
internals; it states what immo requires from the builder (Sentropic
owner, §5), what immo itself provides (§6), and how compliance is
proven (§7).

### 1.2 In scope — two artifact kinds

**Live artifacts** (interactive, MCP connector / claude.ai flow):

```
attach → live start → live_write → git_commit → stop → git_publish
```

- `attach`: bind the artifact to the immo git repository (branch
  `artifact/p/<id8-principal>/app-<id8-artifact>` or an explicit
  personal branch), base `main` or a prod tag (card #1066).
- `live start`: open a live session on the builder; the draft reaches
  phase `LIVE` with a routable preview.
- `live_write`: edit files in the live draft; the change becomes
  visible in the preview.
- `git_commit`: commit the live draft content on the bound branch.
- `stop`: close the live session and release the builder pod.
- `git_publish`: build the committed state and publish it at a stable
  URL (delegates to the static build path below).

**Static artifacts** (batch publish):

```
git_publish → build_publish → published URL
```

- `build_publish`: the builder builds the bound branch/subPath at a
  pinned commit and publishes the resulting bundle. This is the only
  path for artifacts never opened live, and the final step of the live
  flow. This builder-side build is distinct from
  `artifacts_publish_bundle_v2` (`SPEC_ARTIFACT_UI_PUBLISH.md`), which
  publishes a caller-uploaded bundle of bytes and builds nothing; the
  two mechanisms must not share a name.

### 1.3 Environments and bases

- `[TARGET]` Rollout order: **preprod first, then prod**. SLOs are
  measured and reported per environment; a preprod pass does not imply
  a prod pass.
- `[TARGET]` Publish base: immo `main` or a prod tag (card #1066). The
  base is pinned at `attach` time (`baseHeadSha`); a publish never
  silently rebases onto a newer base.

### 1.4 Out of scope

- Builder internal implementation choices (runtime, image format),
  except where §5 makes an observable property normative (sealed cache
  per `lockSha256`, warm pool, per-phase metrics).
- Artifact content authoring (what users build inside an artifact).
- Non-artifact immo builds (API/UI images) and their CI pipelines.

---

## 2. Definitions — cold vs warm

Every SLO in §3 is stated against one of these cases. A measurement
that does not name its case is not comparable and does not count
toward acceptance (§7).

| Case | Definition |
| --- | --- |
| **Warm** | The artifact's `lockSha256` (hash of the resolved lockfile) already has a **sealed** dependency cache on the builder (§5.1) **and** a warm pod is available in the tenant pool (§5.2). This is the steady state for every artifact after the first on a given lockfile. |
| **Cold-known** | The `lockSha256` has a sealed cache, but **no warm pod** is available (pod must be started and the sealed cache mounted/extracted). No network install runs. |
| **Cold-new-lockfile** | The `lockSha256` has **no sealed cache** yet. A full dependency install is required. Per §3.3 this case must **never** occur on a user's start path; it is absorbed by pre-warming (§5.1, §6.3). |

Cases are defined **per path**. On the live path, "warm pod" means a
live-session pod (§5.2). On the static path (`build_publish`, S5), no
live session is opened: the case is **Warm** when the `lockSha256` has
a sealed cache and a builder build pod is available, **Cold-known**
when the sealed cache exists but a build pod must be started, and
**Cold-new-lockfile** as above. S6 is judged separately for Warm and
for Cold-known (§3.1), never as one blended target.

`lockSha256` is computed over the exact lockfile bytes the build will
consume (`package-lock.json` of the bound repo/subPath at the pinned
commit). Two artifacts with the same `lockSha256` share one sealed
cache.

Phase boundaries are timestamped events (§5.4): `start_accepted`,
`pod_ready`, `cache_ready`, `preview_routable` (live) /
`build_started`, `build_finished`, `bundle_published`,
`url_routable` (static). Durations are computed from these events, not
from client-side wall clock alone.

---

## 3. Measurable SLOs

### 3.1 Phase SLOs

`[TARGET]` For each phase: **p95** over the acceptance run (§7) and an
absolute **max** (no single run may exceed it). Breaching max once
fails acceptance even if p95 passes.

| # | Phase (events) | Case | p95 | Max |
| --- | --- | --- | --- | --- |
| S1 | Live start → `LIVE`: `start_accepted` → `preview_routable` | Warm | < 30 s | 45 s |
| S1c | Live start → `LIVE` | Cold-known | < 30 s | < 60 s |
| S2 | `live_write` accepted → change visible in preview | Warm session | < 5 s | 10 s |
| S3 | `git_commit` accepted → commit present on bound branch | Warm session | < 10 s | 30 s |
| S4 | `stop` accepted → session closed, pod released | Any | < 15 s | 30 s |
| S5 | `git_publish` accepted → `url_routable` (`build_publish` included) | Warm (static path, §2) | < 25 s | < 60 s |
| S6 | **End to end: new artifact → published URL** (attach → … → `git_publish` → `url_routable`, one small content write included) | Warm, and separately Cold-known | **< 40 s** | **< 60 s** |

S6 is the owner requirement of §1.1 expressed end to end. The phase
maxima above are **standalone ceilings**: they bound a phase measured
on its own, and their sum (120 s) is *not* the S6 budget. S6 carries
its own joint allocation below, which every phase on the S6 path must
fit *in that run*. No phase on that path performs a network dependency
install (§3.3).

**S6 joint budget allocation** (sequential path
`attach → live start → live_write → git_commit → stop → git_publish`,
per run; the acceptance artifact is the small §7.1 artifact):

| Step on S6 path | Joint p95 budget | Joint max budget |
| --- | --- | --- |
| `artifacts_git_attach` | 2 s | 3 s |
| S1 live start → `LIVE` | 15 s | 20 s |
| S2 `live_write` → visible | 3 s | 5 s |
| S3 `git_commit` | 5 s | 7 s |
| S4 `stop` | 3 s | 5 s |
| S5 `git_publish` → `url_routable` | 12 s | 15 s |
| **Sum of joint budgets** | **40 s** | **55 s** |

Pass rule: a run meets S6 only if (a) its total is < 60 s, (b) every
step fits its joint max budget, and (c) over the §7 runs the total p95
is < 40 s and every step p95 fits its joint p95 budget. The 55 s sum of
joint maxima leaves 5 s of unallocated margin under the 60 s hard
maximum. If a phase cannot fit its joint budget in measurement, the
fix is to make the phase faster or overlap it explicitly (with the
overlap measured from the §5.6 events) — never to raise S6 above
60 s.

Notes:

- S2 "visible in the preview" means the preview endpoint serves the
  new content (HTTP 200 with the new asset hash), not merely that the
  write was accepted. Incremental build (§5.3) is measured inside S2.
- S5 starts at publish acceptance with the content already committed;
  it includes builder admission, build, bundle upload and URL
  routing. It excludes user think time between `git_commit` and
  `git_publish`.
- Cold-known (S1c) shares the S1 p95 target: pod start plus sealed
  cache mount must fit the same budget. If measurement shows this is
  not attainable, the warm-pool minimum (§5.2) is raised instead of
  relaxing S1c — `[OPEN]` Q3.

### 3.2 What counts as meeting the SLO

- p95 and max are computed over the §7 scripted runs, per
  environment, per case. A p95 claim requires **at least 20 runs**
  per scenario/case/environment; no p95 is reported or judged below
  that count. The percentile method is fixed: sort the N durations
  ascending and take the value at 1-based rank `ceil(0.95 × N)`
  (nearest-rank; at N = 20, the 19th value). Max is the largest of
  the N durations. Client-observed latency and builder phase events
  are both recorded; discrepancies > 2 s between them are themselves
  a defect (clock/observability gap).
- A run that ends in a typed failure (§3.4) counts as a max breach for
  its phase, not as a missing sample.

### 3.3 New lockfile behaviour (cold-new-lockfile)

`[TARGET]` A user's `live start` or `git_publish` must **never** pay a
full dependency install. When a publish/start references a
`lockSha256` with no sealed cache:

1. The builder **rejects fast** (≤ 5 s) with typed code
   `cache_not_prewarmed` (retriable, with the `lockSha256` in the
   error detail) — or queues the request *without* blocking the
   session, if a queueing contract is agreed (`[OPEN]` Q1). A
   multi-minute install inside the request is a spec violation.
2. The **pre-warming path** (§5.1, §6.3) seals the cache ahead of
   need: triggered by immo when a lockfile change merges to immo
   `main` (and on prod-tag creation), never during a user's start.
3. Pre-warming itself has a soft target, measured but not on the user
   path: sealed cache ready **< 15 min p95** from merge to `main`.
   Until it completes, artifacts on the new lockfile degrade to the
   fast typed rejection above — visible, never silent, never a
   20-minute hang (§4).

### 3.4 Tolerated errors

`[TARGET]` **Zero silent failures.** Concretely:

- Every failed operation returns a **typed error code** (stable string
  code, `retriable` flag, human-readable detail) to the MCP caller.
  Fire-and-forget dispatch with a swallowed error is forbidden on
  every path (§4 shows why).
- Every failure emits **one structured log line** on the failing side
  (host or builder) carrying at least: artifact id, operation, phase,
  typed code, correlation/invocation id. A failure with no log line
  is a defect even if the caller saw the typed error.
- No operation may report success (2xx / accepted) and then fail
  invisibly: acceptance means the intent is durably recorded **and**
  a re-drive mechanism (§5.4) owns it until a terminal state
  (`LIVE` / `published` / typed failure).
- Edge/MCP transport must not mask outcomes: a gateway timeout
  (e.g. Cloudflare 502) on an operation that later succeeds is a
  defect (§5.5). Retriable typed failures with automatic recovery
  (§7.4) are tolerated; untyped 5xx are not.
- Error budget: within the §7 acceptance runs, **0** silent failures
  and **0** untyped errors are tolerated. In production, any silent
  failure is a severity-1 defect against this spec regardless of rate.

---

## 4. Measured baseline — 2026-11-10/11 (facts)

Sections §4.2–§4.4 and §4.6 are `[FACT]`, measured in preprod on
2026-11-10/11 with the source named inline. §4.1 is
`source-gap` / `unverified` (see its header). It is the gap this spec
exists to close: the current system does not meet a single SLO of §3,
and its dominant failure mode is silence, not slowness.

### 4.1 Cold install decomposition — `source-gap` / `unverified`

Status: `source-gap` / `unverified`. No builder log or phase record
for these figures is retained in this repo or in the cited
artefact-focus reports, so this decomposition cannot be traced to a
source and must not be cited as `[FACT]`. The figures below are the
conductor-relayed phase measurements reported for the 2026-11-10/11
cold installs, kept only as an unverified indication of scale until a
builder source is joined. One cold dependency install on the builder,
step by step (sum of steps ≈ **3.5 min**, before any build):

| Step | Duration | Volume / note |
| --- | --- | --- |
| `cache_lookup` | 8 ms | sealed-cache miss on the new `lockSha256` |
| `heavy_admit` | 18 ms | admission of a heavy (install-class) job |
| `forge_redownload` | 21 s | 187 MB, 4 004 files re-downloaded |
| `source_transfer` | 41 s | source tree transfer to the builder pod |
| `tarball_stream` | 108 s | 384 MB streamed tarball |
| `npm ci` | 30 s | install inside the pod |

After the steps above, **drain added 17–25 min** (pod drain /
install-phase completion wait) on top, so a cold publish ran far past
every §3 target. The install phase first hit the old **20 min ceiling**
and failed with typed phase timeout `phase_timeout:install:drain`;
the ceiling was then raised to **45 min**, which converts the failure
into a 45-minute wait instead of fixing the path. Neither behaviour is
compatible with §3.3: the install must leave the user path entirely
(pre-warming, §5.1), not get a larger timeout.

### 4.2 Live dispatch: fire-and-forget, no re-drive, no log

Source: `LIVE-DISPATCH-REPORT.md` (investigation 2026-11-11
05:10–05:35Z, preprod read-only).

- The live start is dispatched **exactly once, fire-and-forget**,
  inside `radar-immo-mcp`; its failure is swallowed with **no log and
  no retry**. A staging rejection means the reconcile POST is never
  sent and no builder pod is ever created.
- **No re-drive exists**: no scheduler, tick, outbox or lease scanner
  re-runs a stuck `REVIVING` draft on either side. A repeated explicit
  `live_control(start)` on a `REVIVING` record is refused
  (`active_session`), so an operator cannot even re-trigger dispatch.
- Census at investigation time: 6 live drafts ever in preprod —
  **4 stuck `REVIVING`, 1 stuck `QUIESCING` since 2026-11-08, 1 never
  started. No draft has ever reached `LIVE` in preprod.**
- Orphan sessions follow directly: sessions whose start or `stop`
  failed invisibly remain `REVIVING`/`QUIESCING` with `podUid=null`,
  holding their binding until manual DB inspection finds them.
  `stop` on such a record returns `invalid_request` (its worker call
  cannot settle), so the orphan cannot be cleaned up through the API
  either.

### 4.3 Publish path: reconcile, stale session, pending publication

Sources: `RECONCILE-REPORT.md`, `DISPATCH-REPORT.md`,
`ATTACH-REPORT.md` (2026-11-10, preprod read-only).

- Before the immo fix (#1067, "reconcile before build"), `git_publish`
  sent only `POST v1/builds`: an artifact attached and committed
  **without ever being opened live** had no builder session and was
  refused at admission with `git_live_conflict` / `stale_session`,
  then closed `build_failed` ~13 min later by the pending-build
  reconciler. Jobs `5fd74595`, `07ab4c5c` failed exactly this way.
- The builder-side gate also surfaces as `pending_publication`: a
  `live_control start` on a binding in `build_failed` is refused
  `git_live_conflict/pending_publication`, and without a reconcile
  the publish retry loop returns the same `stale_session`.
- The first #1067 reconcile attempt made the failure **earlier and
  silent**: the package live worker requires a live runtime (fences)
  that an attach-only artifact does not have, so reconcile threw
  `provider_unavailable` locally — projected to the caller as HTTP 503
  `capability_unavailable` / `dispatch_failure` — **before** any job
  row, binding event, failure-ledger row or log line was written.
  Two publish invocations (2026-11-10 ~10:43 and ~10:45 Montréal)
  left zero trace in either pod.
- `attach` itself failed typed-but-undocumented: the documented call
  `artifacts_git_attach({artifactId, idempotencyKey})` returned
  `invalid_request` because the deployed provider requires `repoId`
  (and `baseRef` for a new branch) that the host never defaulted
  (immo fix: PR #1064). Three failed attaches left no durable trace.

### 4.4 Transport masking

- `live_write` and `git_commit` calls have returned **Cloudflare 502**
  at the edge while the underlying operation's real latency exceeded
  the gateway timeout: the caller sees an untyped transport failure
  and cannot tell whether the write landed (idempotency keys make the
  retry safe, but the outcome of the first call stays `unknown` to
  the caller). This is the §3.4 "success masked as failure" defect.

### 4.5 Baseline vs SLO summary

| SLO | Baseline 2026-11-10/11 |
| --- | --- |
| S1 live start → `LIVE` < 30 s | Never reached `LIVE` in preprod (4 drafts stuck `REVIVING`) |
| S2 `live_write` → visible < 5 s | Not measurable (no live session); writes returned edge 502 |
| S5 `git_publish` → published < 60 s | `source-gap` / `unverified` (§4.1): cold path reported ≈ 3.5 min of steps + 17–25 min drain; `phase_timeout:install:drain` at 20 min, ceiling raised to 45 min — no builder source retained |
| S6 end to end < 60 s | Not attainable: every phase above blocks it |
| §3.4 zero silent failures | Violated: fire-and-forget dispatch, swallowed `catch {}`, pre-persist failures with no job/failure/log row |

### 4.6 Fresh artifact still `REVIVING` — 2026-11-11 06:25–07:15Z

Source: `LIVE-DISPATCH-REPORT.md` (mechanism proven there, §4.2) and
the conductor observation window 2026-11-11 06:25–07:15Z in preprod.

- `[FACT]` A fresh artifact (`50b3866d…`) created in that window
  stayed in phase `REVIVING` for the full **50 minutes** of the
  window (06:25–07:15Z), with `podUid=null` throughout.
- `[FACT]` No builder pod was created for it, and its live start was
  **never dispatched** to the builder: no draft staging, no reconcile
  POST, no builder-side trace — the same fire-and-forget dispatch
  failure proven in §4.2, reproduced on a fresh artifact after the
  2026-11-11 04:39Z/04:49Z restarts.
- `[FACT]` Nothing re-drove the intent during those 50 minutes: no
  scheduler, tick, outbox or lease scanner picked the `REVIVING`
  record up (§4.2), and no typed failure or structured log line
  surfaced to the caller.
- Baseline consequence: S1 and S6 remain at "never reached `LIVE`"
  (§4.5) as of 2026-11-11 07:15Z; the §5.4 re-drive and typed-log
  requirements are the blocking fix, ahead of any duration tuning.

Source files (immo artefact-focus checkout, sibling of this repo):
`/home/antoinefa/src/radar-immobilier-artefact-focus/LIVE-DISPATCH-REPORT.md`,
`DISPATCH-REPORT.md`, `RECONCILE-REPORT.md`, `ATTACH-REPORT.md`.
Step timings of §4.1: `source-gap` / `unverified` — no builder log
is retained in this repo; the figures above are the conductor-relayed
phase measurements for those installs, with no builder source joined.

---

## 5. Requirements on the builder (Sentropic owner)

Each requirement is observable from the immo side; none prescribes
builder internals beyond the stated observable property.

### 5.1 Dependency cache: pre-warmed and sealed per `lockSha256`

- `[TARGET]` For each `lockSha256`, the builder produces **one sealed,
  immutable cache unit** (layer or image) containing the installed
  dependency tree. A sealed unit is content-addressed by `lockSha256`,
  is never mutated in place, and can be mounted/extracted by any
  builder pod without network access.
- `[TARGET]` Cache states are queryable per `lockSha256`:
  `absent | building | sealed | failed(typed)`. `live start` and
  `git_publish` on a `sealed` cache perform **zero network install**
  (no `forge_redownload`, no `tarball_stream` of dependencies, no
  `npm ci` against a registry) — this is what removes the §4.1 steps
  from the user path.
- `[TARGET]` A **pre-warm API** (or equivalent builder endpoint) lets
  immo request sealing for a `lockSha256` ahead of need (§6.3). The
  request is asynchronous, idempotent per `lockSha256`, and its
  completion is observable (state reaches `sealed` or typed `failed`).
  Pre-warm latency soft target: < 15 min p95 (§3.3).
- `[TARGET]` Retention: a sealed cache is kept while any immo `main`
  or prod-tag lockfile references it, plus a grace window
  (`[OPEN]` Q2). Eviction is reported, never discovered by a failed
  start.

### 5.2 Warm pod pool

- `[TARGET]` The builder keeps a pool of **warm pods per tenant**
  (pod started, runtime ready, able to mount a sealed cache
  immediately): **minimum ≥ 1 per tenant** at all times in preprod
  and prod, sized up under load (`[OPEN]` Q3).
- `[TARGET]` Claiming a warm pod is part of S1's 30 s budget. Pool
  exhaustion degrades to cold-known (S1c), never to an install and
  never to an untyped queue wait: the caller sees either `LIVE`
  within max, or a typed, retriable failure.
- `[TARGET]` Pool state (warm count, claims, exhaustion events) is
  exposed as metrics (§5.6).

### 5.3 Incremental build for live preview

- `[TARGET]` `live_write` triggers an **incremental vite build**: only
  changed modules are rebuilt; a one-file edit must fit S2 (< 5 s to
  visible). A full rebuild on every write is a spec violation when it
  breaches S2 p95.
- `[TARGET]` "Visible" is verifiable: the preview serves the new asset
  hash; the write response (or a status read) carries the built
  revision so the conductor can poll the exact expected content.

### 5.4 Dispatch reliability: retry, re-drive, typed logs

This subsection closes §4.2/§4.3. It applies to whichever side owns
each mechanism; the split below follows the current architecture
(package worker on the Sentropic side, host composition on the immo
side, §6.1) and may be re-cut by agreement — the observable properties
may not.

- `[TARGET]` **No fire-and-forget.** Accepting a start/publish durably
  records the intent, and a **re-drive scanner** (periodic, ≤ 60 s
  interval) re-dispatches every non-terminal intent (`REVIVING`,
  accepted-but-unpublished) until it reaches a terminal state. An API
  or builder restart must not strand an intent (§7.4).
- `[TARGET]` **Dispatch retries with backoff** on retriable failures
  (transport, 5xx, admission races), bounded at **5 attempts over
  ≤ 5 min**, after which the intent lands in a **typed terminal
  failure** visible to the caller — never in limbo.
- `[TARGET]` **Typed logs everywhere.** Every dispatch attempt and
  every failure emits the §3.4 structured log line. A swallowed
  `catch {}` on a dispatch path is a spec violation. Error codes are
  stable and documented (`cache_not_prewarmed`, `stale_session`,
  `pending_publication`, `phase_timeout:<phase>:<step>`, …); new
  codes are added to the contract, not invented per release.
- `[TARGET]` **Idempotency end to end.** Re-driving or retrying with
  the same idempotency key never duplicates a session, commit or
  publication; a repeated `live_control(start)` on a `REVIVING`
  record joins/re-drives the existing intent instead of refusing
  `active_session`.

### 5.5 Session lifecycle and orphan teardown

- `[TARGET]` The builder reaps **orphan sessions**: sessions in
  `REVIVING`/`QUIESCING` with no live pod and no progress for
  > 10 min are torn down, their binding lock released, and the draft
  lands in a typed terminal state the host can read. Teardown events
  are logged and counted (§5.6).
- `[TARGET]` `stop` is total: for any non-terminal session state,
  `stop` either closes the session (S4) or returns a typed code that
  names the exact blocker. `invalid_request` on stopping an orphan
  (§4.2) is a spec violation.
- `[TARGET]` Pod death mid-session is detected by the builder; the
  session is re-driven onto a healthy pod (draft content preserved)
  or failed typed (§7.4) — never left `REVIVING` forever.

### 5.6 Edge/MCP timeouts and per-phase metrics

- `[TARGET]` **No 502 on an operation that succeeds.** Edge and MCP
  gateway timeouts are set **above the max** of every synchronous
  phase (§3.1), or the operation answers **asynchronously**: accepted
  with an invocation id, outcome read via status poll. A transport
  timeout must never be the only signal for an operation whose real
  latency is within its SLO max (§4.4).
- `[TARGET]` **Per-phase metrics exposed to the conductor.** For every
  phase event of §2 the builder emits a timestamped record queryable
  by the conductor (API or metrics endpoint), keyed by artifact id +
  invocation id: `start_accepted`, `pod_ready`, `cache_ready`
  (with `lockSha256` and cache state), `preview_routable`,
  `build_started`, `build_finished`, `bundle_published`,
  `url_routable`, plus terminal typed failures. Retention ≥ 30 days
  in preprod/prod (`[OPEN]` Q4).
- `[TARGET]` From these records the conductor computes p50/p95/max
  per phase, per case (warm/cold-known), per environment — the §7
  acceptance numbers and the §6.4 dashboard read the same source.

### 5.7 Platform requirements (k8s owner)

- `[TARGET]` **Gateway timeout value.** The k8s owner sets the
  edge/gateway timeout for every synchronous MCP/builder route
  **above 60 s** (the §3.1 hard maximum) — or the route answers
  asynchronously per §5.6. The configured value, per route, is
  recorded in the §7 acceptance report; an unrecorded value is a
  failed check, not an assumption.
- `[TARGET]` **Pool primitives.** The k8s owner provides the
  scheduling primitives the §5.2 warm pool consumes (pod placement,
  pre-pull of the builder image, priority/preemption policy that
  keeps ≥ 1 warm pod per tenant schedulable) and the pod-kill /
  rollout-restart operations used by the §7 fault injections. Pool
  pods that cannot be scheduled within the S1 joint budget (20 s,
  §3.1) surface as a typed pool-exhaustion event (§5.2), never as a
  silent pending pod.

---

## 6. Requirements on immo (host)

### 6.1 Reconcile before build — done (#1067)

`[FACT]` Done. Every `git_publish` now reconciles the binding with the
builder (`POST v1/live/reconcile`) before persisting the build job and
before `POST v1/builds`; a reconcile refusal fails closed with a typed
code and no build is requested. A retry after `build_failed`
re-reconciles instead of staying blocked on `stale_session`
(`RECONCILE-REPORT.md`; host package `packages/artifacts-host`).
Remaining host-side duty under §5.4: the composed live worker's
failures are logged as structured JSON before propagating (no
swallowed dispatch on the host path).

### 6.2 Generic RW relay — done (#1076)

`[FACT]` Done. The host exposes a generic read/write relay for
artifact content (no per-artifact bespoke wiring), so live and static
flows share one host surface. New artifact kinds onboard through the
relay without host code changes; relay operations carry the same
typed-code + structured-log contract (§3.4).

### 6.3 Pre-warming triggered on immo `main` merge

- `[TARGET]` On every merge to immo `main` (and on prod-tag creation)
  that changes a consumed lockfile, immo computes the new
  `lockSha256` and calls the builder pre-warm API (§5.1) in the same
  delivery pipeline — **before** any user can start an artifact on
  that lockfile.
- `[TARGET]` The trigger is idempotent and observable: the merge
  pipeline records `lockSha256` + pre-warm invocation id; failure to
  trigger is a pipeline failure (typed, logged), never a silent skip.
  Until sealing completes, §3.3 fast rejection applies.
- `[TARGET]` Immo also pre-warms on conductor request (manual trigger)
  for incident recovery and for the §7.3 cold-lockfile test.

### 6.4 Conductor dashboard (phase durations)

- `[TARGET]` The conductor dashboard shows, per environment: live
  phase durations (p50/p95/max per §3.1 phase and case), cache state
  per current `lockSha256` (`absent|building|sealed|failed`), warm
  pool occupancy, orphan/re-drive counters, and the typed-failure
  rate. Source: the §5.6 builder records joined with host invocation
  logs — one source of truth, no hand-kept spreadsheet.
- `[TARGET]` SLO breach (p95 over target over a rolling 24 h window,
  or any silent failure) is flagged on the dashboard the day it
  happens. `unknown` / `source-gap` states are displayed as such,
  never as zero.

### 6.5 Host contract hygiene

- `[TARGET]` Documented MCP calls work as documented: host defaults
  (`repoId`, `baseRef`) are applied by the host, not rediscovered per
  call (the §4.3 `invalid_request` attach failure stays fixed).
- `[TARGET]` Host never swallows a builder/worker error: every
  failure is logged structured (§3.4) and propagated typed, unchanged,
  to the MCP caller.

---

## 7. Acceptance tests

**Duration measurement is MCP-only**: every artifact-flow step and
every timed duration in §7.1–§7.3 is executed and measured through
the real MCP surface — `artifacts_git_attach`,
`artifacts_live_control` (start/stop), `artifacts_live_write`,
`artifacts_live_status`, `artifacts_git_commit`,
`artifacts_git_publish` — with no kubectl, no direct builder HTTP and
no DB writes on the measurement path. If a duration cannot be proven
through MCP, it is not accepted.

Fault injection and environment preparation (§7.2, §7.4) are **not**
MCP operations. They are authorised only as the explicit out-of-MCP
gestures in the table below, executed by the named owner, and each
must leave the expected trace in the acceptance report. Any other
out-of-MCP gesture invalidates the run.

| Gesture | Executor | Channel | Expected trace in report |
| --- | --- | --- | --- |
| Verify cache state `sealed` for the current `lockSha256` before §7.1 | Sentropic (builder) | Builder cache-state query (§5.1: `absent\|building\|sealed\|failed`) | `lockSha256` + state + timestamp per run set |
| Drain the warm pool (§7.2) without touching the sealed cache | Sentropic (builder), k8s for pod ops | Builder pool control / k8s pod operations | Pool occupancy before/after, drain timestamp |
| Kill builder pod mid-start (F1), kill pod mid-session (F3) | k8s, coordinated by Sentropic | k8s pod delete on the named builder pod | Pod uid/name, kill timestamp, §5.6 records for the affected artifact |
| Restart builder API (F2) | Sentropic (builder), k8s for rollout | k8s rollout restart of the builder API | Restart window timestamps, intent id surviving the restart |

Prod acceptance repeats §7.1 after the preprod pass, before the SLO
is declared live in prod.

### 7.1 Warm end-to-end scenario (S6, S1, S2, S3, S4, S5)

Scripted scenario, **run 20 times** consecutively (the §3.2 minimum
for a p95 claim):

1. Create a new artifact on the current immo `main` lockfile
   (pre-warmed per §6.3; cache state `sealed` verified via the §7
   out-of-MCP gesture table, not via MCP).
2. `artifacts_git_attach` (base `main`), `artifacts_live_control`
   start → assert phase `LIVE` via `artifacts_live_status`; record S1.
3. One small `artifacts_live_write` (single file change); poll the
   preview until the new asset hash is served; record S2.
4. `artifacts_git_commit`; assert the commit exists on the bound
   branch; record S3.
5. `artifacts_live_control` stop; assert session closed and pod
   released; record S4.
6. `artifacts_git_publish`; poll the published URL until it serves
   the bundle (HTTP 200); record S5 and S6 (attach → URL).

**Pass**: for every phase, p95 over the 20 runs (nearest-rank,
§3.2) < target **and** every single run < max (§3.1); for S6, the
joint budget allocation of §3.1 also holds per run and in p95; 20/20
runs reach a published URL; 0 silent failures, 0 untyped errors
(§3.4). Phase durations are taken from the §5.6 records and
cross-checked against client-observed latency (§3.2).

### 7.2 Cold-known scenario (S1c)

Destroy the warm pool claim without touching the sealed cache
(builder-side pool drain, authorised out-of-MCP gesture per the §7
table, coordinated with the Sentropic owner), then run §7.1 steps
2–5 **20 times** (the §3.2 minimum for a p95 claim). **Pass**: S1c
p95 < 30 s (nearest-rank over the 20 runs), every run < 60 s; no
network install appears in the builder phase records (cache state
`sealed` throughout).

### 7.3 Cold-lockfile scenario (§3.3, §5.1, §6.3)

1. Land a lockfile change on a test branch/fork whose `lockSha256`
   has never been sealed. Attempt `live start` **without**
   pre-warming. **Pass**: fast typed rejection
   (`cache_not_prewarmed`, ≤ 5 s) — not an install, not a hang, not
   a silent `REVIVING`.
2. Trigger pre-warming the way a `main` merge would (§6.3). **Pass**:
   cache state reaches `sealed` < 15 min, observable throughout.
3. Re-run §7.1 once on the new lockfile as a functional smoke only
   (a single run carries no p95 claim, §3.2). **Pass**: the run
   reaches a published URL within the S6 hard maximum (< 60 s); the
   warm SLO p95 claim itself requires the full 20-run §7.1 campaign.

### 7.4 Failure scenarios (typed failure + automatic recovery)

Each scenario is injected in preprod, coordinated with the Sentropic
owner. The injection itself uses the authorised out-of-MCP gestures
of the §7 table; the artifact flow and all outcome reads stay on MCP
+ the §5.6 records. In F1/F2, "max" means the **S1 standalone max**
(45 s warm, §3.1) and "one re-drive interval" means the §5.4 scanner
interval (≤ 60 s): the session must reach `LIVE` or a typed terminal
failure within **S1 max + 60 s** of the injection.

| # | Injection | Expected outcome |
| --- | --- | --- |
| F1 | **Dead pod**: kill the builder pod mid-`live start` (during `REVIVING`) | Re-drive (§5.4) re-dispatches; session reaches `LIVE` within S1 max + 60 s, **or** lands in a typed terminal failure the caller can read. Never stuck `REVIVING` > 10 min; failure carries a typed code + log line. |
| F2 | **API restart during a start**: restart the builder API between acceptance and `LIVE` | Durably recorded intent survives; re-drive scanner resumes it after restart; same terminal guarantee as F1. No duplicate session (idempotency, §5.4). |
| F3 | **Pod death mid-session** (after `LIVE`, before `stop`) | §5.5: session re-driven with draft preserved, or typed failure; `stop` afterwards still succeeds or fails typed — never `invalid_request` on an orphan. No orphan remains after 10 min. |
| F4 | **Edge timeout pressure**: `live_write` + `git_commit` under the pre-fix gateway timeout conditions | No 502 masking: each call returns its real typed outcome, or an async invocation id whose poll returns it (§5.6). |

**Pass (all)**: every injected failure produces (a) a typed code to
the caller or a recovered success, (b) exactly the §3.4 structured log
lines, (c) automatic recovery with no manual DB/kubectl intervention,
(d) zero silent failures across the whole acceptance campaign.

### 7.5 Reporting

The acceptance report (one per environment) publishes: per-phase
p50/p95/max tables per case, all raw S6 durations (20 per campaign),
cache-state transitions, and every failure observed with its typed code. Numbers
come from the §5.6 records; any phase that cannot be measured is
reported `source-gap` and blocks acceptance — an unmeasured SLO is
not a passed SLO.

---

## 8. Lots, owners, dependencies, open questions

### 8.1 Lots

| Lot | Deliverable | Owner | Depends on |
| --- | --- | --- | --- |
| L1 | Sealed cache per `lockSha256` + cache-state query + pre-warm API (§5.1) | Sentropic (builder) | — |
| L2 | Warm pod pool ≥ 1/tenant + pool metrics (§5.2) | Sentropic (builder), k8s (pool placement/sizing) | L1 (cache mount contract) |
| L3 | Incremental vite build + built-revision reporting (§5.3) | Sentropic (builder) | L1 |
| L4 | Dispatch retry + re-drive scanner + typed logs (§5.4); host-side worker-failure logging (§6.1) | Sentropic (package/builder) + immo (host composition) | — |
| L5 | Orphan teardown + total `stop` (§5.5) | Sentropic (builder) | L4 |
| L6 | Edge/MCP timeout fix or async responses; per-phase metrics endpoint (§5.6) | Sentropic (edge/builder), k8s (gateway timeouts) | — |
| L7 | Pre-warm trigger on immo `main` merge + prod tag (§6.3) | immo | L1 |
| L8 | Conductor dashboard: phase durations, cache/pool state (§6.4) | immo | L6 |
| L9 | Acceptance campaign §7 in preprod, then prod (§7.1–§7.5) | immo (conductor), Sentropic on call for injections | L1–L8 |

Owners: **immo** = this repo (host, MCP surface, dashboard, acceptance
driver); **Sentropic** = artifact builder + `@sentropic/artifacts`
package + edge; **k8s** = cluster/platform (gateway timeouts, pool
scheduling, pod lifecycle primitives the builder consumes).

### 8.2 Dependencies and order

- The user-path SLOs (S6 above all) depend on **L1 + L2 landing
  first**: without a sealed cache and a warm pod, no dispatch fix can
  bring a 3.5-minute install under 60 s.
- L4/L5 are independent of L1/L2 and close the §4.2/§4.3 silence
  defects; they should land in parallel — a fast system that still
  fails silently does not meet this spec (§3.4).
- L7 depends on the L1 pre-warm API contract (`lockSha256` + state
  query). L8 depends on the L6 metrics contract. Both contracts are
  small and should be frozen before implementation starts
  (`[OPEN]` Q1/Q4).
- Already landed on the immo side: reconcile-before-build (#1067,
  §6.1) and the generic RW relay (#1076, §6.2). Attach host defaults
  (PR #1064, §6.5) are merged (2026-11-10); only their preprod
  deployment remains to be confirmed before §7 runs, or §7.1 step 2
  uses the explicit-`repoId` call form.

### 8.3 Open questions

- **Q1 — Un-prewarmed request shape.** Fast typed rejection
  (`cache_not_prewarmed`, §3.3) vs non-blocking queue with async
  completion. This spec defaults to fast rejection; a queue is
  acceptable only if the session is never blocked and completion is
  pollable. *Decider: owner, with Sentropic.*
- **Q2 — Sealed-cache retention/grace.** How long a sealed cache for
  a superseded `lockSha256` is kept (storage cost vs rollback to a
  prod tag). *Decider: Sentropic (cost), immo (rollback need).*
- **Q3 — Warm pool sizing.** Min ≥ 1/tenant is the floor; burst
  sizing and whether cold-known keeps the 30 s p95 (S1c) or the pool
  minimum rises per tenant need load data from the first preprod
  campaign. *Decider: k8s + Sentropic.*
- **Q4 — Metrics surface.** Builder phase records via dedicated API,
  metrics endpoint, or log export; retention ≥ 30 days proposed.
  The §7 numbers and §6.4 dashboard need one frozen contract.
  *Decider: Sentropic, immo consumes.*
- **Q5 — Prod-tag pre-warming.** Whether prod-tag creation pre-warms
  synchronously in the tag pipeline or via the same async trigger as
  `main` merges (§6.3). *Decider: immo.*
- **Q6 — Error-code registry.** Where the stable typed-code list
  (§5.4) lives (builder contract doc vs package) and its change
  process. *Decider: Sentropic, immo reviews.*

No open question blocks writing code against §5.1/§5.4; Q1 and Q4
block freezing the L7/L8 contracts and must be answered before those
lots start.





