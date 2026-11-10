# Lane Report — fix/containers-run-as-host-user

- **PR**: [#1061](https://github.com/rhanka/radar-immobilier/pull/1061)
  (`fix/containers-run-as-host-user` → `main`, base `01886c12`)
- **CI**: see the PR checks; status recorded at the end of this file.
- **Clone**: `/home/antoinefa/src/radar-immobilier-uid` (fresh clone
  from `origin/main`, 2026-11-09)
- **Pattern source**: Sentropic PRs #973 (`dbd91c938`, `f5d7d0a35`)
  and #987, read in `/home/antoinefa/src/sentropic` (`git log`/`git show`)
- **Branch plan**: `plan/UIDFIX-BRANCH_fix-containers-run-as-host-user.md`
  (exception `UIDFIX-EX1` covers the default-forbidden `Makefile` /
  `docker-compose*.yml` paths)

## Problem

Radar containers ran as root and left root-owned files in the bind
mounts (`node_modules` mount-point stubs, `tmp/`, workspace outputs),
undeletable by the user without sudo.

## Modified services (compose `user: "${UID:-1000}:${GID:-1000}"`)

| File | Service | Change |
| --- | --- | --- |
| docker-compose.dev.yml | api | user + HOME=/tmp + npm_config_cache=/tmp/npm-cache |
| docker-compose.dev.yml | ui | user + HOME=/tmp + npm_config_cache=/tmp/npm-cache |
| docker-compose.test.yml | api | user + HOME=/tmp + npm_config_cache=/tmp/npm-cache |
| docker-compose.e2e.yml | e2e | user + HOME=/tmp + npm cache + PLAYWRIGHT_BROWSERS_PATH=/tmp/ms-playwright; new build (e2e/Dockerfile) |
| tools/make/git-artifact.compose.yml | node | user (writes the tmp/git-artifact-proof bind) |

Unchanged, with reason:

- `docker-compose.yml` (base): no bind mounts. `postgres`, `minio`
  (named volume or none), `obscura` (already `1001:1001`), `maildev`
  (no volume) keep their users.
- `docker-compose.e2e.yml` `api`/`ui`: production images, no bind
  mounts (api image already runs as `USER radar`).

## Modified targets and scripts

- `Makefile`: `export UID := $(shell id -u)`,
  `export GID := $(shell id -g)`, `DOCKER_RUN_USER := -u $(UID):$(GID)
  -e HOME=/tmp` (canonical flag set for raw `docker run` calls with a
  workspace mount; the Makefile itself has none, see inventory below).
- `Makefile`: new `chown-test-node-modules` / `chown-dev-node-modules`
  (host-side `mkdir -p` of the `node_modules` mount points, then a
  one-off root `chown -R` of the fresh named volumes, skipped when
  already host-owned). Wired as prerequisites of `test`, `test-api`,
  `test-immo-mcp`, `admission-keygen`, `admission-snapshot`,
  `admission-ingest`, `admission-verify`, `install`, `install-api`,
  `install-ui`, `install-dev`, `dev`, `typecheck`.
- `tools/make/e2e-real.sh`: exports `UID`/`GID`, builds the `e2e`
  image, pre-creates the mount points, one-off root `chown` of the
  e2e named volumes and `/e2e-state` before `prepare`.
- `tools/make/e2e-real-runner.sh`: `playwright install --only-shell
  chromium` (no `--with-deps`; apt needs root).
- `e2e/Dockerfile` (new): `node:24-bookworm-slim` + the Chromium
  system libraries baked at build time.
- `tools/make/artefacts-a4-run.sh`, `tools/make/artefacts-a5-run.sh`:
  `-u "$(id -u):$(id -g)" -e HOME=/tmp` on the image-probe
  `docker run` (writes the evidence bind).
- `deploy/k8s/refresh-cronjobs/refresh-018.mk`: `--user
  "$$(id -u):$$(id -g)" -e HOME=/tmp -e
  npm_config_cache=/tmp/npm-cache` on `bundle-requeue-abandoned` and
  `bundle-requeue-recurrent` (mount `$(ROOT):/workspace`).

## Raw `docker run` inventory (checked, not modified)

- `Makefile` smoke targets (`smoke-ui-image-bundle`,
  `smoke-ui-mjs-mime`), `tools/artifact-host.mk`, `tools/h3-*.sh`,
  `tools/h5-*.sh`: no workspace mount (image-internal checks only).
- `tools/make/base-api-a2rest-verify.sh` image-proof: no workspace
  mount; runs the baked image test harness, which must keep the
  image user. Its only host output is the pre-created evidence dir.
- `refresh-018.mk` `keyring-summary`: `--user 0:0` kept (read-only
  keyring source, container-internal copy). `enroll-cloud-code` /
  `enroll-codex` already run as the host user. `consent-cloud-code`
  uses a `--tmpfs /workspace` (ephemeral, no host bind).
- `docs/**/Makefile`: already `--user "$$(id -u):$$(id -g)"`.

## Proof (this clone, host uid 1000)

- `make test-api ENV=test-uidfix`: **PASS** — 420 test files passed,
  4385 tests passed, 0 failed (220 files / 985 tests skipped,
  pre-existing skips). First cold run showed 104 pg-connection
  failures across 48 files; the scoped file
  `tests/integration/artifacts-reader-exchange.spec.ts` then passed
  5/5 as the host user on a warm stack, and the full rerun was green.
  CI does not run `test-api` (see `.github/workflows/ci.yml`), so the
  cold-boot signature is recorded here as a local first-boot flake
  (postgis first-boot + cold caches), not a UID regression.
- `make typecheck ENV=test-uidfix`: **PASS** (exit 0).
- `make lint ENV=test-uidfix`: **PASS** (exit 0).
- `make test-e2e ENV=test-uidfix-e2e`: **PASS** — 9 Playwright tests
  passed (12.1 s) in the UID-mapped runner with baked Chromium deps.
  First attempt hit the host Docker network-pool exhaustion
  (`all predefined address pools have been fully subnetted`) after
  the previous proof stacks; freed by tearing a proof stack down.
- `find /home/antoinefa/src/radar-immobilier-uid -user root`:
  **empty** (0 entries) after all runs. The two root-owned empty
  `node_modules` mount-point stubs Docker created on the first run
  were removed without sudo (parent dir is user-owned) and are now
  pre-created host-owned by the chown targets.
- Teardown: `make clean ENV=test-uidfix` (`down -v`) done; the e2e
  script tears its own stack down (`down -v`) on exit. No container
  or volume of the proof projects remains.

## Known impact

- The dev/test `api` entrypoint can no longer `apt-get install
  poppler-utils` (needs root). Fixed by baking it: `api/Dockerfile.dev`
  (new) builds `radar-immobilier-api-dev` from the stock node image +
  `poppler-utils util-linux`, wired via `build:` in
  `docker-compose.dev.yml` / `docker-compose.test.yml`; the chown
  targets build it before any `run`. CI run 2 confirmed the two
  poppler tests (`pdf-first-page`, `isPdftotextAvailable` preflight)
  are the only consumers and now find the binary on PATH. The
  entrypoint apt-get fallback stays for stock-image use and skips
  itself when the binary is present.
- Existing root-owned named volumes on other checkouts keep working:
  the chown targets hand them to the host user on the next
  `make install` / `make test-api` / `make typecheck`.

## Commits

- `7fe05dde` chore: init branch plan for fix/containers-run-as-host-user
- `782bb5fe` fix: run bind-mount writer containers as host user
- `f6b952b4` fix: pre-create node_modules mount points host-owned
- `6db1b8e4` docs: close lots 1-3 in branch plan
- `3426d3d2` docs: add lane report for fix/containers-run-as-host-user
- `4b450bfd` fix: pre-clean bind node_modules trees before test npm ci
- `3ae01239` fix: bake poppler-utils into dev/test api image
- plus this report update commit. No commit carries a
  `Co-Authored-By`, `Claude-Session` or "Generated with" line
  (verified with `git log --format=%B | grep`).

## CI

- Run 1 (head `3426d3d2`): Real-stack e2e PASS (4m05s), Branch policy
  PASS, Quality gates FAIL at step `Test` — `npm ci` EACCES removing
  `ui/node_modules/@sentropic`, a bind tree left by the dev-stack
  install step (root-run history masked this; now blocked as the
  host user). Fixed in `4b450bfd` (root pre-clean of bind
  `node_modules` trees in `chown-test-node-modules`).
- Run 2 (head `4b450bfd`): Real-stack e2e PASS (4m14s), Quality gates
  FAIL at step `Test` with only the two poppler tests red
  (`pdf-first-page.test.ts`,
  `reglements-urbanisme-valleyfield.test.ts` preflight): `pdftotext`
  missing because the entrypoint apt-get needs root. API (420),
  UI (137) and other workspace suites all passed. Fixed by
  `api/Dockerfile.dev` (this head).
- Run 3 (head `3ae01239`, poppler fix): **all green** — Quality
  gates PASS (20m09s, incl. Install / Typecheck / Lint / Audit /
  Build / Smoke / Test on all workspaces), Real-stack e2e PASS
  (3m23s), Enforce repo policy PASS. PR state: OPEN, MERGEABLE.
  This report commit is docs-only on top of that head.

## Fixes REVIEW.md (independent review, REQUEST_CHANGES)

Source: `/home/antoinefa/src/radar-immobilier-review-1061/REVIEW.md`
(reviewed head `878f9867`). Fresh clone
`/home/antoinefa/src/radar-immobilier-fix-1061`, branch
`fix/containers-run-as-host-user`, `git pull --rebase` before edits,
regular push only (no force-push). New scope declared as
`UIDFIX-EX2` in the branch plan before touching the cutover and
standalone-makefile paths. Not merged.

| Finding | Fix | Commit |
| --- | --- | --- |
| F1 (BLOCKING) `deploy/cutover/test.compose.yml` `api` missed: root bind-mount writer exercised in CI | `api` gets `user: "${UID:-1000}:${GID:-1000}"` + `HOME=/tmp` + `npm_config_cache=/tmp/npm-cache`; new `deploy/cutover/Dockerfile.test` bakes `bash make jq curl gettext-base` (the `apt-get` step is removed from `cutover-verify.sh`); `tools/make/cutover-verify.sh` exports the real `UID`/`GID`, pre-creates the mount points and hands the fresh `modules`/`api-modules` volumes to the host user (one-off root `chown`, mirroring `chown-test-node-modules`) before the first `npm ci`; `deploy/cutover/operator.mk` also exports `UID`/`GID` | `26ed8e10` |
| F2 (major) standalone entrypoints silently pin `1000:1000` | `tools/immo-mcp-test.mk` and `tools/make/git-artifact.mk` export `UID := $(shell id -u)` / `GID := $(shell id -g)`; `tools/make/git-artifact-verify.sh` exports the real ids for compose interpolation (its `--user` literal is unchanged) | `6cc1ae69` |
| F3 (minor) `DOCKER_RUN_USER` defined, never used; `:=` overrides caller `UID`/`GID` | Variable and its false comment dropped from the root `Makefile` (raw writers are standalone and pass `--user` literally); `export UID :=` / `export GID :=` aligned to `export UID ?=` / `export GID ?=` | `1a16c10e` |
| F4 (minor) cold-volume prerequisites incomplete | `chown-dev-node-modules` prerequisite added to `lint`, `test-ui`, `audit-security`, `test-audit-security`, `db-generate`, `fixture-promote`, `build-ui-artifact` | `38d2405a` |
| F5 (minor / observations) | One-line blast-radius comment on `chown-test-node-modules` (its `rm -rf` of host-bind `node_modules` trees runs on every `make test*`); `tools/make/git-artifact.compose.yml` `HOME: /tmp/home` aligned to `/tmp`. The `e2e/Dockerfile` browser re-download cost is unchanged (accepted, recorded in REVIEW.md) | `2aa69c31` |

### Proof

- Compose rendering: cutover `api` renders `user: 1000:1000` with
  `HOME=/tmp` and the npm cache on this host (uid 1000).
- F2 mechanism proven with a stub `id` returning 1001/1002 first in
  `PATH`: `make -f tools/immo-mcp-test.mk config ENV=test-fix1061`
  renders `"user": "1001:1002"` instead of the fallback. The
  `gb1-rows` path was also exercised with the stub; its stack was
  torn down (`down -v`) and the tracked generated file restored
  unchanged.
- F3 semantics: `UID=1001 GID=1002 make -pn` shows the caller values
  kept; without them, `$(shell id -u)` / `$(shell id -g)` apply.
- F4: `make -n lint ENV=test-review` and `make -n test-ui
  ENV=test-review` now print the `chown-dev-node-modules` steps
  before the service run.
- Local cutover run: `make -f deploy/cutover/operator.mk test
  TEST_PATTERN='one command restores' ENV=test-cutover` was started
  locally but `cutover-verify.sh` waits for the Docker campaign lock
  while other pre-existing stacks run on this host (not touched);
  it was stopped before creating any cutover container or volume.
  The same command is exercised in CI (Quality gates, head
  `2aa69c31`: PASS, see below), which is the F1 proof.
- Teardown: no `radar-test-cutover` or `radar-test-fix1061`
  container/volume remains (`down -v` verified); no root-owned file
  in the clone outside `node_modules`.
- CI (head `2aa69c31`, run 42766339024): Quality gates PASS
  (30m02s, includes the cutover hermetic tests, install, typecheck,
  lint, audit, build, test), Real-stack e2e PASS (3m46s), Enforce
  repo policy PASS. PR state: OPEN, not merged.
- Commit hygiene: `git log --format=%B 878f9867..HEAD | grep -ci
  'co-authored-by\|claude-session\|generated with'` = 0.

This report commit is docs-only on top of the green head
`2aa69c31`.
