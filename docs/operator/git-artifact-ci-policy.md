# Git-backed artifacts: CI exclusion and protected environments

Immo side of G0 v3 §5 P7 and §7.1 condition 5 (A1 annex). Artifact branches
(`artifact/**`, personal form `artifact/p/<id8>/<slug>-<id8>`) live in this
repository, so ordinary CI and every deployment must stay closed to them.

## 1. Ordinary CI (in the workflow files)

| Workflow | Trigger | Guard |
|---|---|---|
| `ci.yml` | `push: main`, `pull_request` | `branches-ignore: ['artifact/**']` (PR target) and job `if: !startsWith(github.head_ref, 'artifact/')` (PR head) on `quality` and `e2e` |
| `branch-policy.yml` | `pull_request` | `branches-ignore: ['artifact/**']`; for an `artifact/**` head the required check `Enforce repo policy` fails from the event context alone (no checkout, no secret), because a skipped required check would report success |
| `build-push-images.yml` | `push: main`, tags `v[0-9]*`, dispatch | `build-push` refuses `refs/heads/artifact/**` |
| `bascule-bundle-cd.yml`, `deploy-gh-pages.yml` | `push: main`, dispatch | job ref guards (below) |

No workflow uses `pull_request_target` or `workflow_run`.

## 2. Protected environments (job guards)

Every job that mutates preprod/prod (cluster credential, cutover lock or a
protected GitHub environment) runs only for `github.ref == 'refs/heads/main'`
or `startsWith(github.ref, 'refs/tags/v')`: `run-job.yaml/run`,
`k8s-apply-mcp.yaml/apply`, `rollback.yml/*`, `bascule-bundle-cd.yml/*`,
`bascule-refresh.yml/force-refresh`, `build-push-images.yml` deploy jobs
(main) and `promote-prod` (tags), `bascule-e2e.yml/e2e` (main),
`deploy-gh-pages.yml/deploy` (main).

`bascule-preprod.yml` jobs `bascule` and `recover` carry the
`BASCULE_SCHEDULE_ENABLED` gate, which is out of scope here; they deploy only
through the `radar-bascule` environment, whose server-side policy is `main`.

A version tag alone is not enough: every job a `v*` tag can start runs
`deploy/ci/require-main-ancestry.sh` right after checkout, before any secret or
lock, and refuses a tag whose commit is not on `main` history (same check as
`promote-prod`). An arbitrary `v*` tag placed on an artifact commit never
deploys.

### E1 dependency: what the job guards rely on

The deployment secrets (`KUBE_CONFIG_DATA*`, `BACKUP_S3_*`, `SCW_*`,
`CUTOVER_PROBE_TOKEN`) are repository-level secrets, not environment secrets.
For a `workflow_dispatch`, GitHub reads the workflow file **from the
dispatched ref**. The `if:` guards above therefore protect those secrets only
while both hold:

1. every `artifact/**` branch descends from the merge of #1012, so it carries
   the guarded workflows; a branch created before that merge carries unguarded
   copies;
2. `.github/**` is never modified on an artifact branch: the A1 port refuses
   the path (`docs/operator/git-artifact-a1-registry.md`) and the A1 token has
   no `workflows` permission, so the forge rejects any push touching
   `.github/workflows`.

The server-side boundary, which does not depend on the branch content, is an
environment secret behind a deployment-branch policy. Recommended (owner
decision, not applied here): move these secrets into environments restricted
to `main` and `v*`, and have the sentropic port refuse an artifact branch
whose base does not contain the #1012 merge commit.

## 3. Environment deployment-branch policies (repository settings)

State read on 2026-11-05 (`gh api repos/rhanka/radar-immobilier/environments`):

| Environment | Policy | Target |
|---|---|---|
| `production` | custom: tag `v*` | unchanged (main + tags allowed by P7; tag-only is stricter) |
| `radar-backup-prod`, `radar-bascule`, `radar-e2e` | custom: branch `main` | unchanged |
| `preprod` | none (all refs) | custom: branch `main`, tag `v*` |
| `github-pages` | none (all refs) | custom: branch `main` |

Commands (repository administrator, not run by the branch):

```sh
R=repos/rhanka/radar-immobilier/environments
for e in preprod github-pages; do
  gh api -X PUT "$R/$e" --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
  gh api -X POST "$R/$e/deployment-branch-policies" -f name=main -f type=branch
done
gh api -X POST "$R/preprod/deployment-branch-policies" -f name='v*' -f type=tag
# verification
for e in production preprod github-pages radar-bascule radar-backup-prod radar-e2e; do
  echo "== $e"; gh api "$R/$e/deployment-branch-policies" --jq '.branch_policies[] | "\(.type) \(.name)"'
done
```

"Approved version tags" are only as strong as tag creation rights. Restrict
`v*` tag creation, update and deletion to administrators:

```sh
gh api -X POST repos/rhanka/radar-immobilier/rulesets --input - <<'JSON'
{"name":"version-tags","target":"tag","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}],
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}]}
JSON
```

### M1: pin the required checks to the GitHub Actions app

A required check named by context only is satisfied by any commit status of
that name. Pin both required checks to GitHub Actions (`app_id` 15368). The
read of 2026-11-05 already lists `app_id: 15368` for both checks; whether that
is an explicit pin or GitHub's automatic selection is `unverified`, so apply:

```sh
gh api -X PATCH repos/rhanka/radar-immobilier/branches/main/protection/required_status_checks --input - <<'JSON'
{"strict":true,"checks":[{"context":"Quality gates","app_id":15368},{"context":"Enforce repo policy","app_id":15368}]}
JSON
gh api repos/rhanka/radar-immobilier/branches/main/protection/required_status_checks --jq '.checks'
```

## 4. No artifact build or publication in CI

No workflow of this repository builds or publishes a git-backed artifact: the
builder is the sentropic server-side sandbox, which runs the closed recipe of
`sentropic.artifact.json`. The immo A1 write boundary that builder and the
commit port enforce is recorded in `docs/operator/git-artifact-a1-registry.md`.
