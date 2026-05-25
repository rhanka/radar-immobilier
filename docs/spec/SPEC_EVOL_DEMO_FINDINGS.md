# SPEC_EVOL — Demo findings & fair multi-agent benchmark

> **Status**: EVOL, opened for `feat/demo-findings-valleyfield`.
> **Inputs**: `docs/spec/input/{VISION,PROMPT,PROCESS}.md`, the four analyst tracks.
> **Initial date**: 2026-05-25

## 1. Goal

Run `docs/spec/input/PROMPT.md` on Salaberry-de-Valleyfield with several analyst
tracks, then demonstrate — **fairly and without cheating** — that our orchestrated
agents can match or beat a human-with-ChatGPT baseline on metrics that matter for
the VISION, and wire the validated findings into the demo UI.

## 2. STRICT INTENTION — No cheating vs the human (ABSOLUTE)

This is an absolute, non-negotiable rule for this benchmark and any future one:

- The comparison between the **human baseline** (manual ChatGPT session) and **our
  agents** MUST be neutral. We never rig it to make our agents look better.
- **Success metrics are defined and frozen BEFORE scoring any output** (see §5),
  and applied **identically** to every track, the human's included.
- **No fabrication**: a finding only counts if it is backed by a verifiable public
  source (exact link). Inventing a bylaw, zone, date, or lot is an automatic fail
  for that finding (mirrors `PROMPT.md`: "Ne rien inventer").
- **No hidden advantage**: every track works from the same prompt, the same
  municipality, and access constraints that are disclosed. We do not feed our
  agents data the human could not have obtained, unless that path is disclosed and
  reproducible.
- **No metric gaming / no cherry-picking**: we do not tune metrics post-hoc, nor
  select only the cases where our agents win.
- **Independent framing**: the iteration-2 value-add (see §4) is scoped by an
  **independent agent** from iteration-1 discoveries — not hand-tuned by the
  conductor to win.
- **Honest reporting**: if the human baseline is better on a metric, we say so.
  "We do better" is a claim that must be proven by the frozen metrics + sources.
- **Same initial prompt within iteration 1**: every iteration-1 run (including
  re-runs) uses the **same initial prompt** (`docs/spec/input/PROMPT.md`). The only
  controlled variable in iteration 1 is the **execution mode** (model + reasoning
  mode + tooling), never the prompt wording.
- **Full execution-mode traceability**: every run is logged in the execution-mode
  ledger (§8) — model, reasoning mode, CLI/tooling, web access, prompt version,
  iteration, timestamp, output. An experiment that is not traceable does not count.

> Cross-reference: this is promoted to a global rule in `rules/MASTER.md`
> (Fair Benchmarking — No Cheating vs Human).

## 3. Tracks — Iteration 1 (as-is runs)

| Track | Operator | Tooling | Type |
| ----- | -------- | ------- | ---- |
| Human/ChatGPT GPT-5.5 | **human (manual)** | ChatGPT web | manual baseline (`docs/spec/input/PROMPT_RESULT_GPT5.5.md`) |
| Claude Opus 4.7 | agent | `claude` CLI | automated 0-shot |
| Codex GPT-5.5 xhigh | agent | `codex` CLI | automated 0-shot |
| Gemini 3.5 high | agent | `agy` + tmux driver | automated 0-shot |

Iteration 1 captures each track's natural output with no special help.

## 4. Iteration 2 — value-add 0-shot (framed by an independent agent)

After iteration 1, a **second session** may add a value-added 0-shot. To keep the
comparison neutral and avoid cheating:

- An **independent agent** reads the iteration-1 outputs and the frozen metrics and
  writes the iteration-2 brief (what gap to close, what to verify), **without**
  the conductor steering it toward a predetermined "win".
- The value-add 0-shot is then run and scored by the **same** metrics as iteration 1.
- Any improvement must be **reproducible** and **source-backed**; otherwise it does
  not count.
- We thus have two iterations — one manual (human) and our framed second pass —
  comparable on equal footing.

## 5. Success metrics (frozen, VISION-aligned)

Applied identically to every track. Each is objective and re-checkable against
public sources.

