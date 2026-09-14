.PHONY: object-storage-migration-test
object-storage-migration-test: ## Run the hermetic object-storage migration contract
	@bash -n deploy/ci/migrate-object-storage.sh \
	  deploy/ci/object-storage-checkpoint.sh \
	  deploy/ci/migrate-object-storage.hermetic.test.sh
	@bash deploy/ci/migrate-object-storage.hermetic.test.sh

.PHONY: object-storage-bindings-test
object-storage-bindings-test: ## Verify released bindings and reject retired storage entrypoints
	@bash deploy/ci/check-object-storage-bindings.test.sh

.PHONY: object-storage-docs-prod-provision
object-storage-docs-prod-provision: ## Verify or provision the dedicated PROD DOCS identity and Secret
	@if [ "$(ENV)" != "prod" ] || [ -z "$$KUBECONFIG" ] || \
	  [ -z "$$OVH_CLOUD_PROJECT_ID" ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, OVH_CLOUD_PROJECT_ID, ENV=prod'; \
	  exit 1; \
	fi
	@OBJECT_STORAGE_DOCS_PROD_PROVISION_CONFIRM="$(OBJECT_STORAGE_DOCS_PROD_PROVISION_CONFIRM)" \
	  KUBECTL="$(KUBECTL)" \
	  bash deploy/ci/provision-docs-prod.sh

OBJECT_STORAGE_DOCS_PROD_DIR := deploy/k8s/object-storage-docs-prod
OBJECT_STORAGE_DOCS_PROD_NAMESPACE := radar-immobilier
OBJECT_STORAGE_DOCS_PROD_SERVER := https://hlhedx.c1.bhs5.k8s.ovh.net
override OBJECT_STORAGE_DOCS_PROD_OFFICIAL_DIGEST := 52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425

.PHONY: object-storage-docs-prod-context
object-storage-docs-prod-context: ## Read the non-secret PROD context coordinates
	@server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  namespace="$$( $(KUBECTL) config view --minify -o jsonpath='{.contexts[0].context.namespace}' )"; \
	  jq -n --arg server "$$server" --arg namespace "$$namespace" '{server:$$server,namespace:$$namespace}'

.PHONY: object-storage-docs-prod-api-status
object-storage-docs-prod-api-status: ## Read only API storage references and rollout status
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) get deployment/radar-api -o json | jq \
	  '[.spec.template.spec.containers[] | select(.name == "api") | .env[]? | select(.name | startswith("S3_")) | {name,value,secret:.valueFrom.secretKeyRef.name,key:.valueFrom.secretKeyRef.key}]'
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) rollout status deployment/radar-api --timeout=60s

