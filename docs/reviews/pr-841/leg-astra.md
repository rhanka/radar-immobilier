---
status: completed
reviewer-host: codex
reviewer-model: gpt-6-astra
reviewer-effort: xhigh
target-ref: ops/bascule-restore-daily@2cbef58373e33ccfb0080937dceb66796c794b4a
round: 6
---

## Previous findings status

**ASTRA-841-R5-01 — not fixed (non-blocking).** The missing-SDK fixture at
`deploy/ci/bascule-preprod/restore-mode.selftest.mjs:445`–`:447` is unchanged.
With repository-local `TMPDIR`, the suite still resolves the ancestor SDK and
gets exit 2 (`missing S3_ENDPOINT`) instead of the expected missing-SDK exit 1.
Restore-suite validation remains **partial**; this does not demonstrate a
weakened destructive guard or a blocked legitimate scheduled restore.

## Commands and outputs

```text
$ git rev-parse HEAD origin/main
2cbef58373e33ccfb0080937dceb66796c794b4a
ab7f4e70e9b05b6637cb1eb4a6769923cfb169e6

$ git diff --stat 5cef739f..2cbef58373e33ccfb0080937dceb66796c794b4a
2 files changed, 17 insertions(+), 2 deletions(-)
```

Both unmodified selftests ran through `node .review-tmp-astra/checks.mjs`,
with `TMPDIR` inside `./.review-tmp-astra/tmp`; individual exits were recorded.

| Command | Exit | Output |
| --- | --- | --- |
| `node deploy/ci/bascule-preprod/restore-mode.selftest.mjs` | 1 | `restore-mode.selftest — 247 passed, 1 failed` |
| `node deploy/ci/bascule-preprod/bascule.selftest.mjs` | 0 | `bascule.selftest — 56 passés, 0 échoués` |

```text
FAIL node -e — main triggered, exit 1 without the SDK, verdict written (got [2,false,false])
ok   CLI dump (S1) — failed delete of the previous freshness Job ⇒ no apply, prod CronJob re-suspended, exit 1

$ node .review-tmp-astra/diagnostic.mjs
SDK: /home/antoinefa/src/radar-immobilier/node_modules/@aws-sdk/client-s3/dist-cjs/index.js
exit: 2
verdict: {"ok":false,"step":"resolve","exit":2,"reason":"missing S3_ENDPOINT"}
```

## Findings

**none** in `git diff 5cef739f..2cbef58373e33ccfb0080937dceb66796c794b4a`.

- Failed deletion still prevents apply: `bascule.mjs:879`–`:885` returns
  `{ ok: false, state: "delete-failed", uid: null }` for non-strict callers;
  strict callers still exit. S1 attempts the prod CronJob re-suspend at `:478`
  before refusing at `:482`. The new fake-kubectl assertion at
  `restore-mode.selftest.mjs:891` passes.
- Restore-mode callers also reject `!res.ok` (`restore-mode.mjs:355`, `:394`,
  `:430`, `:471`, `:480`); null UID prevents reading a previous Job's pod
  verdict (`:273`). No destructive guard is bypassed by the new return path.
- The force-refresh change only selects the log wording: active means
  `démarré`; otherwise `créé, démarrage non confirmé`
  (`bascule.mjs:1151`). Its existing refusal conditions are unchanged.

Source paths above are under `deploy/ci/bascule-preprod/`. Review stayed blind
to the other reviewer. Cluster/bucket operations and remote CI are
**unverified**; no live access was performed.

## Verdict

**GO-with-nits.** No new blocking defect demonstrated. ASTRA-841-R5-01 remains
not fixed, so the restore selftest is **partial** despite the new S1 case passing.
This is an independent leg verdict, not a consensus result or an arming action.