| # | Metric | Definition | VISION anchor |
| - | ------ | ---------- | ------------- |
| M1 | **Densification-signal coverage** | # of relevant densification signals found (zoning change, density/height increase, conversion to residential, PPCMOI, CPTAQ, relevant dérogations) vs the shared reference set | VISION §3, §6 (densification priorities) |
| M2 | **Regulatory precision** | % of cited bylaws/zones with exact number + date + verifiable nature | PROMPT Phase 1 ("Numéro du règlement, Date, Zones, Nature") |
| M3 | **Source traceability** | % of factual claims with an exact source link | PROMPT rules ("Citer chaque source (lien exact)") |
| M4 | **Factual honesty** | facts vs hypotheses correctly separated; "Information non disponible" used instead of inventing; fabrication penalised hard | PROMPT rules ("Ne rien inventer", "distinguer faits vérifiés et hypothèses") |
| M5 | **Actionable specificity** | granularity reached: sector → zone → street → lot; # of qualified, localised opportunities | PROMPT Phases 2-5; VISION dashboard goal |
| M6 | **False-positive control** | ability to drop noise (minor dérogations: sheds, fences) and flag non-residential | VISION §6 (dérogations to filter), PROCESS scoring |
| M7 | **VISION-weighted prioritisation** | ranking consistent with VISION weights (zoning 10 > CPTAQ 8 > PPCMOI 7 > minor dérogations) | VISION §6 priorities |

**Shared reference set** (for M1/M2): the union of verifiable findings across all
tracks, each confirmed against an official source, compiled by an **independent
agent** (not by the conductor). Unverifiable claims are excluded from the reference.

## 6. Demo wiring

Only findings that pass M3 (sourced) and M4 (not fabricated) are wired into the
demo UI ("Radar demo", `http://localhost:5301`), each with its source link and a
fact/hypothesis tag. The demo illustrates real Valleyfield results, never invented
ones.

## 8. Execution-mode ledger (every run traced)

Per-agent reasoning mode is fixed for this benchmark: **Opus = max**,
**GPT-5.5 = xhigh**, **Gemini = high**. The prompt is identical across iteration-1
runs (§2). Each run MUST appear here before its output is scored.

| Run | Track | Model | Mode | Tooling | Web access | Prompt | Iter | Status | Output |
| --- | ----- | ----- | ---- | ------- | ---------- | ------ | ---- | ------ | ------ |
| H1 | Human/ChatGPT | GPT-5.5 | web (manual) | ChatGPT web | yes | PROMPT.md (phased, manual) | 1 (manual) | done | `docs/spec/input/PROMPT_RESULT_GPT5.5.md` |
| A1 | Claude Opus | claude-opus-4-7 | **default** ⚠️ | `claude -p` | WebSearch+WebFetch | `prompt.txt` (= PROMPT.md + wrapper) | 1 | done — **must re-run in `max`** | `tmp/analyst-run-valleyfield/opus.md` |
| A1b | Claude Opus | claude-opus-4-7 | **max** | `claude -p` | WebSearch+WebFetch | `prompt.txt` | 1 | pending re-run | `tmp/analyst-run-valleyfield/opus-max.md` |
| C1 | Codex | gpt-5.5 | **xhigh** | `codex exec` | bypass-sandbox (net) | `prompt.txt` | 1 | scheduled 10:50 | `tmp/analyst-run-valleyfield/gpt.md` |
| G1 | Gemini | Gemini 3.5 Flash | **high** | `agy` + tmux driver (3 nudges) | skip-permissions | `prompt.txt` (read by agy) | 1 | done | `tmp/analyst-run-valleyfield/gemini.md` |

Iteration-2 runs (independent-agent framed value-add) will be appended here with
`Iter = 2`, same column discipline. Mode names map to: Opus `max` thinking budget,
GPT-5.5 `xhigh` reasoning effort, Gemini `high` thinking.

> ⚠️ Run A1 used Opus default mode; per the execution-mode spec it is re-run as
> A1b in `max` before scoring, with the **same prompt**.

## 9. Status

- 2026-05-25: tracks launched (opus A1 done in default mode → A1b max re-run
  pending; GPT-5.5 ChatGPT scraped H1; codex C1 relaunch 10:50; gemini G1 via
  agy+tmux completed — output to verify). Metrics (§5) frozen before scoring.