.PHONY: object-storage-docs-prod-validate
object-storage-docs-prod-validate: ## Validate PROD post-cutover support and retired migration Jobs offline
	@bash -n deploy/ci/migrate-object-storage.sh deploy/ci/object-storage-checkpoint.sh
	@bash -n deploy/ci/docs-api-rebind-patch.hermetic.test.sh
	@bash -n deploy/ci/docs-prod-parity-receipt.hermetic.test.sh
	@bash deploy/ci/docs-prod-runtime-secrets.hermetic.test.sh
	@bash deploy/ci/docs-api-rebind-patch.hermetic.test.sh
	@bash deploy/ci/docs-prod-parity-receipt.hermetic.test.sh
	@set -o pipefail; $(MAKE) --no-print-directory -n object-storage-minio-prod-finalize \
	  OBJECT_STORAGE_MINIO_PROD_FINALIZE_CONFIRM=1 \
	  OBJECT_STORAGE_DOCS_PROD_PARITY_JOB=radar-object-storage-copy-docs-prod-hermetic \
	  OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST=52646a7b56c16b912f889c9d8dec471ec0eadd0eb77de9b70056315c10ef0425 \
	  KUBECONFIG=/nonsecret/hermetic.kubeconfig ENV=prod | bash -n
	@node --check deploy/ci/inventory-docs-prod-fast.mjs
	@$(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	  $(OBJECT_STORAGE_DOCS_PROD_DIR) >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/api-rebind-patch.yaml -o name >/dev/null
	@for manifest in inventory-job.yaml fast-inventory-job.yaml \
	  conditional-proof-job.yaml copy-job.yaml; do \
	  test ! -e "$(OBJECT_STORAGE_DOCS_PROD_DIR)/$$manifest"; \
	done
	@! grep -Rqs 'radar-registry-pull' $(OBJECT_STORAGE_DOCS_PROD_DIR)
	@! grep -Eq '^object-storage-minio-prod-(scale-zero|remove):' deploy/ci/object-storage-prod.mk
	@for target in object-storage-docs-prod-bind object-storage-docs-prod-api-rebind \
	  object-storage-minio-prod-finalize; do \
	  ! $(MAKE) --no-print-directory "$$target" KUBECONFIG=/nonsecret/hermetic.kubeconfig \
	    OBJECT_STORAGE_DOCS_PROD_BIND_CONFIRM=1 OBJECT_STORAGE_DOCS_PROD_API_REBIND_CONFIRM=1 \
	    OBJECT_STORAGE_MINIO_PROD_FINALIZE_CONFIRM=1 \
	    OBJECT_STORAGE_DOCS_PROD_PARITY_JOB=radar-object-storage-copy-docs-prod-hermetic \
	    OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST=0000000000000000000000000000000000000000000000000000000000000000 \
	    ENV=prod >/dev/null 2>&1; \
	done

.PHONY: object-storage-docs-prod-fast-start
object-storage-docs-prod-fast-start: ## Retired after the OVH cutover
	@echo '[object-storage-docs-prod] retired: no legacy fast inventory can be started'; exit 1

.PHONY: object-storage-docs-prod-fast-progress
object-storage-docs-prod-fast-progress: ## Read aggregate canonical hash progress without keys
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  $(KUBECTL) -n "$$namespace" exec "$$pod" -- \
	    /bin/bash -ceu 'if [ -s /evidence/docs-prod-canonical/summary.json ]; then cat /evidence/docs-prod-canonical/summary.json; elif [ -s /evidence/docs-prod-canonical/progress.json ]; then cat /evidence/docs-prod-canonical/progress.json; else echo '\''{"hashedObjects":0,"hashedBytes":0}'\''; fi'

.PHONY: object-storage-docs-prod-fast-stop-readonly
object-storage-docs-prod-fast-stop-readonly: ## Stop one exact source-only PROD inventory Job
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_STOP_CONFIRM)" != 1 ] || \
	  [[ "$(OBJECT_STORAGE_DOCS_PROD_JOB)" != radar-object-storage-fast-inventory-docs-prod-* ]]; then \
	  echo '[object-storage-docs-prod] require exact Job, KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  $(KUBECTL) -n "$$namespace" get job/$(OBJECT_STORAGE_DOCS_PROD_JOB) -o json | \
	    jq -e '.status.active == 1 and any(.spec.template.spec.containers[]; .args[0] | contains("inventory-docs-prod-fast.mjs")) and all(.spec.template.spec.containers[].env[]?; .name | startswith("MIGRATION_DESTINATION_") | not)' >/dev/null; \
	  $(KUBECTL) -n "$$namespace" delete job/$(OBJECT_STORAGE_DOCS_PROD_JOB) \
	    --wait=true >/dev/null; \
	  echo '[object-storage-docs-prod] source-only inventory Job stopped'

