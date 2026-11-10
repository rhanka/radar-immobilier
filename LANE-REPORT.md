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
  poppler-utils` (needs root). It degrades as designed: the app
  starts without `pdftotext`, so live-scrape PDF text extraction in
  dev/test stacks yields empty text until a dev image bakes
  poppler-utils (production `api/Dockerfile` already does). The API
  test suite does not depend on the binary (fixtures carry the
  extracted text; full suite green above).
- Existing root-owned named volumes on other checkouts keep working:
  the chown targets hand them to the host user on the next
  `make install` / `make test-api` / `make typecheck`.

## Commits

- `7fe05dde` chore: init branch plan for fix/containers-run-as-host-user
- `782bb5fe` fix: run bind-mount writer containers as host user
- `f6b952b4` fix: pre-create node_modules mount points host-owned
- `6db1b8e4` docs: close lots 1-3 in branch plan
- plus this report commit. No commit carries a `Co-Authored-By`,
  `Claude-Session` or "Generated with" line (verified with
  `git log --format=%B | grep`).

## CI

- Status: recorded after the report commit is pushed (final head).
