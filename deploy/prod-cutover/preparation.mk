# Standalone preparation. Never load the root Makefile or dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV OWNER
.PHONY: preprod-artifact-keys
preprod-artifact-keys:
	@test "$(ENV)" = test-prod-cutover
	@for name in radar-artifacts-preprod radar-artifacts-upload-page-preprod radar-artifacts-reader-preprod immo-mcp-artifact-writer immo-mcp-account-reader; do \
	 kubectl --kubeconfig "$(HOME)/.kube/radar-preprod-tenant.kubeconfig" --request-timeout=15s -n radar-immobilier-preprod get secret "$$name" -o go-template='{{.metadata.name}}{{"\n"}}{{range $$key, $$value := .data}}{{$$key}}{{"\n"}}{{end}}'; done
.PHONY: inventory archive images runtime copy-up copy-down copy-step copy-rehearse copy-prepare copy-evidence copy-services-stop copy-config-check copy-services-up copy-images
inventory archive images:
	@test "$(ENV)" = test-prod-cutover
	@timeout --kill-after=10s 1800s bash deploy/prod-cutover/preparation.sh $@
runtime:
	@test "$(ENV)" = test-prod-cutover
	@bash deploy/prod-cutover/local-runtime.sh
copy-up:
	@test "$(ENV)" = rehearsal
	@test -z "$$(ss -H -ltn 'sport = :25433')"
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml up -d --wait --wait-timeout 45
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml run --no-deps -T baseline-probe
copy-logs:
	@test "$(ENV)" = rehearsal
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml logs --no-color postgres
copy-client-check:
	@test "$(ENV)" = rehearsal
	@export PGHOST=127.0.0.1 PGPORT=25433 PGUSER=radar PGDATABASE=radar_cutover_owner_20261113; \
	 export PGPASSWORD="$$(cat "$(HOME)/.local/share/radar-prod-copy/local-password")"; \
	 "$(HOME)/.local/share/radar-prod-copy/bin/psql" -XqAt -v ON_ERROR_STOP=1 -c 'SELECT current_database();'
copy-network-check:
	@test "$(ENV)" = rehearsal
	@docker port radar-prod-copy-owner-postgres-1
	@docker inspect --format '{{json .NetworkSettings.Ports}}' radar-prod-copy-owner-postgres-1
	@ss -H -ltn 'sport = :25433'
	@docker context show
copy-host-progress:
	@test "$(ENV)" = rehearsal
	@df -h "$(HOME)/.local/share/radar-prod-copy"
	@timeout --kill-after=2s 10s docker stats --no-stream --format '{{.Name}} CPU={{.CPUPerc}} RAM={{.MemUsage}} IO={{.BlockIO}}' radar-prod-copy-owner-postgres-1
copy-down:
	@test "$(ENV)" = rehearsal
	@status=0; bash deploy/prod-cutover/rehearse-copy.sh local-services-stop || status=$$?; \
	 docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml -f "$(HOME)/.local/share/radar-prod-copy/services.json" down -v --remove-orphans; exit $$status
copy-rehearse:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearsal-start.sh
copy-prepare:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh local-prepare
copy-evidence copy-services-stop copy-config-check copy-timings copy-rollback-twice copy-database-progress:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh local-$(@:copy-%=%)
copy-services-up:
	@test "$(ENV)" = rehearsal
	@for port in 18821 15321 15400 443; do test -z "$$(ss -H -ltn "sport = :$$port")"; done
	@bash deploy/prod-cutover/rehearse-copy.sh local-services-up
copy-images:
	@test "$(ENV)" = rehearsal
	@docker pull adobe/s3mock@sha256:9da9c179bc0d1cb6986a40fd7ffbbc6deee11522b3892217ca350d65596126fa
copy-step:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh "$(STEP)"
