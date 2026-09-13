SHELL := /bin/bash

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../../..)
OVERLAY := $(ROOT)/deploy/k8s/refresh-cronjobs
PROD_OVERLAY := $(ROOT)/deploy/k8s/refresh-cronjobs-prod
NAMESPACE := radar-immobilier-preprod
PROD_NAMESPACE := radar-immobilier
EXPECTED_SERVER := https://hlhedx.c1.bhs5.k8s.ovh.net
K := kubectl --kubeconfig "$(KUBECONFIG)" -n $(NAMESPACE)
KP := kubectl --kubeconfig "$(KUBECONFIG)" -n $(PROD_NAMESPACE)
PLACEHOLDER := ghcr.io/rhanka/radar-api:PINNED-BY-CI-AT-RELEASE-DO-NOT-APPLY-UNEDITED
API_IMAGE := ghcr.io/rhanka/radar-api
APPROVED_IMAGE := ghcr.io/rhanka/radar-api@sha256:d4a46b5615a7510fd5bf3384f65dea8b881cb75ae3226a3dc3751a7f9271119e
OVH_S3_ENDPOINT := https://s3.bhs.io.cloud.ovh.net
OVH_DOCS_BUCKET := radar-immobilier-docs
OVH_RAW_BUCKET := radar-immobilier-raw

.PHONY: guard-preprod
guard-preprod:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@test -n "$(KUBECONFIG)" -a -f "$(KUBECONFIG)" || { echo "KUBECONFIG file is required" >&2; exit 1; }
	@server="$$(kubectl --kubeconfig "$(KUBECONFIG)" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"; \
	  case "$$server" in "$(EXPECTED_SERVER)"|"$(EXPECTED_SERVER)":*) ;; *) echo "refusing unexpected API server" >&2; exit 1;; esac
	@$(K) get serviceaccount radar-app -o name >/dev/null

.PHONY: inspect-preprod
inspect-preprod: guard-preprod
	@kubectl --kubeconfig "$(KUBECONFIG)" auth whoami -o jsonpath='{.status.userInfo.username}{"\n"}'
	@for check in 'get cronjobs.batch' 'create cronjobs.batch' 'create jobs.batch' 'get secrets' 'create secrets' 'get persistentvolumeclaims' 'create persistentvolumeclaims'; do \
	  set -- $$check; printf '%-34s %s\n' "$$1 $$2" "$$($(K) auth can-i "$$1" "$$2")"; \
	done
	@$(K) get cronjob radar-refresh-scrape radar-refresh-projection radar-refresh-pv --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,SUSPEND:.spec.suspend,SCHEDULE:.spec.schedule,IMAGE:.spec.jobTemplate.spec.template.spec.containers[0].image
	@if [ "$$($(K) auth can-i get secrets)" = yes ]; then \
	  $(K) get secret radar-refresh-keyring-bootstrap radar-refresh-runtime --ignore-not-found -o name; \
	else echo 'secret inventory: unavailable to this identity'; fi
	@if [ "$$($(K) auth can-i get persistentvolumeclaims)" = yes ]; then \
	  $(K) get pvc radar-refresh-keyring --ignore-not-found \
	    -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,CLASS:.spec.storageClassName,ACCESS:.spec.accessModes[*]; \
	else echo 'PVC inventory: unavailable to this identity'; fi

.PHONY: guard-prod
guard-prod:
	@test "$(ENV)" = "prod" || { echo "ENV=prod is required" >&2; exit 1; }
	@test -n "$(KUBECONFIG)" -a -f "$(KUBECONFIG)" || { echo "KUBECONFIG file is required" >&2; exit 1; }
	@server="$$(kubectl --kubeconfig "$(KUBECONFIG)" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"; \
	  case "$$server" in "$(EXPECTED_SERVER)"|"$(EXPECTED_SERVER)":*) ;; *) echo "refusing unexpected API server" >&2; exit 1;; esac
	@$(KP) get serviceaccount radar-app -o name >/dev/null

