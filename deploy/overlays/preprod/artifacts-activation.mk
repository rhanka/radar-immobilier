# Standalone operator entrypoint: no root Makefile or environment-file reads.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
override NAMESPACE := radar-immobilier-preprod
OUT ?= tmp/artifacts-preprod
MODE ?= off
ARTIFACT_API_IMAGE ?=
KUBECTL ?= kubectl
KF := bash deploy/ci/kfilter.sh
.PHONY: render live cursor-secret reader-secrets apply-runtime route rollback
live:
	@test "$(ENV)" = preprod
	@test -n "$${KUBECONFIG:-}" || { echo 'Explicit preprod KUBECONFIG required' >&2; exit 1; }
render:
	@[[ "$(ARTIFACT_API_IMAGE)" =~ ^ghcr.io/rhanka/radar-api@sha256:[a-f0-9]{64}$$ ]]
	@case "$(MODE)" in off|general) ;; *) exit 1;; esac
	@mkdir -p "$(OUT)"
	@$(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod \
	  | sed -e 's/ARTIFACTS_CONTROL_MODE: general/ARTIFACTS_CONTROL_MODE: "$(MODE)"/g' \
	    -e 's#ghcr.io/rhanka/radar-api:latest#$(ARTIFACT_API_IMAGE)#g' >"$(OUT)/render.yaml"
	@bash deploy/ci/check-h3-preprod-render.sh "$(OUT)/render.yaml"
	@sha256sum "$(OUT)/render.yaml"
# Create once. An existing Secret is retained without retrieving its data.
cursor-secret: live
	@if [ -n "$$($(KUBECTL) -n $(NAMESPACE) get secret radar-classification-cursor-preprod --ignore-not-found -o name)" ]; then \
	  echo 'Cursor Secret retained; reuse key ID preprod-v1'; exit 0; fi; \
	  umask 077; keydir=$$(mktemp -d); trap 'rm -rf "$$keydir"' EXIT; \
	  openssl rand -hex 32 >"$$keydir/CLASSIFICATION_CURSOR_SECRET"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic radar-classification-cursor-preprod \
	    --from-file=CLASSIFICATION_CURSOR_SECRET="$$keydir/CLASSIFICATION_CURSOR_SECRET"
reader-secrets: live
	@if [ -n "$$($(KUBECTL) -n $(NAMESPACE) get secret radar-artifacts-reader-preprod --ignore-not-found -o name)" ]; then \
	  echo 'Reader Secret retained'; exit 0; fi; \
	  umask 077; keydir=$$(mktemp -d); trap 'rm -rf "$$keydir"' EXIT; \
	  openssl rand -hex 32 >"$$keydir/ARTIFACTS_READER_GRANT_SECRET"; \
	  openssl rand -hex 32 >"$$keydir/ARTIFACTS_READER_SESSION_SECRET"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic radar-artifacts-reader-preprod \
	    --from-file=ARTIFACTS_READER_GRANT_SECRET="$$keydir/ARTIFACTS_READER_GRANT_SECRET" \
	    --from-file=ARTIFACTS_READER_SESSION_SECRET="$$keydir/ARTIFACTS_READER_SESSION_SECRET"
apply-runtime: live
	@bash deploy/ci/check-h3-preprod-render.sh "$(OUT)/render.yaml"
	@for name in radar-api immo-mcp-config; do \
	  $(KF) "$(OUT)/render.yaml" ConfigMap $$name | $(KUBECTL) -n $(NAMESPACE) apply --server-side --field-manager=cd-preprod --force-conflicts -f -; done
	@for name in radar-artifact-content-deny; do \
	  $(KF) "$(OUT)/render.yaml" Service $$name | $(KUBECTL) -n $(NAMESPACE) apply -f -; done
	@for name in allow-traefik-to-content-deny deny-content-deny-egress; do \
	  $(KF) "$(OUT)/render.yaml" NetworkPolicy $$name | $(KUBECTL) -n $(NAMESPACE) apply -f -; done
	@for name in radar-artifact-content-deny radar-api radar-immo-mcp; do \
	  $(KF) "$(OUT)/render.yaml" Deployment $$name | $(KUBECTL) -n $(NAMESPACE) apply --server-side --field-manager=cd-preprod --force-conflicts -f -; \
	  $(KUBECTL) -n $(NAMESPACE) rollout restart deployment/$$name; \
	  $(KUBECTL) -n $(NAMESPACE) rollout status deployment/$$name --timeout=180s; done
route: live
	@bash deploy/ci/check-h3-preprod-render.sh "$(OUT)/render.yaml"
	@$(KF) "$(OUT)/render.yaml" Ingress radar-artifact-content | $(KUBECTL) -n $(NAMESPACE) apply -f -
rollback: live
	@for name in radar-api immo-mcp-config; do \
	  $(KUBECTL) -n $(NAMESPACE) patch configmap $$name --type merge -p '{"data":{"ARTIFACTS_CONTROL_MODE":"off"}}'; done
	@$(KUBECTL) -n $(NAMESPACE) patch ingress radar-artifact-content --type json -p '[{"op":"replace","path":"/spec/rules/0/http/paths/0/backend/service/name","value":"radar-artifact-content-deny"},{"op":"replace","path":"/spec/rules/1/http/paths/0/backend/service/name","value":"radar-artifact-content-deny"}]'
	@for name in radar-api radar-immo-mcp; do \
	  $(KUBECTL) -n $(NAMESPACE) rollout restart deployment/$$name; \
	  $(KUBECTL) -n $(NAMESPACE) rollout status deployment/$$name --timeout=180s; done
