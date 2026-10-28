# Standalone operator entrypoint: no root Makefile or environment-file reads.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
override NAMESPACE := radar-immobilier-preprod
OUT ?= tmp/artifacts-preprod
MODE ?= off
ARTIFACT_API_IMAGE ?=
KUBECTL ?= kubectl
KF := bash deploy/ci/kfilter.sh
.PHONY: render test-render live cursor-secret reader-secrets credentials check-render apply-runtime route rollback
live:
	@test "$(ENV)" = preprod
	@test -n "$${KUBECONFIG:-}" || { echo 'Explicit preprod KUBECONFIG required' >&2; exit 1; }
render:
	@[[ "$(ARTIFACT_API_IMAGE)" =~ ^ghcr.io/rhanka/radar-api@sha256:[a-f0-9]{64}$$ ]]
	@case "$(MODE)" in off|general) ;; *) exit 1;; esac
	@mkdir -p "$(OUT)"
	@$(KUBECTL) kustomize deploy/overlays/preprod \
	  | sed -E -e 's/^(  ARTIFACTS_CONTROL_MODE: )("off"|off|"general"|general)$$/\1"$(MODE)"/' \
	    -e 's#ghcr.io/rhanka/radar-api:latest#$(ARTIFACT_API_IMAGE)#g' >"$(OUT)/render.yaml"
	@for name in radar-api immo-mcp-config; do \
	  $(KF) "$(OUT)/render.yaml" ConfigMap $$name \
	    | awk -v expected='"$(MODE)"' '/^  ARTIFACTS_CONTROL_MODE:/ { seen++; if ($$2 != expected) bad=1 } END { exit(bad || seen != 1) }' \
	    || { echo "FAIL: ConfigMap/$$name must render ARTIFACTS_CONTROL_MODE=$(MODE)" >&2; exit 1; }; \
	  done
	@bash deploy/ci/check-h3-preprod-render.sh "$(OUT)/render.yaml"
	@sha256sum "$(OUT)/render.yaml"
test-render:
	@KUBECTL="$(KUBECTL)" bash deploy/ci/check-h3-general-render.test.sh
# Create once. An existing Secret is retained without retrieving its data.
cursor-secret: live
	@existing=$$($(KUBECTL) -n $(NAMESPACE) get secret radar-classification-cursor-preprod --ignore-not-found -o name); \
	  if [ -n "$$existing" ]; then \
	  echo 'Cursor Secret retained; reuse key ID preprod-v1'; exit 0; fi; \
	  umask 077; keydir=$$(mktemp -d); trap 'rm -rf "$$keydir"' EXIT; \
	  openssl rand -hex 32 >"$$keydir/CLASSIFICATION_CURSOR_SECRET"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic radar-classification-cursor-preprod \
	    --from-file=CLASSIFICATION_CURSOR_SECRET="$$keydir/CLASSIFICATION_CURSOR_SECRET"
reader-secrets: live
	@existing=$$($(KUBECTL) -n $(NAMESPACE) get secret radar-artifacts-reader-preprod --ignore-not-found -o name); \
	  if [ -n "$$existing" ]; then \
	  echo 'Reader Secret retained'; exit 0; fi; \
	  umask 077; keydir=$$(mktemp -d); trap 'rm -rf "$$keydir"' EXIT; \
	  openssl rand -hex 32 >"$$keydir/ARTIFACTS_READER_GRANT_SECRET"; \
	  openssl rand -hex 32 >"$$keydir/ARTIFACTS_READER_SESSION_SECRET"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic radar-artifacts-reader-preprod \
	    --from-file=ARTIFACTS_READER_GRANT_SECRET="$$keydir/ARTIFACTS_READER_GRANT_SECRET" \
	    --from-file=ARTIFACTS_READER_SESSION_SECRET="$$keydir/ARTIFACTS_READER_SESSION_SECRET"
credentials: live
	@existing=$$($(KUBECTL) -n $(NAMESPACE) get secret radar-artifacts-preprod --ignore-not-found -o name); \
	  if [ -z "$$existing" ]; then \
	  test -f "$(ARTIFACT_S3_ACCESS_KEY_FILE)"; test -f "$(ARTIFACT_S3_SECRET_KEY_FILE)"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic radar-artifacts-preprod \
	    --from-file=ARTIFACTS_S3_ACCESS_KEY="$(ARTIFACT_S3_ACCESS_KEY_FILE)" \
	    --from-file=ARTIFACTS_S3_SECRET_KEY="$(ARTIFACT_S3_SECRET_KEY_FILE)"; fi
	@existing=$$($(KUBECTL) -n $(NAMESPACE) get secret immo-mcp-artifact-writer --ignore-not-found -o name); \
	  if [ -z "$$existing" ]; then \
	  test -f "$(ARTIFACT_DATABASE_URL_FILE)"; \
	  $(KUBECTL) -n $(NAMESPACE) create secret generic immo-mcp-artifact-writer \
	    --from-file=IMMO_MCP_ARTIFACT_DATABASE_URL="$(ARTIFACT_DATABASE_URL_FILE)"; fi
check-render:
	@bash deploy/ci/check-h3-preprod-render.sh "$(OUT)/render.yaml"
	@awk -f deploy/ci/h3-render-common.awk -f deploy/ci/h3-operator-images.awk "$(OUT)/render.yaml"
apply-runtime: live check-render
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
route: live check-render
	@$(KF) "$(OUT)/render.yaml" Ingress radar-artifact-content | $(KUBECTL) -n $(NAMESPACE) apply -f -
rollback: live
	@bash deploy/ci/h3-rollback.sh "$(KUBECTL)"