.PHONY: inspect-prod
inspect-prod: guard-prod
	@kubectl --kubeconfig "$(KUBECONFIG)" auth whoami -o jsonpath='{.status.userInfo.username}{"\n"}'
	@for check in 'get cronjobs.batch' 'create cronjobs.batch' 'patch cronjobs.batch' 'create jobs.batch' 'get secrets' 'create secrets' 'get persistentvolumeclaims' 'create persistentvolumeclaims'; do \
	  set -- $$check; printf '%-34s %s\n' "$$1 $$2" "$$($(KP) auth can-i "$$1" "$$2")"; \
	done
	@$(KP) get cronjob radar-refresh-scrape radar-refresh-projection radar-refresh-pv --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,SUSPEND:.spec.suspend,SCHEDULE:.spec.schedule,IMAGE:.spec.jobTemplate.spec.template.spec.containers[0].image
	@$(KP) get configmap radar-api --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,GRAPH_ENDPOINT:.data.GRAPH_S3_ENDPOINT,GRAPH_REGION:.data.GRAPH_S3_REGION,GRAPH_BUCKET:.data.GRAPH_S3_BUCKET,SCRAPE_ENDPOINT:.data.SCRAPE_S3_ENDPOINT,SCRAPE_REGION:.data.SCRAPE_S3_REGION,SCRAPE_BUCKET:.data.SCRAPE_S3_BUCKET
	@if [ "$$($(KP) auth can-i get secrets)" = yes ]; then \
	  $(KP) get secret radar-raw-s3-credentials radar-graph-s3-credentials radar-scrape-s3-credentials radar-refresh-keyring-bootstrap radar-refresh-runtime --ignore-not-found -o name; \
	else echo 'secret inventory: unavailable to this identity'; fi
	@if [ "$$($(KP) auth can-i get persistentvolumeclaims)" = yes ]; then \
	  $(KP) get pvc radar-refresh-keyring --ignore-not-found \
	    -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,CLASS:.spec.storageClassName,ACCESS:.spec.accessModes[*]; \
	else echo 'PVC inventory: unavailable to this identity'; fi
	@$(KP) get statefulset radar-minio --ignore-not-found -o name
	@$(KP) get service radar-minio --ignore-not-found -o name
	@$(KP) get pvc minio-data-radar-minio-0 --ignore-not-found -o name
	@$(KP) get jobs -o custom-columns=NAME:.metadata.name,ACTIVE:.status.active,FAILED:.status.failed,SUCCEEDED:.status.succeeded --no-headers \
	  | awk '$$1 ~ /(object-storage|docs|copy|inventory|proof)/ { print }'

.PHONY: keyring-summary
keyring-summary:
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@docker run --rm --user 0:0 -v "$(KEYRING_SOURCE_DIR):/source:ro" \
	  -v "$(OVERLAY)/keyring-summary.mjs:/workspace/keyring-summary.mjs:ro" "$(LOCAL_IMAGE)" \
	  /bin/sh -ceu 'mkdir /keyring; cp -a /source/. /keyring/; node /workspace/keyring-summary.mjs'

.PHONY: enroll-cloud-code
enroll-cloud-code:
	@test "$(ENV)" = "test-refresh-018" || { echo "ENV=test-refresh-018 is required" >&2; exit 1; }
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(CLOUD_CODE_OWNER_SCOPE_REF)" || { echo "CLOUD_CODE_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@docker run --rm --network host --user "$$(id -u):$$(id -g)" \
	  -e CLOUD_CODE_OWNER_SCOPE_REF="$(CLOUD_CODE_OWNER_SCOPE_REF)" \
	  -v "$(KEYRING_SOURCE_DIR):/keyring" \
	  -v "$(OVERLAY)/enroll-cloud-code.mjs:/workspace/enroll-cloud-code.mjs:ro" "$(LOCAL_IMAGE)" \
	  node /workspace/enroll-cloud-code.mjs