.PHONY: object-storage-docs-prod-fetch-canonical
object-storage-docs-prod-fetch-canonical: ## Fetch the canonical manifests without printing keys
	@if [ -z "$$KUBECONFIG" ] || [ -z "$(OBJECT_STORAGE_DOCS_PROD_JOB)" ] || \
	  [ -z "$(OBJECT_STORAGE_DOCS_PROD_EVIDENCE_DIR)" ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, Job and evidence directory'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  destination="$(OBJECT_STORAGE_DOCS_PROD_EVIDENCE_DIR)"; \
	  [ ! -e "$$destination/source-manifest.jsonl" ]; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  mkdir -p "$$destination"; \
	  for file in source-manifest.jsonl canonical-manifest.json summary.json; do \
	    $(KUBECTL) -n "$$namespace" cp \
	      "$$pod:/evidence/docs-prod-canonical/$$file" "$$destination/$$file" >/dev/null; \
	  done; \
	  [ "$$(jq -s 'length' "$$destination/source-manifest.jsonl")" = 59017 ]; \
	  [ "$$(jq -s 'map(.size)|add' "$$destination/source-manifest.jsonl")" = 12534514457 ]; \
	  manifest_digest="$$(sha256sum "$$destination/source-manifest.jsonl" | awk '{print $$1}')"; \
	  [ "$$manifest_digest" = "$(OBJECT_STORAGE_DOCS_PROD_OFFICIAL_DIGEST)" ]; \
	  [ "$$manifest_digest" = "$$(jq -r '.manifestSha256' "$$destination/summary.json")" ]; \
	  jq '{objects,bytes,manifestSha256,canonicalSha256}' "$$destination/summary.json"

.PHONY: object-storage-docs-prod-proof
object-storage-docs-prod-proof: ## Retired after the OVH cutover
	@echo '[object-storage-docs-prod] retired: conditional-write migration proof is closed'; exit 1

.PHONY: object-storage-docs-prod-copy
object-storage-docs-prod-copy: ## Retired after the OVH cutover
	@echo '[object-storage-docs-prod] retired: canonical migration is closed by its final receipt'; exit 1

.PHONY: object-storage-docs-prod-copy-progress
object-storage-docs-prod-copy-progress: ## Read copy/parity progress without printing keys
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  $(KUBECTL) -n "$$namespace" exec "$$pod" -- /bin/bash -ceu \
	    'report=/evidence/reports/$${MIGRATION_RUN_ID}; if [ -s "$$report/summary.json" ]; then cat "$$report/summary.json"; elif [ -s "$$report/progress.json" ]; then cat "$$report/progress.json"; else echo '\''{"processed":0,"logicalBytes":0}'\''; fi'

.PHONY: object-storage-docs-prod-logs
object-storage-docs-prod-logs: ## Read one PROD object-storage Job log
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) \
	  logs job/$(OBJECT_STORAGE_DOCS_PROD_JOB) --all-containers=true

.PHONY: object-storage-docs-prod-copy-failures
object-storage-docs-prod-copy-failures: ## Aggregate PROD copy failures without printing keys
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  $(KUBECTL) -n "$$namespace" exec "$$pod" -- /bin/bash -ceu \
	    'report=/evidence/reports/$${MIGRATION_RUN_ID}/copy-ledger.json; node -e '\''const fs=require("node:fs"),items=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),counts={};for(const item of items)if(item.status==="failed")counts[item.reason]=(counts[item.reason]||0)+1;console.log(JSON.stringify(counts))'\'' "$$report"'

