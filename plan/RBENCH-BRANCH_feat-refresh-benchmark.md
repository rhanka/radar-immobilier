# Feature: Five-document refresh model benchmark

## Objective
- [ ] Compare the owner's model/effort matrix on five frozen municipal PDFs through enrolled llm-mesh subscription transports, with two blind independent judges and quota evidence.

## Scope / Guardrails
- [x] Owner requested Codex 5.3, Gemini 3.8, Codex Luna and Sol, each normal/high; judges Sol xhigh and Fable 5 xhigh; inspect the historical Sonnet 5 configuration without inventing its effort.
- [x] Worktree `tmp/refresh-benchmark`, branch `feat/refresh-benchmark`, T1 snapshot `2480747bcf8133610ca506b6488e2557c39219a6`; T1 development continues independently.
- [x] Enrolled Codex and Cloud Code/AGY credentials through llm-mesh only; no silent direct paid API or substitute model. Never log/export credentials.
- [x] Make-only, Docker-first, ENV=test-refresh-benchmark; API_PORT=8884 UI_PORT=5384 MAILDEV_UI_PORT=1184; no app/DB/S3 stack or public ports required.

## Branch Scope Boundaries (MANDATORY)
- [x] Allowed writes: this plan; `tools/refresh-benchmark/**`; `docs/reviews/refresh-benchmark/**`; isolated scratch `tmp/refresh-benchmark/**` inside this worktree.
- [x] Allowed reads: T1 helpers/config/profile and immutable i-cond PDF corpus, current mesh public APIs and provider metadata, existing enrolled credentials via their supported enrollment/keyring interface.
- [x] Forbidden: root UAT, T1/T2/Geo worktree writes, app source/dependency changes, root Makefile/Compose, rules, .track, other plans, cluster/data mutations, global account configuration changes, unbounded provider retries.
- [x] Missing source/effort/model/enrollment support requires exact evidence and handoff, never an invented label, copied secret dump or automatic paid fallback.

## Feedback Loop
- [x] Use `docs/reviews/refresh-benchmark/protocol.md` as the frozen protocol; report readiness and exact matrix before live calls. Live benchmark calls are owner-authorized, infrastructure mutations are not.
- [x] This is a T1 model-selection subtask, not a fifth objective. Archive utility remains objective 4, below T1/T2/T3.

## Orchestration Mode (AI-selected)
- [x] One bounded Sol runner implementation; independent Sol xhigh/Fable 5 xhigh judge calls. Parallel cases within account quota/concurrency limits, no host-agent fanout per PDF.

## UAT Management
- [x] No root UAT or application data writes; benchmark results never become canonical Signals automatically.

## Plan / Todo (lot-based)
- [x] Lot 1: qualify exact model/effort transport support and enrolled account/quota interfaces; freeze five source PDFs and original pages.
- [x] Lot 2: implement the smallest replayable mesh runner with isolated hermetic tests and quota/usage receipts, without a new framework.
- [ ] Lot 3: v1 stopped after 7 unique cases because its citation/evidence contract was incomplete; preserve all 8 attempts and resume only as a separately frozen v2 campaign.
- [x] Lot 3a: freeze the owner-prioritized five-PDF current-HEAD v3 campaign and fail-closed subscription preflight before its first Sol medium calls.
- [x] Lot 3b: retain all seven v3 attempts, quota snapshots, exact non-rankable as-is diagnostic, and the blind bundle without launching judges.
- [ ] Lot 4: v1 evidence and quota handoff recorded; judging and a model recommendation require the reviewed v2 campaign and faithful Fable enrollment.

## Merge / Close
- [ ] Commit reproducible protocol/results with selective atomic commits <=150 changed lines; no push/merge by delegate.
