# `radar-immobilier`

Automated municipal-document radar to detect residential densification opportunities in Québec municipalities.

> **Pilot city** : Salaberry-de-Valleyfield.
> **Phase 1** : a polished demo serving as the basis for a client proposal and pricing pack.
> **Phase 2** : interactive map, multi-city extension, advanced sources.

Refer to `docs/spec/input/VISION.md` for the full product vision and `docs/spec/input/PROCESS.md` for the operational pipeline (Signal → Anchoring → Constraints → Market → Strategic context → Scoring).

## Status

This repository is currently bootstrapping (BR-00 `chore/scaffolding-base`). Tracking : see `PLAN.md`.

## Quickstart

Prerequisites : Docker + Docker Compose + GNU make + git.

```bash
git clone <repo> radar-immobilier
cd radar-immobilier
cp .env.example .env       # fill in LLM API keys, S3 creds for prod
make help                  # list all available targets
make dev ENV=dev           # boot the dev stack (postgres + minio + obscura + maildev + api/ui placeholders)
make ps  ENV=dev           # check service health
make down ENV=dev          # stop the stack
```

The api/ui images only become real in BR-02 / BR-03 ; until then the `dev` stack runs the supporting services and a placeholder `node:24` container for the api.

## Layout

```
api/                  # Hono server (Node 24, TypeScript) — BR-02
ui/                   # Svelte 5 + Vite SPA — BR-03
packages/             # Shared workspace packages — BR-02+
  radar-domain/       #   types, Zod schemas (versioned)
  radar-sources/      #   source adapters (avis publics, PV, etc.)
  radar-scoring/      #   scoring rules from PROCESS.md §3
  radar-graph/        #   graphifyy wrapper for the radar
  radar-ui/           #   radar-specific Svelte components
e2e/                  # Playwright e2e tests — BR-07+
obscura/              # Dockerfile wrapping the upstream Rust headless browser
rules/                # multi-agent dev rules (read by Claude / Codex / Gemini / …)
.claude/skills/       # Claude Code skills (workflow + radar-specific)
plan/                 # NN-BRANCH_<slug>.md per branch + done/ for archived ones
docs/spec/
  input/              # immutable client vision/prompt/process
  SPEC_INTENT_*.md    # initial requests captured
  SPEC_EVOL_*.md      # design docs evolving during dev
  SPEC_*.md           # finalized specs
PLAN.md               # orchestrated roadmap (BR-00..BR-12)
Makefile              # all commands flow through this file
docker-compose*.yml   # base + dev / test / e2e surcharges
CLAUDE.md / AGENTS.md / GEMINI.md   # per-agent pointers to rules/MASTER.md
```

## Stack at a glance

- **API** : Hono on Node 24, Drizzle on Postgres 16 (PostGIS), S3-compatible object storage (Scaleway in prod, MinIO locally), `@sentropic/llm-mesh` for multi-provider LLM access, `@sentropic/chat-core` for orchestration, `graphifyy` for the knowledge graph linking documents.
- **UI** : Svelte 5 + Vite + Tailwind, design system `@sentropic/design-system-{svelte,themes,tokens}`, chat panel from `@sentropic/chat-ui`, map via MapLibre (BR-10).
- **Scraping** : `playwright` connected to an `obscura` (Rust headless) sidecar with anti-detect.
- **Auth** : passkey (WebAuthn) + magic-link, replicated from sentropic (BR-09).
- **Deployment** : SPA on GitHub Pages, server on the K8s POC cluster (Scaleway Kapsule), bucket S3 on the `PoCs` Scaleway project. Domain `immo.sent-tech.ca`.

See `docs/spec/SPEC_EVOL_SCAFFOLDING.md` for the full design and version pins.

## Conventions

- **Make-only**, **Docker-first** : never call `npm` / `node` / `docker` directly. All commands flow through `make <target> ENV=<slug>` (with `ENV` always last).
- **Worktree discipline** : feature work happens in `tmp/<slug>` worktrees ; the root checkout is reserved for user dev / UAT.
- **Atomic commits**, selective staging, **no squash merge**, branches preserved post-merge.
- **English** in code, commits, PRs and specs ; **French** in discussions with the user.
- **Multi-agent rules** : `rules/MASTER.md` is the single source of truth, pointer files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`) only add per-tool glue.

## Reading the rules

Any agent (Claude Code, Codex CLI, Gemini CLI, Aider, OpenCode, Copilot CLI, Kimi Code, …) must read `AGENTS.md` first, then `rules/MASTER.md`, before any action.

## License

UNLICENSED — proprietary during the demo phase. License terms revisited when the project transitions to the client.