.PHONY: object-storage-docs-prod-bind
object-storage-docs-prod-bind: ## Bind future PROD DOCS workers after exact canonical parity
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_BIND_CONFIRM)" != 1 ] || \
	  [[ "$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB)" != radar-object-storage-copy-docs-prod-* ]] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" != "$(OBJECT_STORAGE_DOCS_PROD_OFFICIAL_DIGEST)" ]; then \
	  echo '[object-storage-docs-prod] require exact Job, digest, confirmation, KUBECONFIG, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  context_namespace="$$( $(KUBECTL) config view --minify -o jsonpath='{.contexts[0].context.namespace}' )"; \
	  [ -z "$$context_namespace" ] || [ "$$context_namespace" = "$$namespace" ]; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  summary="$$( $(KUBECTL) -n "$$namespace" exec "$$pod" -- /bin/bash -ceu \
	    'cat /evidence/reports/$${MIGRATION_RUN_ID}/summary.json' )"; \
	  jq -e --arg digest "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" \
	    -f deploy/ci/docs-parity-receipt.jq \
	    <<<"$$summary" >/dev/null; \
	  quota="$$( $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o json )"; \
	  jq -e '.status.hard.secrets == "15" and (.status.used.secrets == "13" or .status.used.secrets == "15")' \
	    <<<"$$quota" >/dev/null; \
	  source="$$( $(KUBECTL) -n "$$namespace" get secret/radar-docs-s3-credentials -o json )"; \
	  jq -e -f deploy/ci/validate-docs-secret.jq <<<"$$source" >/dev/null; \
	  jq -e '(.data.DOCS_S3_ENDPOINT | @base64d) == "https://s3.bhs.io.cloud.ovh.net" and (.data.DOCS_S3_REGION | @base64d) == "bhs" and (.data.DOCS_S3_BUCKET | @base64d) == "radar-immobilier-docs" and (.data.DOCS_S3_FORCE_PATH_STYLE | @base64d) == "false"' <<<"$$source" >/dev/null; \
	  if [ "$$(jq -r '.status.used.secrets' <<<"$$quota")" = 13 ]; then \
	    ! $(KUBECTL) -n "$$namespace" get secret/radar-graph-s3-credentials >/dev/null 2>&1; \
	    ! $(KUBECTL) -n "$$namespace" get secret/radar-scrape-s3-credentials >/dev/null 2>&1; \
	    jq -f deploy/ci/docs-prod-runtime-secrets.jq <<<"$$source" | \
	      $(KUBECTL) apply -f - >/dev/null; \
	  fi; \
	  runtime="$$( $(KUBECTL) -n "$$namespace" get secret/radar-docs-s3-credentials \
	    secret/radar-graph-s3-credentials secret/radar-scrape-s3-credentials -o json )"; \
	  jq -e 'INDEX(.items[];.metadata.name) as $$s | ($$s["radar-docs-s3-credentials"].data) as $$d | ($$s["radar-graph-s3-credentials"].data == {GRAPH_S3_ACCESS_KEY:$$d.DOCS_S3_ACCESS_KEY,GRAPH_S3_SECRET_KEY:$$d.DOCS_S3_SECRET_KEY}) and ($$s["radar-scrape-s3-credentials"].data == {SCRAPE_S3_ACCESS_KEY:$$d.DOCS_S3_ACCESS_KEY,SCRAPE_S3_SECRET_KEY:$$d.DOCS_S3_SECRET_KEY})' \
	    <<<"$$runtime" >/dev/null; \
	  $(KUBECTL) -n "$$namespace" patch configmap/radar-api --type=merge \
	    -p '{"data":{"GRAPH_S3_ENDPOINT":"https://s3.bhs.io.cloud.ovh.net","GRAPH_S3_REGION":"bhs","GRAPH_S3_BUCKET":"radar-immobilier-docs","GRAPH_S3_FORCE_PATH_STYLE":"false","SCRAPE_S3_ENDPOINT":"https://s3.bhs.io.cloud.ovh.net","SCRAPE_S3_REGION":"bhs","SCRAPE_S3_BUCKET":"radar-immobilier-docs","SCRAPE_S3_FORCE_PATH_STYLE":"false"}}' >/dev/null; \
	  $(KUBECTL) -n "$$namespace" get configmap/radar-api -o json | jq -e \
	    '.data.GRAPH_S3_ENDPOINT == "https://s3.bhs.io.cloud.ovh.net" and .data.GRAPH_S3_REGION == "bhs" and .data.GRAPH_S3_BUCKET == "radar-immobilier-docs" and .data.GRAPH_S3_FORCE_PATH_STYLE == "false" and .data.SCRAPE_S3_ENDPOINT == "https://s3.bhs.io.cloud.ovh.net" and .data.SCRAPE_S3_REGION == "bhs" and .data.SCRAPE_S3_BUCKET == "radar-immobilier-docs" and .data.SCRAPE_S3_FORCE_PATH_STYLE == "false"' >/dev/null; \
	  for _ in $$(seq 1 30); do \
	    used="$$( $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o jsonpath='{.status.used.secrets}' )"; \
	    [ "$$used" = 15 ] && break; sleep 1; \
	  done; \
	  [ "$$used" = 15 ]; \
	  echo '[object-storage-docs-prod] graph/scrape credentials bound; Secret quota hard=15 used=15'

