SHELL := /bin/bash

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../../..)
OVERLAY := $(ROOT)/deploy/k8s/refresh-cronjobs
NAMESPACE := radar-immobilier-preprod
EXPECTED_SERVER := https://hlhedx.c1.bhs5.k8s.ovh.net
K := kubectl --kubeconfig "$(KUBECONFIG)" -n $(NAMESPACE)
PLACEHOLDER := ghcr.io/rhanka/radar-api:PINNED-BY-CI-AT-RELEASE-DO-NOT-APPLY-UNEDITED
API_IMAGE := ghcr.io/rhanka/radar-api

.PHONY: guard-preprod
guard-preprod:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@test -n "$(KUBECONFIG)" -a -f "$(KUBECONFIG)" || { echo "KUBECONFIG file is required" >&2; exit 1; }
	@server="$$(kubectl --kubeconfig "$(KUBECONFIG)" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"; \
	  case "$$server" in "$(EXPECTED_SERVER)"|"$(EXPECTED_SERVER)":*) ;; *) echo "refusing unexpected API server" >&2; exit 1;; esac
	@$(K) get namespace $(NAMESPACE) -o name >/dev/null

.PHONY: inspect-preprod
inspect-preprod: guard-preprod
	@kubectl --kubeconfig "$(KUBECONFIG)" auth whoami -o jsonpath='{.status.userInfo.username}{"\n"}'
	@for check in 'get cronjobs.batch' 'create cronjobs.batch' 'create jobs.batch' 'get secrets' 'create secrets' 'get persistentvolumeclaims' 'create persistentvolumeclaims'; do \
	  set -- $$check; printf '%-34s %s\n' "$$1 $$2" "$$($(K) auth can-i "$$1" "$$2")"; \
	done
	@$(K) get cronjob radar-refresh-scrape radar-refresh-projection radar-refresh-pv --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,SUSPEND:.spec.suspend,SCHEDULE:.spec.schedule,IMAGE:.spec.jobTemplate.spec.template.spec.containers[0].image
	@$(K) get secret radar-refresh-keyring-bootstrap radar-refresh-runtime --ignore-not-found -o name
	@$(K) get pvc radar-refresh-keyring --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,CLASS:.spec.storageClassName,ACCESS:.spec.accessModes[*]

.PHONY: keyring-summary
keyring-summary:
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@docker run --rm --user 0:0 -v "$(KEYRING_SOURCE_DIR):/source:ro" \
	  -v "$(OVERLAY)/keyring-summary.mjs:/workspace/keyring-summary.mjs:ro" "$(LOCAL_IMAGE)" \
	  /bin/sh -ceu 'mkdir /keyring; cp -a /source/. /keyring/; node /workspace/keyring-summary.mjs'

.PHONY: push-immutable
push-immutable:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@[[ "$(PUSH_TAG)" =~ ^r018-[0-9a-f]{8}$$ ]] \
	  || { echo "PUSH_TAG must be the isolated r018 commit tag" >&2; exit 1; }
	@docker image inspect "radar-immobilier-api:$(PUSH_TAG)" >/dev/null
	@docker tag "radar-immobilier-api:$(PUSH_TAG)" "$(API_IMAGE):$(PUSH_TAG)"
	@docker push "$(API_IMAGE):$(PUSH_TAG)"

.PHONY: image-digest
image-digest:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@[[ "$(PUSH_TAG)" =~ ^r018-[0-9a-f]{8}$$ ]] \
	  || { echo "PUSH_TAG must be the isolated r018 commit tag" >&2; exit 1; }
	@docker image inspect "$(API_IMAGE):$(PUSH_TAG)" \
	  --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep '^$(API_IMAGE)@sha256:'

.PHONY: render-preprod
render-preprod:
	@[[ "$(IMAGE_REF)" =~ ^ghcr\.io/rhanka/radar-api@sha256:[0-9a-f]{64}$$ ]] \
	  || { echo "IMAGE_REF must be the radar API immutable digest" >&2; exit 1; }
	@test -n "$(RENDER_OUT)" || { echo "RENDER_OUT is required" >&2; exit 1; }
	@umask 077; kubectl kustomize --load-restrictor LoadRestrictionsNone "$(OVERLAY)" \
	  | sed "s#$(PLACEHOLDER)#$(IMAGE_REF)#g" > "$(RENDER_OUT)"
	@! grep -q 'PINNED-BY-CI\|radar-api:latest' "$(RENDER_OUT)"

.PHONY: seed-preprod
seed-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(REFRESH_OWNER_SCOPE_REF)" || { echo "REFRESH_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@$(K) create secret generic radar-refresh-keyring-bootstrap \
	  --from-file="$(KEYRING_SOURCE_DIR)" --dry-run=client -o yaml | $(K) apply -f -
	@$(K) create secret generic radar-refresh-runtime \
	  --from-literal=REFRESH_PRINCIPAL_REF=radar-refresh-pv-preprod \
	  --from-literal=REFRESH_OWNER_SCOPE_REF="$(REFRESH_OWNER_SCOPE_REF)" \
	  --dry-run=client -o yaml | $(K) apply -f -

.PHONY: apply-preprod
apply-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$(IMAGE_REF)" RENDER_OUT="$$tmp" ENV=preprod; \
	  $(K) apply -f "$$tmp"

.PHONY: trigger-preprod
trigger-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) create job "radar-refresh-pv-$(RUN_ID)" --from=cronjob/radar-refresh-pv

.PHONY: status-preprod
status-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=NAME:.metadata.name,ACTIVE:.status.active,SUCCEEDED:.status.succeeded,FAILED:.status.failed,START:.status.startTime,END:.status.completionTime
	@$(K) get pods -l "job-name=radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,REASON:.status.reason,IMAGE:.spec.containers[0].image

.PHONY: logs-preprod
logs-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) logs "job/radar-refresh-pv-$(RUN_ID)" --all-containers=true
