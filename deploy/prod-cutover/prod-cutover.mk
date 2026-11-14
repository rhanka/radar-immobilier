# Standalone. Never include the root Makefile or an environment file.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
.DEFAULT_GOAL := help
override ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV OUTPUT ARCHIVE PLAN EVIDENCE RELEASE APPROVAL
export PGHOST PGPORT PGUSER PGDATABASE PGPASSFILE PGSERVICE PGSERVICEFILE
export SOURCE_PGHOST SOURCE_PGPORT SOURCE_PGUSER SOURCE_PGDATABASE SOURCE_PGPASSFILE
export BACKUP_URI BACKUP_ENDPOINT RESTORE_SHA256
export CUTOVER_API_IMAGE CUTOVER_ALLOW_PROD
export SMOKE_URL
export RUN CUTOVER_LOCK_RUN CUTOVER_LOCK_EXECUTOR ROSTER
export CONFIGURATION
export KUBECONFIG TLS_CERT TLS_KEY CONTENT_TLS_CERT CONTENT_TLS_KEY
export ARTIFACTS_CONTENT_HOST
.PHONY: artifact-roles
artifact-roles:
	@test "$(ENV)" = execution-prod
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=5s 150s bash deploy/prod-cutover/window.sh artifact-roles
export PREVIOUS_RELEASE
export CURSOR_REFERENCE
export COMMENT_FILE
export ROOT
export APPLY ARTIFACTS_PROD_ENV_FILE
export FINAL_OUTPUT
.PHONY: cors-precheck certificate-wait window-run backup-sha accept-final-restore release-tag
cors-precheck:
	@test "$(ENV)" = prod
	@cd "$(ROOT)" && node deploy/prod-cutover/cors-precheck.cjs
certificate-wait:
	@test "$(ENV)" = prod
	@kubectl --kubeconfig "$(HOME)/.kube/radar-prod-tenant-admin.kubeconfig" --request-timeout=15s -n radar-immobilier wait certificate/radar-artifact-content-prod --for=condition=Ready --timeout=300s
window-run:
	@test "$(ENV)" = prod
	@kubectl --kubeconfig "$(HOME)/.kube/radar-prod-tenant-admin.kubeconfig" --request-timeout=15s -n radar-immobilier get configmap radar-change-lock -o json | jq -er '.data.record|fromjson|select(.manualV1220==true)|.run'
backup-sha:
	@node -e 'const r=require("./deploy/prod-cutover/runtime.cjs"); console.log(r.receipt("backup").sha256)'
accept-final-restore:
	@node -e 'const r=require("./deploy/prod-cutover/runtime.cjs"); const p=r.json(r.path.join(r.env.FINAL_OUTPUT,"restore.json")), b=r.receipt("backup"); if(p.sha256!==b.sha256 || p.planSha256!==b.planSha256 || p.rosterSha256!==b.rosterSha256) r.fail("final_restore_mismatch"); r.save("restore",p)'
release-tag:
	@test "$(ENV)" = release-prod
	@test "$(TAG_GO)" = v1.2.20
	@$(MAKE) --no-print-directory -f deploy/prod-cutover/prod-cutover.mk smoke ENV=prod
	@git -C "$(ROOT)" merge-base --is-ancestor b7724bdd9015a4f26319897bf240baaf9ee636ae origin/main
	@git -C "$(ROOT)" tag v1.2.20 b7724bdd9015a4f26319897bf240baaf9ee636ae
	@git -C "$(ROOT)" push origin refs/tags/v1.2.20
.PHONY: provision-prod
provision-prod:
	@cd "$(ROOT)" && timeout --kill-after=5s 150s node deploy/prod-cutover/provision-prod.cjs
.PHONY: controller-test
verify-local:
	@test "$(ENV)" = test-prod-cutover
	@for step in test hook-controller-test integration lint check; do \
	 $(MAKE) --no-print-directory -f "$(ROOT)/deploy/prod-cutover/prod-cutover.mk" "$$step" ENV=test-prod-cutover || exit $$?; done
controller-test: lint-image
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=10s 300s bash deploy/prod-cutover/lint.sh controller
export STOP_RUN_CONTAINERS
export CUTOVER_LINT_PROJECT
render:
	@cd "$(ROOT)" && node deploy/prod-cutover/render.cjs
content-ingress:
	@cd "$(ROOT)" && node deploy/prod-cutover/render.cjs content-ingress
.PHONY: help prerequisites precheck backup restore-test migrate transition verify smoke rehearsal rollback k8s-plan cd-plan test integration down check image-check publish commit lint hook-controller-test
help:
	@echo 'Préparation : prerequisites precheck k8s-plan cd-plan. Exécution future : backup restore-test migrate transition verify smoke rehearsal rollback.'
