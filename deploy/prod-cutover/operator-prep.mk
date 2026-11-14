# Standalone operator preparation. No dotenv inclusion.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
.PHONY: operator-prep operator-inspect
operator-prep:
	@test "$(ENV)" = prod
	@bash deploy/prod-cutover/operator-prep.sh
operator-inspect:
	@KUBECONFIG="$(HOME)/.kube/radar-prod-tenant-admin.kubeconfig" kubectl -n radar-immobilier get svc radar-postgres -o name
	@for name in radar-db-credentials radar-db-ro-prod; do KUBECONFIG="$(HOME)/.kube/radar-prod-tenant-admin.kubeconfig" kubectl -n radar-immobilier get secret $$name -o json | jq '{name:.metadata.name,keys:(.data|keys)}'; done
	@docker context show
	@docker ps --format '{{.Names}} {{.Ports}}'
	@gh api repos/rhanka/radar-immobilier/actions/runs/42669916074/artifacts --jq '.artifacts[]|{id,name,expired}'