.PHONY: object-storage-docs-prod-api-rebind
object-storage-docs-prod-api-rebind: ## Roll PROD API from SCW to canonical OVH DOCS
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_API_REBIND_CONFIRM)" != 1 ] || \
	  [[ "$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB)" != radar-object-storage-copy-docs-prod-* ]] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" != "$(OBJECT_STORAGE_DOCS_PROD_OFFICIAL_DIGEST)" ]; then \
	  echo '[object-storage-docs-prod] require exact parity Job/digest, confirmation, KUBECONFIG, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  summary="$$( $(KUBECTL) -n "$$namespace" logs \
	    job/$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB) --all-containers=true | tail -n 1 )"; \
	  jq -e --arg digest "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" \
	    -f deploy/ci/docs-parity-receipt.jq \
	    <<<"$$summary" >/dev/null; \
	  source="$$( $(KUBECTL) -n "$$namespace" get secret/radar-docs-s3-credentials -o json )"; \
	  jq -e -f deploy/ci/validate-docs-secret.jq <<<"$$source" >/dev/null; \
	  jq -e '(.data.DOCS_S3_ENDPOINT | @base64d) == "https://s3.bhs.io.cloud.ovh.net" and (.data.DOCS_S3_REGION | @base64d) == "bhs" and (.data.DOCS_S3_BUCKET | @base64d) == "radar-immobilier-docs" and (.data.DOCS_S3_FORCE_PATH_STYLE | @base64d) == "false"' <<<"$$source" >/dev/null; \
	  $(KUBECTL) -n "$$namespace" patch deployment/radar-api --type=strategic --dry-run=server \
	    --patch-file $(OBJECT_STORAGE_DOCS_PROD_DIR)/api-rebind-patch.yaml >/dev/null; \
	  echo '[object-storage-docs-prod] API rebind server dry-run passed'; \
	  $(KUBECTL) -n "$$namespace" patch deployment/radar-api --type=strategic \
	    --patch-file $(OBJECT_STORAGE_DOCS_PROD_DIR)/api-rebind-patch.yaml >/dev/null; \
	  $(KUBECTL) -n "$$namespace" rollout status deployment/radar-api --timeout=180s >/dev/null; \
	  deployment="$$( $(KUBECTL) -n "$$namespace" get deployment/radar-api -o json )"; \
	  jq -e -f deploy/ci/docs-api-ovh-binding.jq <<<"$$deployment" >/dev/null; \
	  jq -e 'any(.spec.template.spec.containers[] | select(.name == "api") | .env[]?; .name == "SCW_TEM_SECRET_KEY" and .valueFrom.secretKeyRef.name == "radar-tem-credentials")' \
	    <<<"$$deployment" >/dev/null; \
	  echo '[object-storage-docs-prod] API rolled to canonical OVH DOCS; TEM preserved'

.PHONY: object-storage-docs-prod-expand-pvc-quota
object-storage-docs-prod-expand-pvc-quota: ## Guardedly expand only the PROD PVC count quota from 2 to 3
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_QUOTA_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  [ "$$server" = "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ] || \
	    { echo '[object-storage-docs-prod] refused non-OVH context'; exit 1; }; \
	  quota="$$( $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o json )"; \
	  jq -e '(.status.hard | has("requests.storage") | not) and (.spec.hard | has("requests.storage") | not) and .status.used.persistentvolumeclaims == "2" and (.status.hard.persistentvolumeclaims == "2" or .status.hard.persistentvolumeclaims == "3")' <<<"$$quota" >/dev/null; \
	  if [ "$$(jq -r '.status.hard.persistentvolumeclaims' <<<"$$quota")" = 2 ]; then \
	    $(KUBECTL) -n "$$namespace" patch resourcequota/tenant-quota --type=merge \
	      -p '{"spec":{"hard":{"persistentvolumeclaims":"3"}}}' >/dev/null; \
	  fi; \
	  $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o json | \
	    jq -e '.status.hard.persistentvolumeclaims == "3" and (.status.hard | has("requests.storage") | not)' >/dev/null; \
	  echo '[object-storage-docs-prod] PVC quota hard=3; absent storage quota unchanged'

.PHONY: object-storage-docs-prod-quota-status
object-storage-docs-prod-quota-status: ## Read safe PROD quota coordinates only
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) \
	  get resourcequota/tenant-quota -o json | \
	  jq '{hard:.status.hard,used:.status.used}'