.PHONY: consent-cloud-code
consent-cloud-code:
	@test "$(ENV)" = "test-refresh-018" || { echo "ENV=test-refresh-018 is required" >&2; exit 1; }
	@[[ "$(OAUTH_URL)" == https://accounts.google.com/* ]] \
	  || { echo "OAUTH_URL must be the active Google authorization URL" >&2; exit 1; }
	@docker run --rm --network host --tmpfs /workspace \
	  -e OAUTH_URL="$(OAUTH_URL)" \
	  -v "$(OVERLAY)/oauth-consent.mjs:/workspace/oauth-consent.mjs:ro" \
	  -w /workspace node:22-bookworm-slim node oauth-consent.mjs

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
	@set -o pipefail; umask 077; kubectl kustomize --load-restrictor LoadRestrictionsNone "$(OVERLAY)" \
	  | sed "s#$(PLACEHOLDER)#$(IMAGE_REF)#g" > "$(RENDER_OUT)"
	@! grep -q 'PINNED-BY-CI\|radar-api:latest' "$(RENDER_OUT)"

.PHONY: render-prod
render-prod:
	@test "$(IMAGE_REF)" = "$(APPROVED_IMAGE)" \
	  || { echo "IMAGE_REF must be the accepted Graphify 0.18 image" >&2; exit 1; }
	@test -n "$(RENDER_OUT)" || { echo "RENDER_OUT is required" >&2; exit 1; }
	@set -o pipefail; umask 077; kubectl kustomize --load-restrictor LoadRestrictionsNone "$(PROD_OVERLAY)" \
	  | sed "s#$(PLACEHOLDER)#$(IMAGE_REF)#g" > "$(RENDER_OUT)"
	@! grep -q 'PINNED-BY-CI\|radar-api:latest' "$(RENDER_OUT)"

.PHONY: verify-render-prod
verify-render-prod:
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-prod IMAGE_REF="$(APPROVED_IMAGE)" RENDER_OUT="$$tmp" ENV=test-refresh-prod-018; \
	  ! grep -Eqi 's3\.fr-par\.scw\.cloud|radar-minio|radar-immobilier-docs-pocs|SCW_' "$$tmp" \
	    || { echo "production render retains forbidden SCW or MinIO storage" >&2; exit 1; }; \
	  ! grep -q 'name: radar-s3-credentials' "$$tmp" \
	    || { echo "production render retains generic storage credentials" >&2; exit 1; }; \
	  grep -q 'name: radar-scrape-s3-credentials' "$$tmp"; \
	  grep -q 'name: radar-refresh-keyring-bootstrap' "$$tmp"; \
	  grep -q 'claimName: radar-refresh-keyring' "$$tmp"; \
	  test "$$(grep -c "image: $(APPROVED_IMAGE)" "$$tmp")" -eq 4; \
	  awk '\
	    /^kind: CronJob$$/ { kind="CronJob" } \
	    kind == "CronJob" && /^  name: radar-refresh-/ { name=$$2 } \
	    kind == "CronJob" && /^  suspend:/ { suspend[name]=$$2 } \
	    END { \
	      if (suspend["radar-refresh-pv"] != "false") exit 1; \
	      if (suspend["radar-refresh-scrape"] != "true") exit 1; \
	      if (suspend["radar-refresh-projection"] != "true") exit 1; \
	      if (length(suspend) != 3) exit 1; \
	    }' "$$tmp" \
	    || { echo "production render must activate only radar-refresh-pv" >&2; exit 1; }

.PHONY: storage-ready-prod
storage-ready-prod: guard-prod verify-render-prod
	@set -e; \
	  graph="$$( $(KP) get configmap radar-api -o jsonpath='{.data.GRAPH_S3_ENDPOINT}|{.data.GRAPH_S3_REGION}|{.data.GRAPH_S3_BUCKET}|{.data.GRAPH_S3_FORCE_PATH_STYLE}' )"; \
	  scrape="$$( $(KP) get configmap radar-api -o jsonpath='{.data.SCRAPE_S3_ENDPOINT}|{.data.SCRAPE_S3_REGION}|{.data.SCRAPE_S3_BUCKET}|{.data.SCRAPE_S3_FORCE_PATH_STYLE}' )"; \
	  test "$$graph" = "$(OVH_S3_ENDPOINT)|bhs|$(OVH_DOCS_BUCKET)|false" \
	    || { echo "live GRAPH binding is not the approved OVH DOCS store" >&2; exit 1; }; \
	  test "$$scrape" = "$(OVH_S3_ENDPOINT)|bhs|$(OVH_DOCS_BUCKET)|false" \
	    || { echo "live SCRAPE binding is not the approved OVH DOCS store" >&2; exit 1; }; \
	  require_key() { \
	    test -n "$$( $(KP) get secret "$$1" -o "jsonpath={.data.$$2}" )" \
	      || { echo "missing required key $$1/$$2" >&2; exit 1; }; \
	  }; \
	  for item in \
	    radar-raw-s3-credentials/RAW_S3_ENDPOINT \
	    radar-raw-s3-credentials/RAW_S3_REGION \
	    radar-raw-s3-credentials/RAW_S3_BUCKET \
	    radar-raw-s3-credentials/RAW_S3_FORCE_PATH_STYLE \
	    radar-raw-s3-credentials/RAW_S3_ACCESS_KEY \
	    radar-raw-s3-credentials/RAW_S3_SECRET_KEY \
	    radar-graph-s3-credentials/GRAPH_S3_ACCESS_KEY \
	    radar-graph-s3-credentials/GRAPH_S3_SECRET_KEY \
	    radar-scrape-s3-credentials/SCRAPE_S3_ACCESS_KEY \
	    radar-scrape-s3-credentials/SCRAPE_S3_SECRET_KEY; do \
	      require_key "$${item%/*}" "$${item#*/}"; \
	  done; \
	  expected_endpoint="$$(printf %s '$(OVH_S3_ENDPOINT)' | base64 | tr -d '\n')"; \
	  expected_region="$$(printf %s bhs | base64 | tr -d '\n')"; \
	  expected_bucket="$$(printf %s '$(OVH_RAW_BUCKET)' | base64 | tr -d '\n')"; \
	  expected_style="$$(printf %s false | base64 | tr -d '\n')"; \
	  test "$$( $(KP) get secret radar-raw-s3-credentials -o jsonpath='{.data.RAW_S3_ENDPOINT}' )" = "$$expected_endpoint"; \
	  test "$$( $(KP) get secret radar-raw-s3-credentials -o jsonpath='{.data.RAW_S3_REGION}' )" = "$$expected_region"; \
	  test "$$( $(KP) get secret radar-raw-s3-credentials -o jsonpath='{.data.RAW_S3_BUCKET}' )" = "$$expected_bucket"; \
	  test "$$( $(KP) get secret radar-raw-s3-credentials -o jsonpath='{.data.RAW_S3_FORCE_PATH_STYLE}' )" = "$$expected_style" \
	    || { echo "live RAW binding is not the approved OVH RAW store" >&2; exit 1; }; \
	  test -z "$$( $(KP) get statefulset radar-minio --ignore-not-found -o name )"; \
	  test -z "$$( $(KP) get service radar-minio --ignore-not-found -o name )"; \
	  test -z "$$( $(KP) get pvc minio-data-radar-minio-0 --ignore-not-found -o name )" \
	    || { echo "production MinIO resources still exist" >&2; exit 1; }; \
	  active="$$( $(KP) get jobs -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.status.active}{"\n"}{end}' \
	    | awk '$$1 ~ /(object-storage|docs|copy|inventory|proof)/ && $$2 + 0 > 0 { print $$1 }' )"; \
	  test -z "$$active" || { echo "active storage migration Job blocks promotion" >&2; exit 1; }

.PHONY: validate-prod
validate-prod: storage-ready-prod
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-prod IMAGE_REF="$(APPROVED_IMAGE)" RENDER_OUT="$$tmp" ENV=test-refresh-prod-018; \
	  $(KP) apply --dry-run=server -f "$$tmp" >/dev/null

.PHONY: seed-preprod
seed-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(REFRESH_OWNER_SCOPE_REF)" || { echo "REFRESH_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@set -o pipefail; $(K) create secret generic radar-refresh-keyring-bootstrap \
	  --from-file="$(KEYRING_SOURCE_DIR)" --dry-run=client -o yaml | $(K) apply -f -
	@set -o pipefail; $(K) create secret generic radar-refresh-runtime \
	  --from-literal=REFRESH_PRINCIPAL_REF=radar-refresh-pv-preprod \
	  --from-literal=REFRESH_OWNER_SCOPE_REF="$(REFRESH_OWNER_SCOPE_REF)" \
	  --dry-run=client -o yaml | $(K) apply -f -

.PHONY: apply-preprod
apply-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$(IMAGE_REF)" RENDER_OUT="$$tmp" ENV=preprod; \
	  $(K) apply -f "$$tmp"

.PHONY: validate-preprod
validate-preprod: guard-preprod
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$(IMAGE_REF)" RENDER_OUT="$$tmp" ENV=preprod; \
	  $(K) apply --dry-run=server -f "$$tmp" >/dev/null

.PHONY: trigger-preprod
trigger-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) create job "radar-refresh-pv-$(RUN_ID)" --from=cronjob/radar-refresh-pv

.PHONY: observe-scheduled-preprod
observe-scheduled-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@old_schedule="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.spec.schedule}')"; \
	  before="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.status.lastScheduleTime}')"; \
	  restore() { $(K) patch cronjob radar-refresh-pv --type=merge \
	    -p "{\"spec\":{\"schedule\":\"$$old_schedule\"}}" >/dev/null; }; \
	  trap restore EXIT; \
	  $(K) patch cronjob radar-refresh-pv --type=merge \
	    -p '{"spec":{"schedule":"* * * * *"}}' >/dev/null; \
	  current=""; \
	  for attempt in $$(seq 1 24); do \
	    current="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.status.lastScheduleTime}')"; \
	    test -n "$$current" -a "$$current" != "$$before" && break; \
	    sleep 5; \
	  done; \
	  test -n "$$current" -a "$$current" != "$$before" \
	    || { echo "CronJob controller did not schedule within 120 seconds" >&2; exit 1; }; \
	  if ! restore; then echo "Failed to restore the daily schedule" >&2; exit 1; fi; \
	  trap - EXIT; \
	  job="$$($(K) get jobs \
	    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.ownerReferences[0].name}{"\t"}{.metadata.creationTimestamp}{"\n"}{end}' \
	    | awk '$$2 == "radar-refresh-pv" { print }' | sort -k3 | tail -1 | cut -f1)"; \
	  test -n "$$job" || { echo "Scheduled Job owner reference not found" >&2; exit 1; }; \
	  $(K) wait --for=condition=complete "job/$$job" --timeout=1200s; \
	  $(K) get "job/$$job" -o custom-columns=NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].name,IMAGE:.spec.template.spec.containers[0].image,START:.status.startTime,END:.status.completionTime; \
	  $(K) logs "job/$$job" --all-containers=true

.PHONY: replace-zero-pod-preprod
replace-zero-pod-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@test -z "$$($(K) get pods -l "job-name=radar-refresh-pv-$(RUN_ID)" -o name)" \
	  || { echo "refusing to replace a Job that created a Pod" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" -o name >/dev/null
	@$(K) delete job "radar-refresh-pv-$(RUN_ID)" --wait=true
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

.PHONY: diagnose-preprod
diagnose-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" \
	  -o jsonpath='{range .status.conditions[*]}{.type}{"="}{.status}{" reason="}{.reason}{" message="}{.message}{"\n"}{end}'
	@$(K) get events --field-selector "involvedObject.name=radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=TIME:.lastTimestamp,TYPE:.type,REASON:.reason,MESSAGE:.message
	@$(K) get resourcequota preprod-cap -o jsonpath='requests.cpu={.status.used.requests\.cpu}/{.status.hard.requests\.cpu}{"\n"}limits.cpu={.status.used.limits\.cpu}/{.status.hard.limits\.cpu}{"\n"}requests.memory={.status.used.requests\.memory}/{.status.hard.requests\.memory}{"\n"}limits.memory={.status.used.limits\.memory}/{.status.hard.limits\.memory}{"\n"}'
