# SPEC — LLM batch work through an in-cluster llm-mesh gateway — draft

> **Status**: DRAFT for architect review (not a PR; no code changed). Grounds the
> architect spine against the codebase and corrects it where reality differs.
> Track item: `01KTNXDJ4V97FY3XSSDNA0AK81` — "llmesh — extraction semantique
> graphify via @sentropic/llm-mesh (enrolment token)" (workspace `wp5-ontology`,
> accountable `rhanka`; last event seq11 `item.reparented` 2026-08-01). The spine
> id `01M197X0…` is **not present** in `.track/events.jsonl` (unverified — closest
> match is the id above). English code; French UI; type-only imports.

## 1. Objective

Route radar's LLM-backed **batch** work (semantic **extraction** + citation
**grounding**) through an **in-cluster llm-mesh gateway** reached with a
**dedicated mesh account** (inbound-auth token via k8s Secret), instead of the two
paths that exist today: (a) per-provider HTTP calls with per-provider keys for
extraction/chat, and (b) a **host** codex enrollment (mesh loopback) for
grounding. Goal: centralize provider credentials, cost/quota metering, and model
routing, and move batch LLM execution into cluster jobs. The **chat** path is out
of scope for the batch cutover (it already runs in-cluster — see §2).

## 2. Current state (grounded — every claim cites file:line)

**Two distinct "mesh" realities exist; they are not the same thing.**

1. **In-process library mesh (extraction + chat).** `mesh-runtime.ts` assembles a
   single `@sentropic/llm-mesh` mesh **in the node process** (`createLlmMesh`,
   `api/src/services/chat/mesh-runtime.ts:825-827`) and injects
   `RadarProviderMeshClient` (`:271-335`), which `fetch`es each provider's **native
   HTTP endpoint directly** — `api.anthropic.com` (`:606`), `api.openai.com`
   (`:509`), `api.mistral.ai` (`:508`), Gemini (`:701`), Cohere (`:742`) — using
   **per-provider keys read from env** (`readApiKey`, `:127-138`;
   `extractCredential`, `:167-177`). **There is no gateway HTTP endpoint anywhere.**
   "The mesh" here is a **library**, not an in-cluster service.

2. **Extraction consumer.** `extractSemanticMentions`
   (`api/src/services/exploitation/semantic-extract.ts:194-249`) calls
   `radarLlmMesh.generate()` (`:206`), single-shot. It is **off by default**:
   self-gates on `RADAR_LLM_EXTRACTION=1` **and** a configured provider key
   (`:83-86`, `:199-204`), returns `[]` on disable/mis-config/error, never throws.
   Provider pick is neutral-alphabetical, no hardcoded default (`:88-106`;
   `LLM_MESH_BOUNDARY.md:69-71`). It is wired **inline in the exploit pipeline**
   (`api/src/services/sources/exploitation.ts:116`), **not** a dedicated job.

3. **Chat is already in-cluster on per-provider keys.** `deploy/k8s/30-api.yaml:162-165`
   injects `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` (optional) from Secret
   `radar-llm-credentials` into the **API pod**, which hosts `streamChatTurns`
   (`mesh-runtime.ts:873`). So chat does not need a host→cluster migration — only a
   key→gateway migration, deferred here.

4. **No in-cluster LLM execution today.** The in-cluster batch that runs the exploit
   pipeline is `worker-live` via jobs 33/33b and the refresh cronjob
   (`deploy/k8s/34-refresh-cronjob.yaml:89-96` runs `node dist/scripts/worker-live.js`
   with `LIVE_SCRAPE_EXPLOIT`). Those jobs inject **neither** `RADAR_LLM_EXTRACTION`
   **nor** any provider key (grep of 33/33b/34 shows only `LIVE_SCRAPE_EXPLOIT`), and
   the cronjob header states "AUCUN LLM" (`34-refresh-cronjob.yaml:9`). So the
   extraction LLM effectively **never runs in-cluster**; if flipped on it would use
   per-provider keys + direct provider HTTP.

