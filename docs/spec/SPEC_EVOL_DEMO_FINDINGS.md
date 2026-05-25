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
| A1b | Claude Opus | claude-opus-4-7 | **max** | `claude -p` | WebSearch+WebFetch | `prompt.txt` | 1 | ❌ CONTAMINATED — read sibling outputs ("les trois agents…") | `tmp/analyst-run-valleyfield/opus-max.md` |
| C1 | Codex | gpt-5.5 | **xhigh** | `codex exec -C scratch` | bypass-sandbox (net) | `prompt.txt` | 1 | ❌ CONTAMINATED — grepped `opus.md`/`gemini.md` | `tmp/analyst-run-valleyfield/gpt.md` |
| G1 | Gemini | Gemini 3.5 Flash | **high** | `agy` + tmux driver | skip-permissions | `prompt.txt` | 1 | ⚠️ suspect — sibling files present in cwd | `tmp/analyst-run-valleyfield/gemini.md` |

### ⚠️ Integrity incident (2026-05-25) — disclosed per §2

All CLI tracks ran with their working directory set to the **shared scratch dir**,
which already contained the other agents' output files. A1b (opus max) and C1
(codex) **read sibling outputs** (A1b explicitly: "Les trois agents ont rapporté…";
C1 grepped `opus.md`/`gemini.md`). This is a hidden-advantage / non-independent
breach of §2 — the runs are **not comparable** to the human's solo work and MUST NOT
be scored as-is. Honest call: opus-max's superior "reconciliation" came from reading
the others, not from solo capability.

**Correction — isolated re-runs (canonical iteration 1):** each agent re-runs in a
per-agent directory containing **only `prompt.txt`** (no sibling outputs), same
prompt, same fixed mode. Web access allowed (the human had it); cross-agent file
access forbidden.

| Run | Track | Model | Mode | Isolation | Status | Output |
| --- | ----- | ----- | ---- | --------- | ------ | ------ |
| A2 | Claude Opus | claude-opus-4-7 | **max** | `iso-vf-opus/` (only prompt.txt) | done — 34/35 | `iso-vf-opus/report.md` |
| C2 | Codex | gpt-5.5 | **xhigh** | `iso-vf-codex2/` (PTY/tmux, no premature kill) | done — 31/35 | `iso-vf-codex2/report.md` |
| G2 | Gemini | Gemini 3.5 Flash | **high** | `iso-vf-gemini/` (only prompt.txt) | done — 14/35 | `iso-vf-gemini/report.md` |

> C2 note: the first isolated codex attempt was **killed prematurely by the
> conductor** (mistaken for a hang); re-run in a tmux PTY with no premature kill,
> it completed in ~31 min with a clean, fabrication-free report.

Clean tracks kept: **H1** (human, solo by construction) and **A1** (opus default,
ran first when scratch held only `prompt.txt`) as a default-mode reference.
Canonical scored set = H1, A2, C2, G2.

## 9. Status

- 2026-05-25: iteration-1 isolated re-runs complete and scored by independent
  agents. **A2** (opus max) 34, **C2** (codex xhigh, PTY re-run) 31, **H1** (human)
  30, **G2** (gemini) 14. Two automated agents beat the human, no fabrication; G2
  fabricated. Verified findings wired into the demo UI (`§6`). C2's first attempt
  was killed prematurely by the conductor, not a credits/tool failure — re-run in a
  tmux PTY succeeded. Reference R3 corrected per the C2 audit.

## 10. Results — independent scoring (iteration 1)

Scored by an independent neutral agent against a verified reference set; full
report in `docs/spec/SPEC_EVOL_DEMO_FINDINGS_SCORING.md`.

| Track | Mode | M1 | M2 | M3 | M4 | M5 | M6 | M7 | **/35** |
| ----- | ---- | -- | -- | -- | -- | -- | -- | -- | ------- |
| **A2** Claude Opus | max, web-only, isolated | 5 | 5 | 5 | 5 | 4 | 5 | 5 | **34** 🥇 |
| **C2** Codex GPT-5.5 | xhigh, isolated (PTY re-run) | 3 | 5 | 5 | 5 | 5 | 4 | 4 | **31** 🥈 |
| **H1** Human/ChatGPT GPT-5.5 | manual | 5 | 5 | 4 | 5 | 3 | 4 | 4 | **30** 🥉 |
| **G2** Gemini 3.5 Flash | high, isolated | 2 | 2 | 2 | 1 | 4 | 2 | 2 | **14** |

Full per-metric detail: `SPEC_EVOL_DEMO_FINDINGS_SCORING.md` (H1/A2/G2) +
`SPEC_EVOL_DEMO_FINDINGS_SCORING_C2.md` (C2).

**Verdict (honest):** **two automated agents beat the human baseline with zero
fabrication** — A2 (34) and C2 (31) vs H1 (30). A2 wins on breadth + traceability +
completeness + VISION weighting. C2 is narrower (misses PPCMOI/CPTAQ/Plan 450 → M1=3)
but uniquely reaches **verified lot-level data** (real cadastral attributes parsed
from the open-data role `RL70052_2026.xml`, donneesouvertes.affmunqc.net — NOT the
Cloudflare-blocked online role). On the regulatory core (M2/M4) A2, C2 and H1 are
tied at the top. This is **not** a blanket "AI beats human": G2 fabricated and ranks
last; the wins are A2/C2-specific, and H1 lost partly because its transcript was
truncated at Phase 3.

**Reference correction (C2 was right, ref was incomplete):** per the C2 audit, update
R3 — the 150-49/150-50 consultation was postponed to **23 Mar 2026** (2nd project
**24 Mar 2026**); and **U-521→H-521** is a confirmed rename. The reference set, not
C2, is corrected. (No track is penalized for being more accurate than the draft ref.)

**New verified opportunity (from C2, reproducible):** lot-level data IS obtainable
via the **open-data role XML** (bypasses the Cloudflare block) — a concrete next
step to enrich the demo with real lots, with lot↔zone polygon membership still to be
confirmed via SIG (C2 honestly flagged it as hypothesis).

**Fabrication audit:** H1 none · A2 none · **G2 multiple** (non-existent PPCMOI
2024-0145, uncorroborable lot/resolution numbers + a $1.35 M price, a location
misattribution, "risque nul" asserted as fact) → **G2 disqualified for the demo.**

**Demo input:** only the verified reference set (R1-R11 in the scoring report) and
the non-fabricated findings of **A2 + H1** may be wired into the demo UI (§6).
