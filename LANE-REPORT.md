# Lane report — hotfix/v1.2.19 (anthropic seat fallback)

- Branch: `hotfix/v1.2.19` (= `v1.2.18` + cherry-picked UI fix #958), worktree
  `/home/antoinefa/src/radar-immobilier-hotfix`. No PR (hotfix branches have no
  PR base); branch push only. No tag created by this lane; deployment is done
  by the conductor.
- Prod incident: signal detection down since 2026-10-29. Codex quota out
  until 11/11, Gemini seat rate-limited. Owner decision: Claude Opus 5.5
  medium on a Claude subscription seat as detection fallback, validated in
  `docs/reports/benchmark-v11alpha-2026-09-29.md` (F1 0.319, recall 0.311).
- Upstream: `@sentropic/llm-mesh 0.33.1` (lane `feat/llm-mesh-claude-seat-runner`
  in sentropic) adds a Node runner spawning `claude -p` (stream-json, model,
  `--effort`, seat token only in child env as `CLAUDE_CODE_OAUTH_TOKEN`), maps
  the 5-hour seat limit to `quota/rate_limited`, accepts `claude-code`
  accounts in the CLI seat import / `EncryptedFileKeyring`, and provides a
  factory building `clients.anthropic` for `createRefreshMesh`.
  Status at first poll (2026-11-09T14:01:03Z): **not yet on npm** (404);
  latest published is 0.33.0. This lane prepares everything that does not
  need 0.33.1; the bump below is the last step.

## Commits (on top of #958 merge af8aa95e)

| Commit | Subject |
| --- | --- |
| 3cf50f64 | feat(api): pin claude CLI 2.1.319 in runtime image for seat fallback |
| 5f9b42d7 | feat(refresh): accept anthropic provider for seat fallback |
| ec1a69bc | feat(refresh): accept claude-code transport in keyring import |
| 7fcc1557 | feat(refresh): target anthropic seat fallback in prod manifests |
| 5e8c9553 | ci: allow v1.2.19 hotfix promotion on allowlisted diff |
| 9db04789 | test(refresh): fix anthropic verification test primary conflation |

All commit messages are English and carry no `Co-Authored-By`,
`Claude-Session`, or "Generated with" trailer (verified with
`git log --format=%B`).

## What was prepared (pre-bump)

1. **api/Dockerfile** — runtime image installs the pinned Claude CLI
   `@anthropic-ai/claude-code@2.1.319` (exact version, no `latest`). The
   tarball is fetched from the npm registry and its SHA-512 is checked
   against the pinned integrity
   `sha512-XoyAxGXBmNsb9ahz0xLAtyz/I6b1j+4lyLpucyTQIq4FcKUxrMDM2AzA2sHipHoN1DdMJINQQrLZxRZRq7FqBA==`
   before `npm install --global`, and `claude --version` is asserted to be
   `2.1.319`. The CLI writes config under `CLAUDE_CONFIG_DIR`; the image sets
   `CLAUDE_CONFIG_DIR=/tmp/claude-config` (pre-created, owned by the non-root
   `radar` user, mode 0700) so it works with a read-only root filesystem
   (`/tmp` is the `emptyDir` scratch volume in the refresh Job).
2. **Provider validation** — `RefreshProvider` now includes `anthropic`
   (`refresh-mesh.ts`); `parseRefreshModel()` in `refresh-model-policy.ts`
   accepts `anthropic|gemini|openai` and validates effort; `refresh-pv.ts`
   `selectedModel()` delegates to it. Prod target:
   `REFRESH_FALLBACK_PROVIDER=anthropic`,
   `REFRESH_FALLBACK_MODEL=claude-opus-5-5`,
   `REFRESH_FALLBACK_REASONING_EFFORT=medium`, set in
   `deploy/k8s/34-refresh-cronjob.yaml` and pinned by the `verify-renders`
   contract in `refresh-018.mk`.
3. **Verification decision — DISABLE gemini verification for anthropic
   fallback outputs, KEEP it for primary extractions.** Fallback outputs
   already report `verification: skipped-fallback` and `verify()` returns
   the extraction unchanged once a document fell back; `shouldVerifyRefreshOutput()`
   makes that explicit for anthropic. Rationale: do not burn the
   rate-limited gemini seat on outputs it was not calibrated for, and do not
   apply the gemini removal-only verifier (tuned on gemini/openai
   distributions) to Opus 5.5 seat outputs whose benchmark error profile
   differs. `REFRESH_VERIFY_*` stays `gemini/gemini-3.8-flash/low`,
   `REFRESH_VERIFY_ENABLED=1`, for primary (openai) extractions only.
4. **Keyring import** — `refresh-018.mk import-keyring-account` accepts
   `IMPORT_TRANSPORT=codex|claude-code` (default `codex`, substituted into
   the rendered Job as `__IMPORT_TRANSPORT__`); the import script
   (`enroll-codex-import.mjs`) filters on the selected transport and checks
   the target provider (`codex`→`openai`, `claude-code`→`anthropic`),
   expecting exactly one matching account.
5. **Promote guard** — `build-push-images.yml` gains a `v1.2.19` exception
   modelled on v1.2.16–v1.2.18: requires `v1.2.18` ancestry and a diff
   restricted to an explicit allowlist (the 3 #958 UI files plus every file
   this hotfix touches, including `api/package.json` and `package-lock.json`
   for the bump, and this report). Verified locally: the allowlist remainder
   for `v1.2.18..HEAD` is empty and `v1.2.18` is an ancestor of HEAD.

## Image-build path for hotfix tags (v1.2.19)

`build-push` is skipped on tag refs (`if: github.ref_type != 'tag'`), so a
hotfix tag never rebuilds there. The `promote-prod` job (tag refs only)
first resolves the immutable digests of `radar-api:<sha7>` and
`radar-ui:<sha7>` already built on `main`. A hotfix commit was never built
on `main`, so resolution misses and the job's **fallback build-at-tag**
rebuilds both images from the tagged commit (`docker buildx build --push`
with `GIT_SHA=<sha7>`) and re-resolves the digests, which are then promoted
to prod by digest. A `workflow_dispatch` on the hotfix branch also runs
`build-push` (branch ref, not a tag) and pushes `:<sha7>` images, but the
tag promotion path does not depend on it.

## Exact bump + wiring diff (apply once 0.33.1 is on npm — LAST STEP)

Do not apply before `npm view @sentropic/llm-mesh@0.33.1 version` succeeds.
Confirm the published package's exports against this diff first
(`ClaudeCodeRuntimeClient`, the Node `claude -p` runner, and the
`clients.anthropic` factory are the expected 0.33.1 surface per the
upstream lane brief); if a symbol name differs in the published `.d.ts`,
adapt the import to the published name and note it here.

```diff
# api/package.json
-    "@sentropic/llm-mesh": "0.19.2",
-    "@sentropic/llm-mesh-refresh": "npm:@sentropic/llm-mesh@0.19.2",
+    "@sentropic/llm-mesh": "0.33.1",
+    "@sentropic/llm-mesh-refresh": "npm:@sentropic/llm-mesh@0.33.1",
# then regenerate the root lockfile (npm install) so package-lock.json
# records 0.33.1 with its registry integrity; commit both files.
```

```diff
# api/src/services/graph/refresh-mesh.ts — wire the anthropic adapter
# (imports/names to be confirmed against the published 0.33.1 .d.ts):
 import {
   CloudCodeRuntimeClient,
+  ClaudeCodeRuntimeClient, // 0.33.1: seat runner client (claude -p)
   CodexRuntimeClient,
   DEFAULT_ROUTE_POLICY,
+  AnthropicAdapter,
   GeminiAdapter,
   ...
+  type AnthropicAdapterClient,
 } from "@sentropic/llm-mesh-refresh";
 // RefreshMeshOptions gains an optional anthropic client override for tests:
+  readonly anthropicClient?: AnthropicAdapterClient;
 // In createRefreshMesh, add the anthropic adapter beside gemini/openai.
 // The factory builds clients.anthropic from the facade/keyring so the seat
 // token reaches the child only as CLAUDE_CODE_OAUTH_TOKEN (never argv/logs):
     adapters: {
       gemini: ...,
       openai: ...,
+      anthropic: new AnthropicAdapter({
+        client: options.anthropicClient ?? <factory clients.anthropic>,
+      }),
     },
```

After the bump: run `make test-api SCOPE=src/services/graph/refresh-model-policy.test.ts`,
`SCOPE=src/services/graph/refresh-mesh.test.ts`, the api typecheck, and
`verify-renders`; add a `refresh-mesh` test that builds the mesh with
`provider: "anthropic", model: "claude-opus-5-5"` using a fake anthropic
client. The Dockerfile already ships the `claude` binary the runner spawns;
no further image change is expected.

## Tests run (pre-bump)

- `make test-api SCOPE=src/services/graph/refresh-model-policy.test.ts ENV=test-hotfix-v1219`
  — 32 passed (includes the 4 new anthropic tests: parse
  `anthropic/claude-opus-5-5/medium`, refusal of unknown provider/effort,
  `shouldVerifyRefreshOutput`, anthropic fallback with skipped verification).
  First run failed once on a test-only conflation (primary and verification
  both `gemini-3.8-flash`); root cause evidenced and fixed in 9db04789.
- `make test-api SCOPE=src/services/graph/refresh-mesh.test.ts ENV=test-hotfix-v1219`
  — 13 passed.
- Api typecheck (`tsc --noEmit -p tsconfig.json` in the test compose
  project) — clean.
- `bash deploy/k8s/refresh-cronjobs/verify-renders.test.sh` — 52 passed.
- Promote-guard allowlist self-check (see above) — empty remainder.

## Open questions / conductor actions

- **Seat enrollment**: a `claude-code` account must be enrolled into the
  refresh keyring (`IMPORT_TRANSPORT=claude-code` import path is ready);
  enrollment itself is an owner/conductor act — not done by this lane.
- **Published 0.33.1 surface**: confirm the runner/factory symbol names in
  the published package before applying the wiring diff above.
- **Arming**: prod refresh stays gated by `REFRESH_CRONJOB_PROD_ENABLED`;
  arming after promotion is a conductor/owner act. No `kubectl` was run
  against prod by this lane; no tag was pushed.

## Polling log (@sentropic/llm-mesh@0.33.1)

- 2026-11-09T14:01:03Z — 404 (not published; latest 0.33.0).
- 2026-11-09T14:06:43Z — 404.
- 2026-11-09T14:12:45Z — 404 (latest still 0.33.0).

**Blocker / pending (not a failure of this lane):** 0.33.1 is not yet on
npm (ETA ~12:00–12:30 Montréal ≈ 17:00–17:30 UTC), so the bump diff above
was **not** applied — pinning an unpublished version would break
`npm ci` and the test run. Everything else in this report is done, pushed,
and green. Next step for whoever picks this up after publication: apply
the exact diff above, regenerate the lockfile, run the refresh tests and
typecheck listed there, commit as
`chore(deps): bump llm-mesh to 0.33.1 for anthropic seat fallback`, push
`hotfix/v1.2.19`, and extend this log with the result.
