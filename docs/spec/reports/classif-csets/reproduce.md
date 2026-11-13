# Reproduction and blind handoff

Run only in `tmp/classif-1passe-csets`, branch `feat/classif-1passe-csets`.
Every target below uses the standalone Make entry point. It loads no environment
file. `CLASSIF_HOME` defaults to this lane's private directory.

Initial preparation:

```sh
make -f tools/classif/csets.mk csets-deps ENV=test-csets
make -f tools/classif/csets.mk csets-capture ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/quota.mjs ENV=test-csets
```

The captured composition is imported from the PR #1099 worktree. Its source
hashes are in `manifest.json`. This is a read-only import, not a prompt fork.
For tuning, run `run.mjs tuning`, `validation-prep.mjs tuning`, the
`csets-validate` target, `score.mjs tuning`, then `report.mjs`, each through
`csets-script SCRIPT=tools/classif/csets/<file> ARGS=tuning` when applicable.

Blind execution requires an already injected `CLASSIF_BLIND_KEY` and the
executor role. Neither is available in this session. Do not obtain the key from
an environment file. Do not use the plaintext reference-d file as a blind bypass.
Responsible dependency owner: i-cond.
Acceptance: 252 blind units evaluated in each mode, encrypted per-unit caches,
native validation and exact-request checks, aggregate metrics only published.

With the key injected by the conductor:

```sh
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/quota.mjs ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/inventory.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/run.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/validation-prep.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
make -f tools/classif/csets.mk csets-validate HALF=blind ENV=test-csets
make -f tools/classif/csets.mk csets-script SCRIPT=tools/classif/csets/score.mjs ARGS=blind CLASSIF_ROLE=test-executor ENV=test-csets
```

Then replace the pending blind rows in the report using the resulting
`blind-aggregates.json`. The current `report.mjs` intentionally publishes the
completed tuning stage and a pending blind stage; it must be extended for the
final two-set report. No per-unit blind data may enter that extension.

Verification:

```sh
make -f tools/classif/csets.mk csets-test ENV=test-csets
make -f tools/classif/classif.mk classif-check ENV=test-csets
```

The four synthetic tests cover strict missing predictions, Wilson bounds,
annotation consistency, and flat versus nested native stages. Pairing imports
bench-v11's `pairOneToOne`; source-site and stage rules are fixed by the protocol.
An additional stage-tolerant diagnostic follows bench-v11 R5. It is not the
primary metric and does not recover a primary miss.
