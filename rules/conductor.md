---
description: "Conductor orchestration, fixed UAT ports, multi-agent lane registry, conductor-report"
alwaysApply: false
paths: ["plan/**", "PLAN.md", ".agents/**"]
globs: ["plan/**", ".agents/**"]
tags: [orchestration]
---

# CONDUCTOR

## Role
- The **conductor** owns `PLAN.md`, schedules branches, dispatches work, and
  integrates results. It may be the long-lived in-session agent.
- The conductor MAY implement directly on the single active branch, OR delegate
  bounded lots to lane agents (see Multi-agent lanes). It MUST NOT touch the
  root UAT environment except to present UAT (see Fixed UAT below).
- Source of truth for global constraints stays `rules/MASTER.md`; this file is
  an operational shortcut, not a replacement for `rules/workflow.md`.

## Fixed UAT (MANDATORY)
- UAT is presented on the **root checkout**, `ENV=dev`, at the fixed ports
  defined in `rules/MASTER.md` → *UAT Environment* (API 8801 / UI 5301 /
  Maildev 1101 / Postgres 5532 / S3 9100-9101 / Obscura 9222). Stable URL
  `http://localhost:5301`, stable data.
- The UAT port set is reserved: no branch, test stack, or lane agent may bind it.

## Multi-agent lanes
- Implementation can be carried by up to three external CLI agents, each on its
  own lane (branch + worktree):
  - `gpt` — GPT-5.5 (xhigh reasoning).
  - `opus` — Claude Opus 4.7.
  - `gemini` — Gemini 3.5 (high).
- A **lane** binds one agent to one branch/worktree. Lanes are recorded in
  `.agents/lanes` (one `lane|agent|dir` entry per line; `#` comments allowed),
  e.g. `BR05R|opus|tmp/feat-source-value-review-ui`.
- Sessions may be continuous (resume the same agent on the same lane) or fresh
  (relaunch with a narrow delta brief). Either way the lane row stays accurate.
- Before (re)launching any agent: `git -C <worktree> branch --show-current` to
  confirm the worktree points at the intended branch (avoids commits on the
  wrong branch).
- Dispatch packets follow `rules/subagents.md`; relaunch with a narrow delta
  scope and explicit continuity context, never broad/ambiguous instructions.

## Port non-concurrency (test / branch stacks)
- Root `ENV=dev` UAT ports are fixed and reserved (above).
- Each active branch uses a unique `ENV` slug and a unique port block that does
  not collide with `01` (the UAT block). Convention for branch number `nn`:
  API `8800+nn`, UI `5300+nn`, Maildev UI `1100+nn`, Postgres `5530+nn`,
  S3 `9100+nn`/`9120+nn`, Obscura `9300+nn`.
- Before starting a branch stack: `make ps-all` to verify no port conflict.
- End of lot / branch closure: `make down ENV=<branch-env>` so `make ps-all`
  shows no stale services. Never leave a merged branch's stack running.

## Status reporting
- `make conductor-report` reads the lane registry (`.agents/lanes` by default,
  or `CONDUCTOR_LANES=...` / `CONDUCTOR_LANES_FILE=...`, or auto-globs
  `tmp/feat-* tmp/fix-* tmp/chore-*`) and prints per lane: agent, branch,
  done/treated % (UAT lots excluded), dirty file count, HEAD, SLOC, and an
  ACTIVE/STALL heartbeat from the plan file mtime.
- Use it as the canonical answer to "which agent is on which branch and how far
  along".
- `plan/STATUS.md` complements it with a **purpose (finalité) × branch** view and
  the active demand trackers; the conductor keeps it in sync at each branch
  open/close.

## User question / answer protocol
- Batch questions; never one-by-one interruptions. Max one batch per lot unless
  a new hard blocker appears.
- Each question: ID (`BRxx-Qn`), decision needed, options, recommendation,
  delivery impact. Evidence first (repro + logs + checks before escalation).
- Scope exceptions: `BRxx-EXn` with path(s), justification, risk/rollback.

## Branch closure checklist
1. Lot checkboxes complete in the branch plan file.
2. Tests and UAT checkpoints marked and evidenced.
3. Open questions resolved or deferred with owner/date.
4. `make down ENV=<branch-env>` — no stale services in `make ps-all`.
5. `PLAN.md` updated with status and next dependency unlocks.
6. Scope exceptions (`BRxx-EXn`) resolved or deferred.

> WARNING: All claims need evidence (grep, diff, DB query). Never assert
> "pre-existing" or "probably" without verification.
> WARNING: Verify the worktree branch before launching any lane agent.
