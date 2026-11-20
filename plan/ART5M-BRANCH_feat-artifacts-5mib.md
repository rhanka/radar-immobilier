# Feature: Raise Artifact Page Publication Ceiling to 5 MiB and Support Out-of-Model Text Uploads

## Objective
Raise the immo artifact page publication ceiling from 256 KiB to 5 MiB (`5_242_880` bytes) per file and total across page text files (`text/html`, `text/css`, `text/javascript`, `application/json`), support out-of-model staging and bundle publication of those page text files under the same 5 MiB ceiling and release CSP, bump the authoring guide revision, and accept schema-advertised display metadata (`title`, `description`, `icon`) on P0b/CAS profiles instead of failing with `invalid_request`.

## Scope / Guardrails
- Scope limited to `packages/artifacts-host/**`, `packages/immo-mcp/**`, `api/src/artifacts/**`, `api/tests/integration/**`, `deploy/k8s/nginx/**`, `deploy/overlays/preprod/nginx/**`, `ui/nginx/**`, `tools/h3-nginx-control-limit.sh`, and this branch plan file.
- Zero database migrations required.
- Make-only workflow for build/typecheck/lint/test gates.
- Root workspace `~/src/radar-immobilier` remains untouched; all development happens in isolated repository-local worktree `./tmp/artifacts-5mib`.
- Automated test campaigns run on dedicated `ENV=test-artifacts-5mib`, never on `ENV=dev`.
- In every `make` command, `ENV=<env>` is passed as the last argument.
- All code, comments, commits, PR text, and plan text in English; user communication and report in French.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/artifacts-host/**`
  - `packages/immo-mcp/**`
  - `api/src/artifacts/**`
  - `api/tests/integration/**`
  - `deploy/k8s/nginx/**`
  - `deploy/overlays/preprod/nginx/**`
  - `ui/nginx/**`
  - `tools/h3-nginx-control-limit.sh`
  - `plan/ART5M-BRANCH_feat-artifacts-5mib.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `rules/**`
  - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (none)
  - `.github/workflows/**` (none)
  - `../poc-k8s/**` (none)
- **Exception process**:
  - None required.

## Feedback Loop
- None active.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: All host, MCP, API, and nginx adjustments share one contract boundary (`PUBLISH_MAX_FILE_BYTES = 5 MiB` and P0b upload/metadata parity) and must be validated together in one CI run.

## UAT Management (in orchestration context)
- Backend/MCP/nginx transport and policy change; no UI component visual change. UAT remains on root checkout when requested by owner.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md` and pointers (`AGENTS.md` / `GEMINI.md`).
  - [x] Create isolated repository-local worktree `./tmp/artifacts-5mib` on branch `feat/artifacts-5mib` from `origin/main`.
  - [x] Capture Makefile targets (`typecheck`, `lint`, `test`, `test-immo-mcp`, `test-api`, `k8s-validate`, `clean`).
  - [x] Define dedicated test stack mapping (`ENV=test-artifacts-5mib`, `API_PORT=18845`, `UI_PORT=15345`, `MAILDEV_UI_PORT=11145`, `POSTGRES_HOST_PORT=15545`, `S3_HOST_PORT=19145`, `OBSCURA_HOST_PORT=19245`, `MAILDEV_SMTP_HOST_PORT=11045`).
  - [x] Confirm command style: `make ... ENV=<env>` with `ENV` last.
  - [x] Confirm scope and guardrails.

- [x] **Lot 1 — Host 5 MiB ceiling, out-of-model page text uploads & P0b metadata parity (`packages/artifacts-host`)**
  - [x] Raise `PUBLISH_MAX_FILE_BYTES` to `5_242_880` (`5 MiB`) and update `publish-policy.ts`, `profile.ts`, `p0b-profile.ts`, `design-kit.ts`, and `map-kit.ts`.
  - [x] Enforce the 5 MiB per-file and 5 MiB total ceiling on page text MIME types (`text/html`, `text/css`, `text/javascript`, `application/json`) across `create_upload`, `commit_upload`, `publish_bundle`, `publish_bundle_v2`, and `uploadPageService`, while preserving strict UTF-8 + `sha256` verification without magic-byte checks.
  - [x] Accept and persist `title`, `description`, and `icon` on `ensure`, `publish`, `publish_bundle`, and `publish_bundle_v2` under envelope-v1 profiles (`immo-artifacts.p0b.v1`, `immo-artifacts.cas.v2`) instead of rejecting schema-advertised fields with `invalid_request`.
  - [x] Update and expand `packages/artifacts-host` unit and Postgres integration tests (2 MiB out-of-model `index.html`, > 5 MiB refusals, profile digests, P0b metadata).

- [x] **Lot 2 — MCP profile, wire limits & authoring guide r8 (`packages/immo-mcp`)**
  - [x] Update `decodedBytesPerFile` / `decodedBytesTotal` in `artifact-profile.ts` and `config/immo-artifacts.v1.json` to `5242880`.
  - [x] Raise `ARTIFACT_WIRE_LIMITS` in `stateful-composition.ts` and `maxRequestBodySize` in `server-http.ts` so a 5 MiB MCP publication request passes end-to-end.
  - [x] Wire envelope-v1 metadata acceptance in `artifact-provider.ts`.
  - [x] Bump `BASE_GUIDE_REVISION` to `2026-11-05-p0b-r8` / `2026-11-05-r8` and update `artifact-authoring-guide.ts`, `framework-starters.ts`, and `starter-files.ts` for the 5 MiB budget and `create_upload` flow on large page text files.
  - [x] Update and expand `packages/immo-mcp` tests.

- [x] **Lot 3 — API control body limit, nginx proxy envelope & reader serving proof (`api/`, `deploy/`, `ui/`, `tools/`)**
  - [x] Raise `CONTROL_MAX_BODY_BYTES` in `api/src/artifacts/control-route.ts` to `10 MiB` (`10 * 1024 * 1024`) and update `api/src/artifacts/design-kit.ts` comment.
  - [x] Configure `location ~ ^/api/v1/artifacts/control(?:/|$)` with `client_max_body_size 10m;` across `deploy/k8s/nginx/default.conf`, `ui/nginx/default.conf`, and `deploy/overlays/preprod/nginx/default.conf`, and update `tools/h3-nginx-control-limit.sh`.
  - [x] Add end-to-end integration test in `api/tests/integration/artifacts-files-parity.spec.ts` proving a 2 MiB `index.html` uploaded via `create_upload` -> PUT -> `commit_upload` -> `publish_bundle` is served with `text/html; charset=utf-8` and `releaseCspForHtml` (never `sandbox` or binary), and > 5 MiB is refused.
  - [x] Lot gate:
    - [x] `make k8s-validate ENV=ci` + nginx header parity & body-size checks
    - [x] `make typecheck` + `make lint`
    - [x] `make test ENV=test-artifacts-5mib` + `make clean ENV=test-artifacts-5mib`

- [ ] **Lot 4 — PR & report**
  - [ ] Push `feat/artifacts-5mib`, open PR to `main` (do not merge), report PR number, verify CI green, and write `agy-artifacts-5mib-REPORT.md`.
