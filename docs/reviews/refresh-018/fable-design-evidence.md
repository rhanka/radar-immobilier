# Fable design review — unchanged source-verification appendix

Companion to [the completed review](fable-design.md), target `ca7d9acf`.
The conductor split the original report without altering the review evidence.

## Review basis

Static source verification only; no test, install, provider call or service was
executed. Reviewed at commit `ca7d9acf` exactly:
`docs/spec/SPEC_EVOL_REFRESH_018.md` and `docs/reviews/refresh-018/build-handoff.md`.
Verified against: producer worktree `/home/antoinefa/src/graphify/.worktrees/mesh-lot-c-final`
(read-only; HEAD `1710c9f2`, an ancestor of the cited release merge `1a723695`,
package version 0.18.0) including `dist/index.d.ts`, `dist/llm-mesh.d.ts`,
`dist/index.{js,cjs}`, `src/{configured-dataprep,profile-prompts,llm-mesh-bridge,index}.ts`
and installed `node_modules/@sentropic/llm-mesh@0.19.0` declarations; consumer
`api/src/services/graph/{canonical-graph-writer,graphify-34-snapshot,graphify-34-enrichment,graph-store}.ts`,
`api/src/scripts/{worker-live,project-graph-from-s3,emit-graphify34-candidates}.ts`,
`api/src/services/{sources/exploitation,exploitation/{semantic-extract,mentions}}.ts`,
`api/src/config.ts`, `api/package.json`, `package-lock.json`, `api/Dockerfile`,
`tools/graphify-v23/*`, `deploy/k8s/34-refresh-cronjob.yaml`,
`deploy/k8s/refresh-cronjobs{,-prod}/kustomization.yaml`, and branch
`origin/feat/graphify-v23-cas-ingest` (PR678, present, unedited).

## Verified-true design claims (spot-checked to source, not assumed)

- **Public API surface is real, with one exception (Finding 1).** Confirmed in
  0.18.0 dist declarations: `buildProfileChunkPrompt`, `validateExtraction`,
  `validateProfileExtraction`, `createDirectSemanticExtractionClient`,
  `loadOntologyProfile`, `loadProjectConfig`, `discoverProjectConfig`,
  `loadProfileRegistries`, `registryRecordsToExtraction`,
  `prepareSemanticDetection` (root); `createGraphifyMesh`, `meshTextJsonClient`,
  `classifyRouteFailure` (`/llm-mesh`). Mesh 0.19.0 exports `createLlmMeshFacade`
  (`/facade`, options `{configResolver, keyring?, mode:'cli'|'portal'}` with
  `createRoutePlanner(runtime)`), `GeminiAdapter`/`OpenAIAdapter`
  (`dist/adapters.d.ts:20,23`) and `CodexRuntimeClient`/`CloudCodeRuntimeClient`
  (transport declarations), all re-exported from the package root.
- **The generation contract is exactly as specified.** `TextJsonGenerationInput`
  = `{schema: string, prompt, outputPath?, validateResponse?, maxOutputTokens?}`
  — no `schemaDescription`, no `signal` (`dist/llm-execution-*.d.ts:1146`).
  `GenerateRequest` carries `signal?: AbortSignal` (mesh `dist/generation.d.ts:52`),
  so the spec's thin abort wrapper over `generateValidated(request, validator)`
  is implementable without private imports. `meshTextJsonClient` refuses a
  validator on a non-Graphify mesh, runs `validateResponse` before route
  completion via `generateValidated`, and writes the raw model text to
  `outputPath` (not normalized JSON) — all confirmed in `src/llm-mesh-bridge.ts`.
  `maxOutputTokens` is a ceiling-to-honor per the declaration contract.
- **The profile gap is real.** `nodeTypeSection` renders only
  registry/source_backed/status_policy per node type; `properties` and
  `extraction_hints` are never rendered (`src/profile-prompts.ts`). The
  schema-string strategy is the correct public channel, and the bridge does
  forward it: the user message is `Schema: ${input.schema}\n\n${input.prompt}`.
- **Abort/failure classification is cross-module-instance safe.**
  `classifyRouteFailure` uses shape checks (`record.name === "AbortError"`,
  `signal?.aborted`) and the validated-generate capability is duck-typed
  (`hasValidatedGenerate`), not `instanceof` — `src/llm-mesh-bridge.ts:114,142`.
  This matters given Finding 2.
- **Consumer contracts named for reuse all exist at the cited files.**
  `writeCanonicalCityGraph` (canonical-graph-writer.ts:366) with single-read
  bytes+ETag anchoring and `ifMatch` CAS preconditions; `applyGraphify34Snapshots`
  (graphify-34-snapshot.ts:247) with archive-before-write, fresh-backupId refusal
  and object-verified `resume`; `enrichGraphify34Snapshot(graph, municipality)`
  (graphify-34-enrichment.ts:112) is a pure function over an assembled graph, so
  feeding it the fresh candidate directly is valid; `upsertGraphAtomic`
  (graph-store.ts:979) parses via `graphifyGraphSchema` internally and enforces
  the completeness-regression abort.
- **The projection-skip hazard is accurately described.**
  `project-graph-from-s3.ts` counts GET/JSON/shape skips and `continue`s; exit
  code is nonzero only for aborted/errors (lines 79–120, 174) — skips exit zero.
  The design is right to forbid inferring cron success from it.
- **Cron/overlay facts check out.** Base `34-refresh-cronjob.yaml` ships two
  CronJobs suspended (scrape `17 3 * * *`, projection `30 4 * * *`,
  `concurrencyPolicy: Forbid`); the preprod overlay un-suspends BOTH via a broad
  `target: kind: CronJob` patch — C19's "narrow the broad unsuspend" is exactly
  the needed change so the retired projection cron stays suspended. `Forbid`
  indeed fences nothing against manual Jobs; the durable shared lock is required.
- **Cutover deletion arithmetic is exact.** `semantic-extract.ts` 249 lines +
  test 221 lines; the six v2.3 shell entrypoints total 1,198 lines;
  `extract-cas-semantic.sh` is absent on this base; `extractSemanticMentions` is
  wired in `sources/exploitation.ts` behind the `RADAR_LLM_EXTRACTION` master
  switch documented at `api/src/config.ts:124`; `mentions.ts` carries the stale
  semantic-provenance descriptions C21 names. `api/Dockerfile` already installs
  `poppler-utils` (line 121) as C15 assumes. `worker-live.ts` is the S3-only
  acquisition entrypoint as claimed.
- **Current dependency state matches the migration premise.** `api/package.json`
  pins `@sentropic/graphify ^0.10.0` and `@sentropic/llm-mesh ^0.1.2`; chat's
  only mesh imports are `services/chat/{mesh-runtime,backlog-tools}.ts`, so the
  isolation boundary is as narrow as the spec assumes.
