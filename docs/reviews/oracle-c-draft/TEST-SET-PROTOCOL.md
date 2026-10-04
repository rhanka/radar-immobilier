# Test-set protocol — the held-out set is never used to optimise a prompt

Owner rule (2026-10-04): the reference scores are those of the held-out test set, and **nobody who
optimises a prompt may look at the test set, directly or indirectly**. This file states what that
means, what is enforced in code, what is procedural, and what went wrong in the 2026-10-04
campaign.

Terminology: "test set" = `blind` in the scripts; "development set" = `optim`.

## 1. What went wrong in the 2026-10-04 campaign (declared, not repaired)

The current test set (`blind.jsonl`, 61 lines, sha256 `51e32d2a…`) is **contaminated** for prompt
v2. Its scores are reported as such and are not reference scores.

**1.1 Leak through a prompt rule (usage).** Rule 1 of `prompt-c-v2.md` ("the verdict follows the
four categories of Steve's analysis; residential, general scope, sense not given = Pertinent")
comes from the table of §2 of Steve's analysis, an aggregate over his 73 pass-1 lines, **37 of
which are test lines** (6 of them sit exactly in the "sens non donné" row). The prompt therefore
carries information computed on the test set.

**1.2 Exposure of the optimiser (reading, usage not provable either way).** Before writing v1 and
v2, the agent that wrote the prompts read:
- the full text of Steve's analysis, including §2 (list of the 22 lines meeting all criteria, 8 of
  them in test municipalities: Sainte-Martine, Waterloo, Plaisance, Petite-Rivière-Saint-François,
  Saint-Rémi, Mont-Saint-Hilaire, Cowansville, Deux-Montagnes) and §3 (noise families, with test
  municipalities Delson, Saint-Ours, Westmount, Varennes, Amos, Brossard, Drummondville, Chambly,
  Richelieu, Waterloo);
- the decision dossier, whose tables aggregate all 124 lines (verdict by pass, sense by verdict,
  motif counts);
