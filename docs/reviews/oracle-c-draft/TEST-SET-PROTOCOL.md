# Test-set protocol — the held-out set is never used to optimise a prompt

Owner rule (2026-10-04): reference scores are those of the held-out test set, and **nobody who
writes or tunes a prompt may look at the test set, directly or indirectly**. This file states what
is enforced in code, what is procedural, and the status of the current test set.

Terminology: "test set" = `blind` in the scripts; "development set" = `optim`.

## 1. Status of the current test set

- 61 lines, 25 municipalities, plaintext sha256
  `51e32d2a3f30b1373555c213fac2a40411322d85601dacc2e855464f639c1e2c` (unchanged since the split
  of 2026-10-04). Kept as the test set by owner decision.
- Sealed: encrypted copy at `<scratchpad>/oracle-c-sealed/blind-v1.sealed` (sealed-file sha256
  `7b26ec69880d465a355187b1340593a62d043da4b8f5bc7cedf9ba328930adb0`), outside the repository and
  outside the author sandbox; key outside both (`~/.config/radar-oracle-c/test.key`, mode 600). No
  plaintext copy remains in the workspace.
- **Exposure on record.** The preparer / executor of this folder created the split and has read
  material covering the test lines (the workbook, Steve's full analysis with its itemised lists, the
  decision dossier's whole-set tables). It therefore **does not write prompts**. Prompts written
  before this protocol were discarded. The test set itself was already opened for one earlier model
  run (entries `retroactive` in `test-access-log.jsonl`); a new author has not seen it.

## 2. Enforced in code

Implemented in `scripts/lib/testset.mjs`, used by `05-run.mjs`, `06-score.mjs`,
`08-filter-metrics.mjs`; checked by `scripts/selftest.mjs`.

| Guarantee | Mechanism |
|---|---|
| (a) Test set sealed | `09-seal-test.mjs` encrypts the set (AES-256-GCM) to a path outside the repository with a key outside the repository, checks the round trip against `SHA256SUMS`, deletes the plaintext. `selftest.mjs` fails if a plaintext `blind.jsonl` sits in the workspace. |
| Opened only by the executor | `openTestSet` requires `ORACLE_C_ROLE=test-executor`, `ORACLE_C_TEST_SEALED`, `ORACLE_C_TEST_KEY_FILE` (both outside the repository) and checks the plaintext sha256. |
| (b) Prompt frozen before the test run | `assertTestRunAllowed` refuses unless `final-prompt.json` exists, names this prompt version and sha256, and both `final-prompt.json` and `prompt-c-<version>.md` are **committed and unmodified** in git. The freezing commit is logged. |
| (b) One test run per prompt | refused if the audit log already holds a `test-run` with the same prompt sha256 (and model), or if a run file exists; `--only` refused on the test set. |
| (c) Audit log | every seal, move, open and test run appends to `test-access-log.jsonl` (time, actor, role, action, prompt sha256, dataset sha256); committed with the results. |
| No per-item test inspection | `06-score.mjs --errors` refused on the test set (aggregates only). |
| Transparent verdict | when the answer carries the tag schema, the scored verdict is the one recomputed by `lib/derive-verdict.mjs` (rules R1-R7); stated verdict and motif family are checked for coherence. |

## 3. Procedural

- **(d) Separation of roles.** The *author* writes prompts and sees only the author sandbox; the
  *test executor* holds the key, runs a frozen prompt once on the test set and publishes
  aggregates. The author never receives the key, the sealed file, per-item test outputs, this
  branch or PR #821 (they contain test-set aggregates).
- **(e) Clean inputs.** The author sandbox (`<scratchpad>/oracle-c-author-sandbox/`, local, not
  versioned) contains only: `criteres-steve.md` (three criteria, exclusions, asymmetry reserve, in
  general quotes, no statistic, no line example), `categories.md` (28 motif codes and definitions,
  no count), `optim.jsonl` (60 development lines: model input + Steve's verdict, motif, sense,
  pass), `schema-sortie.md` (tag schema and the R1-R7 rule), `MANIFEST.md` (sha256 and access
  rule). Forbidden: test lines, aggregates or examples of Steve's analysis, the dossier, earlier
  model outputs.
- **Commit order.** Each prompt version is committed before it runs, even on the development set;
  `final-prompt.json` is committed before the single test run.
- **Split seed** for any future split: committed beforehand or derived from a public future value.

## 4. A virgin test set for reference figures

The current set is kept by owner decision, with its exposure on record (§1). A truly virgin test
set — Steve's next 52 municipalities, triaged before any C output exists or is shown to him, sealed
by the executor at extraction — remains the target for reference figures (`extension-plan.md`).