prerequisites precheck k8s-plan cd-plan:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=5s 150s bash deploy/prod-cutover/inspect.sh $@
backup restore-test migrate transition verify smoke rehearsal rollback:
	@cd "$(ROOT)" && if [[ "$(ENV)" == execution-prod && "$@" =~ ^(backup|migrate|transition|rollback)$$ ]]; then timeout --signal=TERM --kill-after=10s 3600s bash deploy/prod-cutover/window.sh $@; else timeout --signal=TERM --kill-after=10s 3600s node deploy/prod-cutover/cli.cjs $@; fi
window-start window-configure window-close window-evidence window-deploy window-rollback-services window-reopen window-abort window-recover window-private-https:
	@cd "$(ROOT)" && timeout --signal=TERM --kill-after=10s 1200s bash deploy/prod-cutover/window.sh $@
test:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout 90s node --test deploy/prod-cutover/*.test.cjs
.PHONY: lint-image
lint-image:
	@test "$(ENV)" = test-prod-cutover
	@export BUILDX_CONFIG="$(HOME)/.cache/radar-prod-cutover-buildx"; mkdir -p "$$BUILDX_CONFIG"; \
	 if ! docker image inspect radar-cutover-test:local >/dev/null 2>&1; then \
	 timeout --kill-after=10s 600s docker build -f deploy/cutover/Dockerfile.test -t radar-cutover-test:local .; fi
hook-controller-test:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=5s 90s node --test deploy/prod-cutover/containers.integration.cjs
lint: lint-image
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=10s 300s bash deploy/prod-cutover/lint.sh
lint-down:
	@test "$(ENV)" = test-prod-cutover
	@env UID="$$(id -u)" GID="$$(id -g)" docker compose --env-file /dev/null -p "$(or $(CUTOVER_LINT_PROJECT),radar-test-prod-cutover-lint)" -f "$(ROOT)/deploy/cutover/test.compose.yml" down -v --remove-orphans
integration:
	@test "$(ENV)" = test-prod-cutover
	@cd "$(ROOT)" && timeout --kill-after=10s 300s bash deploy/prod-cutover/integration.sh
down:
	@test "$(ENV)" = test-prod-cutover
	@CUTOVER_TEST_OUTPUT=/tmp docker compose --env-file /dev/null -p radar-test-prod-cutover -f "$(ROOT)/deploy/prod-cutover/test.compose.yml" down -v --remove-orphans
check:
	@cd "$(ROOT)" && bash -n deploy/prod-cutover/*.sh deploy/cutover/atomic-restore.sh
	@cd "$(ROOT)" && for file in deploy/prod-cutover/*.cjs; do node --check "$$file"; done
	@git -C "$(ROOT)" diff --check
	@git -C "$(ROOT)" status --short --branch
image-check:
	@docker image inspect --format '{{.Id}}' ghcr.io/rhanka/radar-api@sha256:13664562840c200858355e525d292e5df5dfa2c0569a73b564f698bbccbb8a27
	@timeout --kill-after=5s 20s docker run --rm --pull=never --network none -e DOTENV_CONFIG_PATH=/dev/null --entrypoint node ghcr.io/rhanka/radar-api@sha256:13664562840c200858355e525d292e5df5dfa2c0569a73b564f698bbccbb8a27 -e 'Promise.all([import("/workspace/api/dist/scripts/database-cutover.js"),import("/workspace/node_modules/pg/lib/index.js"),import("/workspace/node_modules/drizzle-orm/node-postgres/index.js")]).then(([h])=>process.exit(typeof h.migrateDatabaseCutover==="function"?0:1))'
publish:
	@test "$(ENV)" = test-prod-cutover
	@case "$$(git -C "$(ROOT)" branch --show-current)" in feat/prod-cutover-v1220|feat/prod-cutover-v1220-prep) ;; *) exit 1;; esac
	@git -C "$(ROOT)" diff --quiet
	@git -C "$(ROOT)" diff --cached --quiet
	@git -C "$(ROOT)" push origin HEAD:refs/heads/feat/prod-cutover-v1220
commit:
	@test -n "$$MSG"
	@git -C "$(ROOT)" -c core.hooksPath=/dev/null commit -m "$$MSG"
pr-body:
	@cd "$(ROOT)" && gh api --method PATCH repos/rhanka/radar-immobilier/pulls/1100 -F body=@docs/runbooks/prod-cutover-v1220.md --jq .html_url
pr-comment:
	@test -n "$$COMMENT_FILE"
	@cd "$(ROOT)" && gh pr comment 1100 --body-file "$$COMMENT_FILE"
pr-status:
	@cd "$(ROOT)" && gh pr checks 1100
