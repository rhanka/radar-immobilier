# bascule-e2e — credential cycle (governance record)

The e2e orchestrator (`.github/workflows/bascule-e2e.yml`) holds **one** credential. The
immo leg is dispatched with the workflow's own `GITHUB_TOKEN` (`actions: write`); the
tenant identities used by each leg are recorded in each tenant's own `CRED_CYCLE.md`
(immo: `../bascule-preprod/CRED_CYCLE.md`; geo: `rhanka/geo` `deploy/ci/bascule-preprod/CRED_CYCLE.md`).

## `GEO_DISPATCH_TOKEN`

| item | value |
| --- | --- |
| purpose | cross-repo `workflow_dispatch` of `rhanka/geo` `bascule-preprod.yml` (`MODE=list` then `MODE=restore`), status and artefacts of the geo leg, read of the geo workflow file (capability check) |
| source | the `gh` CLI OAuth token of the account `rhanka` (`gh auth token`) — **not** a fine-grained PAT |
| where it lives | (1) GitHub Environment `radar-e2e` (deployment branch = `main` only), secret `GEO_DISPATCH_TOKEN` (set 2026-09-26 13:53Z); (2) the immo `.env` `/home/antoinefa/src/radar-immobilier/.env`, variable `GEO_DISPATCH_TOKEN`. It is **not** in the central `.env` nor in any k8s Secret |
| real scope | OAuth scopes `repo`, `workflow`, `write:packages`, `read:org`, `gist`, `project`: **every repository of `rhanka`**, far beyond what the orchestrator needs |
| who reads it | only the job `e2e` of `bascule-e2e.yml` — the single job that dispatches geo and the only one declaring `environment: radar-e2e` (checked by `orchestrator.selftest.mjs`); passed through `env:` only, never interpolated in `run:`, never logged |
| invalidation | any `gh auth logout` or `gh auth refresh` on the owner workstation revokes this token: the next `bascule-e2e` run then fails at `capabilities` (HTTP 401 on the geo workflow file, nothing dispatched). Re-issue it: `gh auth token` → set the secret again (`gh secret set GEO_DISPATCH_TOKEN --env radar-e2e --repo rhanka/radar-immobilier`) and the immo `.env` |

**Debt (owner action):** replace it with a **fine-grained PAT** created by the owner in the
GitHub UI, restricted to the repository `rhanka/geo` with **Actions: read and write** and
**Contents: read** only (optionally an expiry aligned with the 90-day rotation of the backup
identities). Then set it in the same two places (secret `GEO_DISPATCH_TOKEN` of
`radar-e2e`, immo `.env`); no code change is needed.

Verify at any time: `gh secret list --repo rhanka/radar-immobilier --env radar-e2e` lists
`GEO_DISPATCH_TOKEN`; a `bascule-e2e.yml` run with `DRY_RUN=true` passes `capabilities` and
`list-backups`.
