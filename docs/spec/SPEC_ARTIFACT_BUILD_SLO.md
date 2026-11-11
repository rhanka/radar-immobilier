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
in **under 1 minute** on an already-known lockfile (§3). Every phase of
the flow carries its own measurable SLO (§3), and **no failure may be
silent**: every failure surfaces a typed error code and a structured log
line (§3.4).

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
git_publish → publish_bundle → published URL
```

- `publish_bundle`: the builder builds the bound branch/subPath at a
  pinned commit and publishes the resulting bundle. This is the only
  path for artifacts never opened live, and the final step of the live
  flow.

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
| S1c | Live start → `LIVE` | Cold-known | < 30 s | 60 s |
| S2 | `live_write` accepted → change visible in preview | Warm session | < 5 s | 10 s |
| S3 | `git_commit` accepted → commit present on bound branch | Warm session | < 10 s | 30 s |
| S4 | `stop` accepted → session closed, pod released | Any | < 15 s | 30 s |
| S5 | `git_publish` accepted → `url_routable` (`publish_bundle` included) | Warm | < 60 s | 90 s |
| S6 | **End to end: new artifact → published URL** (attach → … → `git_publish` → `url_routable`, one small content write included) | Known lockfile (warm or cold-known) | **< 60 s** | 90 s |