5. **Grounding LLM runs on the HOST and is ALREADY mesh-routed — via enrollment,
   not per-provider keys.** `tools/grounding/worker-grounding.sh:27-30`:
   "codex CLI → llm-mesh → gpt-5.6-luna … enrollment LOCAL (mesh en loopback) :
   zéro secret cluster, zéro compte dédié", **fail-closed-if-mesh-down, no
   provider fallback** (`:28-29`, `:319-327`), under a hard call-ceiling
   (`MAX_LLM_CALLS`, `:70-88`). The in-cluster **job 41 is publish-only and NEVER
   talks to the mesh/LLM** by explicit ruling (`deploy/k8s/41-grounding-citation-job.yaml:1-11`:
   "no in-cluster mesh endpoint, so the LLM is NOT moved in-pod … The pod NEVER
   talks to the mesh/LLM"); its image carries "NO LLM-CLI, NO mesh access"
   (`deploy/grounding/Dockerfile:1-12`). The pod only pulls a host-staged candidate,
   hash-verifies, and publishes to MinIO (`41-…:5-9`).

6. **Config surface (measured).** `RADAR_LLM_EXTRACTION` is the only mesh flag
   parsed in config (`api/src/config.ts:135-138`); provider keys are read by
   `mesh-runtime.ts`, not `config.ts` (`config.ts:129-133`). No gateway URL / mesh
   account key exists in `config.ts` or anywhere under `deploy/` (grep for
   `MESH_`/`gateway`/`inbound` returns nothing).

7. **Model defaults (measured — no "Claude 5").** anthropic `claude-sonnet-4-6`
   (`mesh-runtime.ts:64-70`), openai `gpt-4.1-nano` (`:99-108`), gemini
   `gemini-3.1-flash-lite` (`:81-89`), mistral `mistral-small-2603` (`:90-98`),
   cohere `command-a-03-2025` (`:72-80`); grounding pins `gpt-5.6-luna`
   (`worker-grounding.sh:30`). The spine's "default to latest Claude 5" is not in
   the code.

8. **`LLM_MESH_BOUNDARY.md` is a npm-package module boundary, NOT a gateway
   contract.** It lists the package's exports and asks the architect to modularize
   a reusable provider-HTTP client, catalogue, and env-discovery helper
   (`docs/LLM_MESH_BOUNDARY.md:20-65`). It **does not** define an inbound HTTP
   endpoint or inbound-auth token contract — that contract does not yet exist
   (owner question, §6).

## 3. Target boundary

- **In-cluster gateway consumer.** Batch jobs (extraction + grounding) call a
  **gateway endpoint** with a **dedicated mesh account** credential, replacing
  per-provider client injection + per-provider keys **in the batch path**, and
  replacing the host codex loopback enrollment for grounding.
- **Auth model.** Inbound-auth token (enrollment-token style — matching the model
  the host grounding already uses, `worker-grounding.sh:27-29`) delivered as a k8s
  Secret to the in-cluster jobs. Fail-closed if the gateway is unreachable (no
  silent provider fallback — mirror `worker-grounding.sh:319-327`).
- **Config surface (new — names to ratify).** A gateway base URL + an account
  token, e.g. `LLM_MESH_GATEWAY_URL` + `LLM_MESH_ACCOUNT_TOKEN`, added to
  `config.ts` alongside `RADAR_LLM_EXTRACTION`. The gateway client is a new
  `ProviderAdapterClient` (or a mesh-published one, §6) selected over
  `RadarProviderMeshClient` when the gateway is configured.
- **What stays host / unchanged.** Chat stays in the API pod (§2.3), gateway
  migration deferred. Job 41's **publish** stage stays publish-only and untouched
  (`41-…:1-11`) — the LLM grounding is what moves in-cluster (a new LLM-capable job,
  **not** an extension of the publish-only job). The deterministic extraction path
  (`mentions.ts`) is never routed through any LLM.

## 4. Plan par lots

| Lot | Scope | Owner | Acceptance criterion |
|-----|-------|-------|----------------------|
| **L0** Discovery/grounding | Inventory every LLM call site + auth path; confirm no gateway/contract exists yet; confirm job 41 is publish-only (done, this doc). | extraction lane + sentropic architect | This doc reviewed; §2 findings ratified; §6 owner questions routed. |
| **L1** Auth + connectivity | Dedicated mesh account (i-infra); inbound-auth k8s Secret; config keys (gateway URL + account token) in `config.ts`; a **fail-loud** in-cluster connectivity smoke that `exit(1)`s when the gateway is unreachable. | i-infra + sentropic architect | An in-cluster job authenticates to the gateway; the smoke exits non-zero on an unreachable gateway (no silent skip), mirroring the grounding fail-closed discipline. |
| **L2** Extraction in-cluster | Route `extractSemanticMentions` through the gateway from an in-cluster batch job (mirror the `worker-live` job shape); behind a config flag; keep the per-provider-key path as fallback during transition. | extraction lane | A gated in-cluster run emits provenance-tagged semantic mentions via the gateway; deterministic path unaffected; fallback path still works. |
| **L3** Grounding in-cluster | Move the **LLM** grounding stage (`worker-grounding.sh` STAGE2) from host into a **new LLM-capable in-cluster job** on the gateway account, fail-closed, under the call-ceiling. Job 41 publish stage unchanged. | extraction lane + i-infra + architect | Grounding LLM runs in-cluster against the gateway with the dedicated account; call-ceiling honored; publish/hash-verify stage identical to today. |
| **L4** Cutover + observability | Cost/quota metering + model-routing policy per account; decommission per-provider keys (`radar-llm-credentials`) and host codex enrollment for the batch path. | i-infra + architect | Per-account cost/quota is visible; batch no longer needs per-provider keys or host codex; chat migration scheduled separately. |

## 5. Contributors

- **Extraction lane** (call-site owners): `semantic-extract.ts`, `exploitation.ts`,
  `mentions.ts`, `tools/grounding/worker-grounding.sh` — the LLM call sites.
- **i-infra**: dedicated mesh account, inbound-auth Secret, quota, cluster job
  resources + NetworkPolicy (compare the grounding NP,
  `deploy/k8s/72-networkpolicy-grounding-minio-preprod.yaml`).
- **Sentropic architect**: the gateway inbound API + inbound-auth token contract
  (does not exist yet, §2.8) and the package modularization of
  `LLM_MESH_BOUNDARY.md:38-65`.

## 6. Owner questions (coûts / quotas / modèles)

1. **Gateway contract.** There is no inbound HTTP gateway endpoint or inbound-auth
   token contract in the repo (`LLM_MESH_BOUNDARY.md` is a package boundary, not a
   network contract). Who defines it (sentropic architect), and what shape (URL,
   auth header, per-request model selector)?
2. **Models per task.** Code today: extraction uses the neutral first-configured
   provider default (e.g. `claude-sonnet-4-6`), grounding pins `gpt-5.6-luna`, chat
   uses the per-provider defaults (§2.7). What model does each task target through
   the gateway? (No "Claude 5" exists in the code — confirm the intended family.)
3. **Cost / quota / billing.** Cost budget + per-run quota, and who owns
   mesh-account billing? Today the host grounding bounds cost via `MAX_LLM_CALLS`
   (`worker-grounding.sh:70-88`) — what is the in-cluster equivalent?
4. **Provisioning.** Who provisions the dedicated mesh account + inbound-auth Secret
   — i-infra or the sentropic architect?
5. **Rate-limit / concurrency.** For batch extraction across the config-only cohort
   (**~528 cities** measured, `34-refresh-cronjob.yaml:7-8` — the spine's "~868" is
   unverified) and the bounded grounding worklist
   (`41-grounding-worklist-configmap.yaml`), what concurrency / rate-limit does the
   gateway allow?
6. **Data constraint.** Any constraint on PV/règlement text traversing the gateway
   (the host grounding keeps text public-only, invariant K1,
   `worker-grounding.sh:36-39`)?
7. **Fallback policy + duration.** Keep the per-provider-key path (extraction) and
   the host codex path (grounding) as fallback for how long during cutover?
8. **Enrollment vs account drift.** The track item's intent was "enrolment token"
   (`01KTNXDJ4V97FY3XSSDNA0AK81` body), but shipped extraction uses per-provider
   keys. Is the dedicated-account inbound token the intended convergence of both?

## 7. h2a (conditional note)

h2a reuse is **conditional**: usable only if it works **without** the `h2a_run`
MCP, which is currently DOWN (the `plugin:h2a:h2a` MCP failed to connect this
session). The parallel sentropic-side modularization was originally captured as an
h2a request to `sentropic:architect` (`LLM_MESH_BOUNDARY.md:6-8`). If the MCP stays
down, route L0/L1 architect coordination through the normal review channel and
treat any h2a step as best-effort, not a dependency.
