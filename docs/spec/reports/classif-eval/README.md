# Classification pilot evaluation set (sealed)

Steve's non-ambiguous rows (survey of 2026-09-21): Triage 124 rows, minus #14, #55, #58 (no
resolvable radar node) = 121 retained, minus the 8 rows not evaluated in the final pass of the gap
analysis (#18, #27, #77, #82, #93, #104, #112, #119) = **113 rows**. Rows shaped
R′ and guides v2/v3, and the annotator families are evaluated families: every result on this set
carries the flag `pilot-exposed`. The repository is public, so the content is committed
**encrypted only**, with the mechanism of reference-c (PR #831/#843).

Sealed on 2026-10-31T08:57:07.226Z from reference-c (xlsx plaintext `4a81b4d744a8dd76f768f401cc9d2b3b675abb65159f651b4d4b6ef585956afb`, csv plaintext `f47ec61f0c14ad38e844732871ad5edaf0e1cc9bbda7e70b334ed91770703d07`).

## Files

| Sealed file | Content | SHA-256 of plaintext |
|---|---|---|
| `eval-inputs.jsonl.sealed` | One JSON line per row: evalId, line #, city slug, node ids, frozen model input (what the radar serves), input sha256 | `07cc1eab3079c0af117c6b764c78b5443fb10c2f12605b8f2afad68bf57221c3` |
| `eval-expected.jsonl.sealed` | One JSON line per row: evalId, line #, Steve verdict, Steve reason code, observed pass | `6e23bb3b593655714b4c39bc24bb3b372fb721817d1db0165489f4cdd5f9f2a3` |

Counts: 113 rows, 113 with a rendered input, 0 without any node found
in the graph (kept, input null, scored as `execution-failure` or excluded per Annex M).

## Key

- Variable `CLASSIF_EVAL_KEY` (base64, 32 bytes), generated and held by the conductor, stored in the
  repo-root `.env` (git-ignored) and injected at launch. Agents never read `.env`.
- Without the key the files are unreadable. Only the test executor role opens them
  (`tools/classif/guard/evalset.mjs`: role, key, plaintext sha256, one run per prompt/model/effort, access log).

## Format and checks

`REFC1` | IV (12 bytes) | GCM tag (16 bytes) | AES-256-GCM ciphertext. Each sealed file was read back,
unsealed and compared byte for byte with its plaintext before this README was written. No plaintext
is kept on disk. Access log: `access-log.jsonl` (append-only).
