# Operator-only entry point. No root Makefile, environment files, ports or cluster CLI.
# The qualification container carries node (p0c-switch.ts) but no kubectl and no
# cluster identity, so this file mounts both from the operator's host:
# the explicit preprod kubeconfig (read-only, fixed container path) and the
# host kubectl binary (read-only). P0C_KUBECONFIG stays an explicit host file
# path (never ~/.kube/config); the hook re-enforces the canonical-path guard
# and the radar-immobilier-preprod namespace pin on every call.
SHELL := /bin/bash
ENV ?= unset
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_DISABLE_ENV_FILE
override COMPOSE := docker compose --env-file /dev/null -p radar-p0c-qualification -f docker-compose.test.yml
PASSTHROUGH := P0C_SCOPE P0C_DATABASE_URL P0C_COOKIE P0C_MCP_TOKEN P0C_MCP_URL P0C_OLD_HTTP_BASE P0C_V1_HTTP_BASE P0C_V2_HTTP_BASE ARTIFACTS_INPUTS_QUALIFIED ARTIFACTS_RESULTS_QUALIFIED
KUBECTL_BIN ?= $(shell command -v kubectl)
RUN := $(COMPOSE) run --rm --no-deps -T --entrypoint '' $(foreach key,$(PASSTHROUGH),-e $(key)) -e P0C_APPLY_HOOK=/p0c-apply -e P0C_KUBECONFIG=/kubeconfig -e P0C_NAMESPACE=radar-immobilier-preprod -v "$${P0C_APPLY_HOOK}:/p0c-apply:ro" -v "$${P0C_KUBECONFIG}:/kubeconfig:ro" -v "$(KUBECTL_BIN):/usr/local/bin/kubectl:ro"
.PHONY: guard preprod-switch-inputs preprod-switch-results down
guard:
	@test '$(ENV)' = preprod
	@test -n "$$P0C_APPLY_HOOK" && test -x "$$P0C_APPLY_HOOK"
	@test -n "$$P0C_KUBECONFIG" && test -f "$$P0C_KUBECONFIG" && test -r "$$P0C_KUBECONFIG"
	@case "$$P0C_KUBECONFIG" in "$$HOME/.kube/config"|~/.kube/config) echo "refusing default kubeconfig ~/.kube/config (pass an explicit P0C_KUBECONFIG)" >&2; exit 1;; esac
	@test -n "$(KUBECTL_BIN)" && test -x "$(KUBECTL_BIN)"
preprod-switch-inputs: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(RUN) -e P0C_PHASE=inputs api sh -ec 'kubectl version --client >/dev/null && npm ci --cache /tmp/immo-p0c-npm && npx --no-install tsx packages/immo-mcp/scripts/p0c-switch.ts'
preprod-switch-results: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(RUN) -e P0C_PHASE=results api sh -ec 'kubectl version --client >/dev/null && npm ci --cache /tmp/immo-p0c-npm && npx --no-install tsx packages/immo-mcp/scripts/p0c-switch.ts'
down:
	$(COMPOSE) down -v --remove-orphans
