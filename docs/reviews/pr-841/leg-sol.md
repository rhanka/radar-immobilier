---
status: completed
reviewer-host: codex
reviewer-model: gpt-6.1-sol
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@2cbef58373e33ccfb0080937dceb66796c794b4a
round: 6
---

## Previous findings status

| My round-5 finding | Status | Evidence |
| --- | --- | --- |
| SOL-841-R5-01 — delete refusal bypasses S1 re-suspend | **fixed** | `deploy/ci/bascule-preprod/bascule.mjs:882` returns `{ok:false,state:"delete-failed",jobName,uid:null}` before apply. S1 re-suspends at `:478`, then fails at `:482`. Repository assertion at `restore-mode.selftest.mjs:891` passes. Independent exit-1 and SIGTERM delete cases both yield CLI exit 1, zero applies and suspend patches `[false,true]`; strict migrate controls still exit 1 with zero applies. |
| SOL-841-R5-02 — pending force-refresh claims a confirmed start | **fixed** | `deploy/ci/bascule-preprod/bascule.mjs:1151`–`:1152` says `créé, démarrage non confirmé` unless state is active. Independent pending `{}` case exits 0 with that message and no started claim; active/succeeded controls retain their messages, failed/unreadable controls exit 1. This also resolves the remaining R4-07 reporting residual. |

## Commands and outputs

Independent leg; no other reviewer was consulted. Review scope: `5cef739f..2cbef58373e33ccfb0080937dceb66796c794b4a` only. Tests used `TMPDIR=$PWD/.review-tmp-sol/tmp` to contain temporary writes.

| Command | Exit and output |
| --- | --- |
| `git rev-parse HEAD origin/main` | 0: `2cbef58373e33ccfb0080937dceb66796c794b4a`; `ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6`. |
| `git diff 5cef739f..2cbef58373e33ccfb0080937dceb66796c794b4a -- deploy/ci/bascule-preprod`; same range `--stat` | 0: only `bascule.mjs` and `restore-mode.selftest.mjs`; 17 insertions, 2 deletions. |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0: `bascule.selftest — 56 passés, 0 échoués`. |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1: `restore-mode.selftest — 247 passed, 1 failed`; sole failure: `node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])`. New S1 assertion passes. |
| `node .review-tmp-sol/confirm.mjs` | 0: unchanged restore suite with isolated no-SDK fixture: `248 passed, 0 failed`; nine independent fake CLI cases pass, as described above. |
| `git diff --check`; `git diff --name-only` | 0, empty: no tracked-file changes. |

The restore failure repeats round 5: its `node -e` child resolves the ancestor-installed SDK at `/home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js`, contradicting the no-SDK fixture at `restore-mode.selftest.mjs:445`–`:447`. The rerun uses a local MODULE_NOT_FOUND shadow under the throwaway directory; no suite or installed dependency is edited. Both outcomes are retained. Temporary files were removed; only this requested leg was written.

## Findings

None. No new defect weakening a guard before a destructive step or blocking a legitimate scheduled restore was demonstrated.

## Verdict

**GO** for this incremental offline review. Both round-5 findings are fixed. The owner-selected daily 04:00 UTC schedule is unchanged by this commit. Remote CI, live arming/RBAC and operational timing remain **unverified**.
