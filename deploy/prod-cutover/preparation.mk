# Standalone preparation. Never load the root Makefile or dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
export ENV OWNER
export COMPARE_REHEARSAL_RUN
.PHONY: preprod-artifact-keys
preprod-artifact-keys:
	@test "$(ENV)" = test-prod-cutover
	@for name in radar-artifacts-preprod radar-artifacts-upload-page-preprod radar-artifacts-reader-preprod immo-mcp-artifact-writer immo-mcp-account-reader; do \
	 kubectl --kubeconfig "$(HOME)/.kube/radar-preprod-tenant.kubeconfig" --request-timeout=15s -n radar-immobilier-preprod get secret "$$name" -o go-template='{{.metadata.name}}{{"\n"}}{{range $$key, $$value := .data}}{{$$key}}{{"\n"}}{{end}}'; done
prod-artifact-keys:
	@test "$(ENV)" = prod
	@for name in radar-artifacts-prod radar-artifacts-upload-page-prod radar-artifacts-reader-prod immo-mcp-artifact-writer immo-mcp-account-reader radar-artifact-content-prod-tls; do \
	 result=$$(kubectl --kubeconfig "$(HOME)/.kube/radar-prod-tenant-admin.kubeconfig" --request-timeout=15s -n radar-immobilier get secret "$$name" --ignore-not-found -o go-template='{{.metadata.name}}{{"\n"}}{{range $$key, $$value := .data}}{{$$key}}{{"\n"}}{{end}}'); \
	 if [[ -n $$result ]]; then printf '%s\n' "$$result"; else printf 'MISSING %s\n' "$$name"; fi; done
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
copy-sql-progress:
	@test "$(ENV)" = rehearsal
	@timeout --kill-after=2s 10s docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml exec -T postgres \
	 psql -XqAt -U radar -d radar_cutover_owner_20261113 -v ON_ERROR_STOP=1 \
	 -c "SELECT state,wait_event_type,wait_event,extract(epoch FROM clock_timestamp()-query_start)::integer FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();"
copy-service-status:
	@test "$(ENV)" = rehearsal
	@docker ps -a --filter label=com.docker.compose.project=radar-prod-copy-owner --format '{{.Names}} {{.Status}} {{.Ports}}'
copy-client-status:
	@test "$(ENV)" = rehearsal
	@docker ps -a --filter network=radar-prod-copy-owner_copy-only --format '{{.ID}} {{.Names}} {{.Status}}'
copy-client-inspect:
	@test "$(ENV)" = rehearsal
	@docker inspect "$(CLIENT_ID)" | jq '.[0]|{name:.Name,status:.State.Status,image:.Config.Image,command:.Args[0],network:.HostConfig.NetworkMode}'
copy-compose-check:
	@test "$(ENV)" = rehearsal
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml -f "$(HOME)/.local/share/radar-prod-copy/services.json" config --quiet
copy-ui-logs:
	@test "$(ENV)" = rehearsal
	@docker compose --env-file /dev/null -p radar-prod-copy-owner -f deploy/prod-cutover/rehearsal.compose.yml -f "$(HOME)/.local/share/radar-prod-copy/services.json" logs --no-color ui
copy-proxy-smoke:
	@test "$(ENV)" = rehearsal
	@headers=$$(mktemp); trap 'rm -f "$$headers"' EXIT; \
	 code=$$(curl -q -fsS --max-time 10 --cacert "$(HOME)/.local/share/radar-prod-copy/ca.crt" \
	 --resolve minio.localhost:15400:127.0.0.1 -X OPTIONS -H 'Origin: https://recette.localhost:15321' \
	 -D "$$headers" -o /dev/null -w '%{http_code}' https://minio.localhost:15400/radar-immobilier-artifacts); \
	 test "$$code" = 204; \
	 awk 'tolower($$1)=="access-control-allow-origin:" {gsub("\r", "", $$2); if ($$2=="https://recette.localhost:15321") ok=1} END {exit !ok}' "$$headers"; \
	 curl -q -fsS --max-time 10 --cacert "$(HOME)/.local/share/radar-prod-copy/ca.crt" --resolve recette.localhost:15321:127.0.0.1 \
	 https://recette.localhost:15321/build.json | jq -e '.sha=="b7724bd"' >/dev/null; echo 'Local TLS, served SHA and bounded CORS verified'
copy-remove-created-client:
	@test "$(ENV)" = rehearsal
	@test -n "$(CLIENT_ID)"
	@docker inspect "$(CLIENT_ID)" | jq -e 'length==1 and (.[0] | .State.Status=="created" and (.Args[0]=="psql" or (.Args[0]=="pg_restore" and .Args[1]=="--list")) and .Config.Image=="postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5" and .HostConfig.NetworkMode=="radar-prod-copy-owner_copy-only")' >/dev/null
	@docker rm "$(CLIENT_ID)" >/dev/null
copy-resume:
	@test "$(ENV)" = rehearsal
	@$(MAKE) --no-print-directory -f deploy/prod-cutover/preparation.mk copy-evidence ENV=rehearsal
	@for step in migrate transition transition verify; do $(MAKE) --no-print-directory -f deploy/prod-cutover/preparation.mk copy-step STEP="$$step" ENV=rehearsal; done
	@$(MAKE) --no-print-directory -f deploy/prod-cutover/preparation.mk copy-services-up ENV=rehearsal
	@$(MAKE) --no-print-directory -f deploy/prod-cutover/preparation.mk copy-step STEP=smoke ENV=rehearsal
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
copy-evidence copy-services-stop copy-config-check copy-timings copy-rollback-twice copy-export-timings copy-rollback-audit copy-read-check:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh local-$(@:copy-%=%)
copy-services-up:
	@test "$(ENV)" = rehearsal
	@for port in 18821 15321 15400 443; do \
	 if [[ -n $$(ss -H -ltn "sport = :$$port") ]]; then \
	  test -n "$$(docker ps -q --filter label=com.docker.compose.project=radar-prod-copy-owner --filter publish=$$port)"; \
	 fi; done
	@bash deploy/prod-cutover/rehearse-copy.sh local-services-up
copy-images:
	@test "$(ENV)" = rehearsal
	@jq -r '.apiImage,.uiImage' deploy/prod-cutover/release.json | while IFS= read -r image; do \
	 [[ $$image =~ ^ghcr.io/rhanka/radar-(api|ui)@sha256:[a-f0-9]{64}$$ ]]; docker pull "$$image"; done
	@docker pull postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5
	@docker pull adobe/s3mock@sha256:9da9c179bc0d1cb6986a40fd7ffbbc6deee11522b3892217ca350d65596126fa
copy-step:
	@test "$(ENV)" = rehearsal
	@bash deploy/prod-cutover/rehearse-copy.sh "$(STEP)"