.PHONY: object-storage-docs-prod-final-status
object-storage-docs-prod-final-status: ## Prove PROD DOCS binding and MinIO absence without Secret values
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  ! $(KUBECTL) -n "$$namespace" get statefulset/radar-minio >/dev/null 2>&1; \
	  ! $(KUBECTL) -n "$$namespace" get service/radar-minio >/dev/null 2>&1; \
	  ! $(KUBECTL) -n "$$namespace" get pvc/minio-data-radar-minio-0 >/dev/null 2>&1; \
	  ! $(KUBECTL) -n "$$namespace" get networkpolicy/allow-api-to-minio >/dev/null 2>&1; \
	  $(KUBECTL) -n "$$namespace" get pvc/radar-object-storage-docs-prod-checkpoint -o json | \
	    jq -e '.status.phase == "Bound" and .status.capacity.storage == "1Gi"' >/dev/null; \
	  $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o json | \
	    jq -e '.status.hard.secrets == "15" and .status.used.secrets == "15" and .status.hard.persistentvolumeclaims == "3" and .status.used.persistentvolumeclaims == "2"' >/dev/null; \
	  runtime="$$( $(KUBECTL) -n "$$namespace" get secret/radar-docs-s3-credentials \
	    secret/radar-graph-s3-credentials secret/radar-scrape-s3-credentials -o json )"; \
	  jq -e 'INDEX(.items[];.metadata.name) as $$s | ($$s["radar-docs-s3-credentials"].data) as $$d | ((($$d.DOCS_S3_ENDPOINT | @base64d) == "https://s3.bhs.io.cloud.ovh.net") and (($$d.DOCS_S3_REGION | @base64d) == "bhs") and (($$d.DOCS_S3_BUCKET | @base64d) == "radar-immobilier-docs") and (($$d.DOCS_S3_FORCE_PATH_STYLE | @base64d) == "false")) and ($$s["radar-graph-s3-credentials"].data == {GRAPH_S3_ACCESS_KEY:$$d.DOCS_S3_ACCESS_KEY,GRAPH_S3_SECRET_KEY:$$d.DOCS_S3_SECRET_KEY}) and ($$s["radar-scrape-s3-credentials"].data == {SCRAPE_S3_ACCESS_KEY:$$d.DOCS_S3_ACCESS_KEY,SCRAPE_S3_SECRET_KEY:$$d.DOCS_S3_SECRET_KEY})' \
	    <<<"$$runtime" >/dev/null; \
	  $(KUBECTL) -n "$$namespace" get configmap/radar-api -o json | jq -e \
	    '.data.GRAPH_S3_BUCKET == "radar-immobilier-docs" and .data.SCRAPE_S3_BUCKET == "radar-immobilier-docs" and .data.SCW_TEM_API_BASE_URL == "https://api.scaleway.com"' >/dev/null; \
	  deployment="$$( $(KUBECTL) -n "$$namespace" get deployment/radar-api -o json )"; \
	  jq -e -f deploy/ci/docs-api-ovh-binding.jq <<<"$$deployment" >/dev/null; \
	  jq -e 'any(.spec.template.spec.containers[] | select(.name == "api") | .env[]?; .name == "SCW_TEM_SECRET_KEY" and .valueFrom.secretKeyRef.name == "radar-tem-credentials" and .valueFrom.secretKeyRef.key == "SCW_TEM_SECRET_KEY")' \
	    <<<"$$deployment" >/dev/null; \
	  $(KUBECTL) -n "$$namespace" get secret/radar-tem-credentials >/dev/null; \
	  $(KUBECTL) -n "$$namespace" rollout status deployment/radar-api --timeout=60s >/dev/null; \
	  jq -n '{minio:{statefulSet:false,service:false,pvc:false},checkpoint:{phase:"Bound",capacity:"1Gi"},quota:{secrets:{hard:15,used:15},pvcs:{hard:3,used:2}},docs:{bucket:"radar-immobilier-docs",graphBinding:true,scrapeBinding:true},tem:{apiBase:"https://api.scaleway.com",secretReference:"radar-tem-credentials",preserved:true}}'

.PHONY: object-storage-docs-prod-start
object-storage-docs-prod-start: ## Retired after the OVH cutover
	@echo '[object-storage-docs-prod] retired: no legacy PROD inventory can be started'; exit 1

