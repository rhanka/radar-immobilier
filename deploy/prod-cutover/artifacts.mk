# Future provisioning only. Never invoked by rehearsal or the read-only precheck.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
export COMPOSE_DISABLE_ENV_FILE := 1
export DOTENV_CONFIG_PATH := /dev/null
override KUBE := kubectl --kubeconfig $(HOME)/.kube/radar-prod-tenant-admin.kubeconfig --request-timeout=15s -n radar-immobilier
.PHONY: guard s3-secret generated-secrets
guard:
	@test "$(ENV)" = provision-prod
	@test "$(PROVISION_OWNER)" = k8s
	@test "$$($(KUBE) config view --minify -o jsonpath='{.clusters[0].cluster.server}')" = https://hlhedx.c1.bhs5.k8s.ovh.net
# K8s mints and rotates the S3 principal. Dedicated dotenv has ONLY the two S3 keys.
# Neither make nor the shell sources it. Kubectl reads it without displaying it.
s3-secret: guard
	@existing=$$($(KUBE) get secret radar-artifacts-prod --ignore-not-found -o name); \
	 if [[ -n $$existing ]]; then echo 'S3 Secret retained'; exit 0; fi; \
	 test -f "$(ARTIFACTS_S3_ENV_FILE)"; test ! -L "$(ARTIFACTS_S3_ENV_FILE)"; \
	 $(KUBE) create secret generic radar-artifacts-prod --from-env-file="$(ARTIFACTS_S3_ENV_FILE)" >/dev/null
# Create once, without retrieving or replacing an existing signing key.
generated-secrets: guard
	@umask 077; keydir=$$(mktemp -d); trap 'rm -rf "$$keydir"' EXIT; \
	 for name in radar-artifacts-upload-page-prod radar-artifacts-reader-prod; do \
	  existing=$$($(KUBE) get secret "$$name" --ignore-not-found -o name); \
	  if [[ -n $$existing ]]; then echo "$$name retained"; continue; fi; \
	  if [[ $$name == radar-artifacts-upload-page-prod ]]; then keys=(secret); \
	  else keys=(ARTIFACTS_READER_GRANT_SECRET ARTIFACTS_READER_SESSION_SECRET); fi; \
	  args=(); for key in "$${keys[@]}"; do \
	   openssl rand -hex 32 | tr -d '\n' >"$$keydir/$$key"; args+=("--from-file=$$key=$$keydir/$$key"); \
	  done; $(KUBE) create secret generic "$$name" "$${args[@]}" >/dev/null; \
	 done
