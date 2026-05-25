# Multi-agent lane registry

This directory records which agent works on which branch/worktree so the
conductor can report progress with `make conductor-report`.

## Agents

| key | agent |
| --- | ----- |
| `gpt` | GPT-5.5 (xhigh reasoning) |
| `opus` | Claude Opus 4.7 |
| `gemini` | Gemini 3.5 (high) |
| `-` | unassigned / not yet known |

## `lanes` file format

One lane per line: `lane|agent|dir`

- `lane` — short label (usually the branch id, e.g. `BR05R`).
- `agent` — one of the keys above.
- `dir` — worktree path relative to the repo root (e.g. `tmp/feat-...`).
- Lines starting with `#` and blank lines are ignored.

The conductor updates a lane's `agent` when it (re)launches that lane, in
continuous or fresh sessions (see `rules/conductor.md`). Keep only **active**
lanes here; remove a lane once its branch is merged and its worktree torn down.

## Usage

```
make conductor-report                                  # reads .agents/lanes
make conductor-report CONDUCTOR_LANES_FILE=.agents/lanes
make conductor-report CONDUCTOR_LANES="BR05R|opus|tmp/feat-source-value-review-ui"
```

With no registry and no override, the report auto-globs
`tmp/feat-* tmp/fix-* tmp/chore-*` and lists every worktree (agent shown as `-`).