.PHONY: object-storage-docs-prod-progress
object-storage-docs-prod-progress: ## Report aggregate PROD DOCS checkpoint progress without keys
	@if [ -z "$$KUBECONFIG" ] || [ -z "$(OBJECT_STORAGE_DOCS_PROD_JOB)" ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG and OBJECT_STORAGE_DOCS_PROD_JOB'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  [ -n "$$pod" ] || { echo '[object-storage-docs-prod] Job Pod is absent'; exit 1; }; \
	  started="$$( $(KUBECTL) -n "$$namespace" get job/$(OBJECT_STORAGE_DOCS_PROD_JOB) \
	    -o jsonpath='{.metadata.creationTimestamp}' )"; \
	  elapsed="$$(( $$(date +%s) - $$(date -d "$$started" +%s) ))"; \
	  $(KUBECTL) -n "$$namespace" exec "$$pod" -- /bin/bash -ceu \
	    'shopt -s nullglob; index=(/evidence/docs-prod-checkpoint/provisional/source/index-receipt-*.json); body=(/evidence/docs-prod-checkpoint/provisional/source/body-receipt-*.json); jq -n --argjson elapsed '"$$elapsed"' --slurpfile index <(cat "$${index[@]}" 2>/dev/null || true) --slurpfile body <(cat "$${body[@]}" 2>/dev/null || true) '\''def metric($$items): {shards:($$items|length),objects:($$items|map(.objects)|add//0),bytes:($$items|map(.bytes)|add//0)}; {phase:"provisional",side:"source",elapsedSeconds:$$elapsed,index:metric($$index),body:metric($$body)} | . + {hashOpsPerSecond:(.body.objects / ($$elapsed|if .>0 then . else 1 end)),hashMiBPerSecond:(.body.bytes / 1048576 / ($$elapsed|if .>0 then . else 1 end))}'\'''

.PHONY: object-storage-docs-prod-status
object-storage-docs-prod-status: ## Read the PROD DOCS inventory Job and Pod status
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) get \
	  job/$(OBJECT_STORAGE_DOCS_PROD_JOB) -o wide
	@$(KUBECTL) -n $(OBJECT_STORAGE_DOCS_PROD_NAMESPACE) get pods \
	  -l 'job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)' -o wide

.PHONY: object-storage-docs-prod-runtime
object-storage-docs-prod-runtime: ## Read aggregate PROD Job runtime health without object keys
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  $(KUBECTL) -n "$$namespace" get pod/"$$pod" -o json | jq \
	    '{phase:.status.phase,podIP:.status.podIP,startedAt:.status.startTime,conditions:[.status.conditions[]|{type,status,reason}],containers:[.status.containerStatuses[]|{name,ready,restartCount,started:.state.running.startedAt,waiting:.state.waiting.reason,terminated:.state.terminated.reason}]}' ; \
	  $(KUBECTL) -n "$$namespace" top pod "$$pod"

.PHONY: object-storage-minio-prod-finalize
object-storage-minio-prod-finalize: ## Idempotently finalize PROD MinIO absence after canonical parity
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_MINIO_PROD_FINALIZE_CONFIRM)" != 1 ] || \
	  [[ "$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB)" != radar-object-storage-copy-docs-prod-* ]] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" != "$(OBJECT_STORAGE_DOCS_PROD_OFFICIAL_DIGEST)" ]; then \
	  echo '[object-storage-minio-prod] require exact parity Job/digest, confirmation, KUBECONFIG, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  summary="$$( $(KUBECTL) -n "$$namespace" logs \
	    job/$(OBJECT_STORAGE_DOCS_PROD_PARITY_JOB) --all-containers=true | tail -n 1 )"; \
	  jq -e --arg digest "$(OBJECT_STORAGE_DOCS_PROD_CANONICAL_DIGEST)" \
	    -f deploy/ci/docs-parity-receipt.jq \
	    <<<"$$summary" >/dev/null; \
	  ! $(KUBECTL) -n "$$namespace" get statefulset/radar-minio >/dev/null 2>&1; \
	  ! $(KUBECTL) -n "$$namespace" get service/radar-minio >/dev/null 2>&1; \
	  ! $(KUBECTL) -n "$$namespace" get pvc/minio-data-radar-minio-0 >/dev/null 2>&1; \
	  policy="$$( $(KUBECTL) -n "$$namespace" get networkpolicy/allow-api-to-minio \
	    --ignore-not-found -o json )"; \
	  if [ -n "$$policy" ]; then \
	    jq -e '.spec.podSelector.matchLabels["app.kubernetes.io/component"] == "minio"' <<<"$$policy" >/dev/null; \
	    $(KUBECTL) -n "$$namespace" delete networkpolicy/allow-api-to-minio --wait=true >/dev/null; \
	  fi; \
	  ! $(KUBECTL) -n "$$namespace" get networkpolicy/allow-api-to-minio >/dev/null 2>&1; \
	  $(KUBECTL) -n "$$namespace" get configmap/radar-api -o json | \
	    jq -e '.data.SCW_TEM_API_BASE_URL == "https://api.scaleway.com"' >/dev/null; \
	  echo '[object-storage-minio-prod] removed orphan NetworkPolicy/allow-api-to-minio; TEM preserved'
