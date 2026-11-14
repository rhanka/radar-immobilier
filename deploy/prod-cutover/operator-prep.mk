# Standalone operator preparation. No dotenv inclusion.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
.PHONY: operator-prep operator-history operator-check
operator-prep:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-prep.sh
.PHONY: operator-forward operator-clients operator-clients-check
operator-forward:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-prep.sh tunnel
operator-clients:
	@umask 077; mkdir -p "$(HOME)/.local/share/radar-prod-copy/operator-bin"; \
	 for client in psql pg_dump pg_restore; do install -m 700 deploy/prod-cutover/operator-pg.sh "$(HOME)/.local/share/radar-prod-copy/operator-bin/$$client"; done
operator-clients-check: operator-clients
	@test "$(ENV)" = prod
	@export ROOT="$(CURDIR)" PGHOST=127.0.0.1 PGPORT=25432 PGDATABASE=radar PGUSER=radar; \
	 export PGPASSFILE="$(HOME)/.local/share/radar-prod-copy/prod-admin.pgpass"; \
	 export CUTOVER_CONTAINER_RUN=00000000-0000-4000-8000-000000000020; \
	 export PGOPTIONS='-c default_transaction_read_only=on'; \
	 "$(HOME)/.local/share/radar-prod-copy/operator-bin/psql" -X -tAc 'select 1'
operator-history:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-history.sh
operator-check:
	@bash -n deploy/prod-cutover/operator-prep.sh deploy/prod-cutover/operator-prep-local.sh deploy/prod-cutover/operator-history.sh deploy/prod-cutover/operator-pg.sh
	@git diff --check
.PHONY: operator-status
operator-status:
	@umask 077; private="$(HOME)/.local/share/radar-prod-copy"; \
	 supervisor=$$(< "$$private/prod-forward.pid"); child=$$(< "$$private/prod-forward-child.pid"); \
	 kill -0 "$$supervisor"; kill -0 "$$child"; \
	 printf 'supervisor=%s port-forward=%s\n' "$$supervisor" "$$child"; \
	 ss -H -ltn 'sport = :25432 or sport = :25435'; \
	 jq -e -f tools/make/cutover-release.jq "$$private/previous-release.json" >/dev/null; \
	 jq -e --rawfile plan "$$private/plan.json" '.items[]|select(.metadata.name=="radar-cutover-6h")|.data["plan.json"]==$$plan' "$$private/configuration-tonight.json" >/dev/null; \
	 jq -r '.expiresAt|"approval expires="+.' "$$private/prod-approval.json"; \
	 awk 'match($$0,/(AccessDenied|NoSuchKey|no object found|status code: [0-9]+)/) {print substr($$0,RSTART,RLENGTH)}' "$$private/s3-probe.result"