- during data exploration: two full Triage rows of a test municipality (Sainte-Martine, with
  Steve's verdict, motif and analysis) and the object text of a few other test lines;
- the plaintext `blind.jsonl` sat in the optimiser's workspace from 21:07Z until it was sealed.

**1.3 Audit of every v2 rule against the owner's criterion** ("allowed sources: Steve's stated
general criteria, his code legend, or optim lines; anything from the analysis' aggregated parts is
suspect"):

| v2 rule | Source as written | Verdict |
|---|---|---|
| 1. Verdict = Steve's four categories (general scope + sense not given → Pertinent) | Analysis §2 table (aggregate incl. 37 test lines) | **Leak — forbidden source** |
| 2. Early stage never a downgrade | optim errors (several avis de motion called S) + Steve's working view (Précoce filter); formulated inside the frame of rule 1 | **Suspect** (depends on rule 1's frame); also contradicts the legend code S-PLANIFIE |
| 3. Numbered procedural act ≠ agenda-only item | optim errors + legend N-ODJ-SEUL; the agenda-only lines quoted in analysis §3 are optim lines | Allowed by source; exposure 1.2 applies |
| 4. CPTAQ exclusion (municipal) vs authorisation (named lots) | criterion 1 ("sauf dézonage CPTAQ") + legend P-PERIM-URB + optim errors; the CPTAQ examples of analysis §2 are optim lines | Allowed by source; **overfit risk** (flips one optim line, contradicts the legend's "un seul lot", review M1) |
| 5. Accessory subdivision bylaw → N-ACCESSOIRE | legend N-ACCESSOIRE + optim errors | Allowed |
| 6. Doubtful vocation stays visible | asymmetry reserve stated in analysis §5 (general criterion) + optim errors | Allowed |
| v1 base (3 criteria, 5 exclusions, asymmetry reserve, 28 codes) | analysis §1 and §5 general statements + code legend | Allowed |

Mitigation, not proof: the test scores recomputed without the 6 lines of the "sens non donné" row
are given next to the contaminated scores (`results.md`). They cannot remove exposure 1.2.

## 2. Enforced in code (from now on)

Implemented in `scripts/lib/testset.mjs`, used by `05-run.mjs`, `06-score.mjs`,
`08-filter-metrics.mjs`; checked by `scripts/selftest.mjs`.

| Guarantee | Mechanism | Status |
|---|---|---|
| (a) Test set sealed | `09-seal-test.mjs` encrypts the test set (AES-256-GCM) to a path **outside the repository** with a key file **outside the repository** (mode 600), verifies the round trip against `SHA256SUMS`, deletes the plaintext. Only the sha256 is visible in the repo. `selftest.mjs` fails if a plaintext `blind.jsonl` sits in the workspace. | **Done** — current test set sealed on 2026-10-04 (retroactive, see §4) |
| Test set opened only by the executor | `openTestSet` requires `ORACLE_C_ROLE=test-executor`, `ORACLE_C_TEST_SEALED`, `ORACLE_C_TEST_KEY_FILE` (both outside the repo), and checks the plaintext sha256. | **Done** |
| (b) Prompt frozen before the test run | `assertTestRunAllowed`: the prompt must equal `final-prompt.json`, and both files must be **committed and unmodified** in git; the freezing commit is logged. | **Done** |
| (b) One test run per prompt version and model | refused if the audit log already holds a `test-run` for this prompt sha256 (and model), or if a run file exists; `--only` refused on test. | **Done** — verified: a re-run of v2 is refused |
| (c) Audit log | every open, seal and test run appends to `test-access-log.jsonl` (time, actor, role, action, prompt sha256, dataset sha256), committed with the results. The 2026-10-04 entries before the protocol are reconstructed from receipts and marked `retroactive`. | **Done** |
| Per-item inspection of test errors | `06-score.mjs --errors` refused on test (aggregates only). | **Done** |

## 3. Procedural (cannot be enforced inside one repository)

- **(d) Separation of roles.** Two different executors: the *optimiser* (writes prompts, sees only
  the development set) and the *test executor* (holds the key, runs the frozen prompt once on the
  test set, publishes aggregates). The optimiser never receives the key, the sealed file path or
  per-item test outputs. In practice: the key lives in the executor's own account or secret store;
  an agent session that optimises is started without `ORACLE_C_TEST_*` variables and without read
  access to the key directory.
- **(e) Clean inputs for the optimiser.** The optimiser receives only: Steve's stated general
  criteria (analysis §1, the five exclusions and the asymmetry reserve of §5), the code legend, and
  the development set. It never reads the analysis' aggregated or itemised parts (§2 tables and
  lists, §3 noise lists, §4 missed dossiers), the decision dossier's whole-set tables, nor the
  workbook itself. A redacted extract is prepared by the executor before the optimiser starts.
- **Commit order.** The set hashes and the split script are committed before the optimiser starts;
  each prompt version is committed before it is run, even on the development set; the selection
  rule is committed before the first comparison it decides.
- **Split seed.** Committed before the split, or derived from a public future value.

## 4. Status of the current test set and the next one

- The current test set (61 lines) was sealed on 2026-10-04 **after** its single v2 run, by the same
  agent that optimised the prompts, which still holds the key: for this campaign sealing is
  demonstrative, not a guarantee. Its scores stay labelled **contaminated (rule 1 + exposure)**.
- **(f) A truly virgin test set is required for reference scores**: Steve's next 52
  municipalities, triaged by Steve before any C output exists or is shown to him, sealed by the
  test executor as soon as it is extracted, with the optimiser never given access. Reference
  figures for C must come from that set (see `extension-plan.md`). The prompt used on it must be
  re-derived without rule 1 (and with rule 2 re-checked), from allowed sources only.
