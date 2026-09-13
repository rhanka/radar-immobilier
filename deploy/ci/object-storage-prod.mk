.PHONY: object-storage-migration-test
object-storage-migration-test: ## Run the hermetic object-storage migration contract
	@bash -n deploy/ci/migrate-object-storage.sh \
	  deploy/ci/object-storage-checkpoint.sh \
	  deploy/ci/migrate-object-storage.hermetic.test.sh
	@bash deploy/ci/migrate-object-storage.hermetic.test.sh

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

.PHONY: object-storage-docs-prod-validate
object-storage-docs-prod-validate: ## Validate the PROD DOCS support and inventory Job offline
	@bash -n deploy/ci/migrate-object-storage.sh deploy/ci/object-storage-checkpoint.sh
	@$(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	  $(OBJECT_STORAGE_DOCS_PROD_DIR) >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/inventory-job.yaml -o name >/dev/null

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

.PHONY: object-storage-docs-prod-start
object-storage-docs-prod-start: ## Create the resumable PROD DOCS inventory Job
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_INVENTORY_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@$(MAKE) object-storage-docs-prod-validate KUBECTL="$(KUBECTL)" ENV=$(ENV)
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  [ "$$server" = "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ] || \
	    { echo '[object-storage-docs-prod] refused non-OVH context'; exit 1; }; \
	  $(KUBECTL) -n "$$namespace" get secret/radar-docs-s3-credentials -o json | \
	    jq -e -f deploy/ci/validate-docs-secret.jq >/dev/null; \
	  render="$$(mktemp)"; trap 'rm -f "$$render"' EXIT; \
	  $(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	    $(OBJECT_STORAGE_DOCS_PROD_DIR) >"$$render"; \
	  $(KUBECTL) apply -f "$$render" >/dev/null; \
	  phase="$$( $(KUBECTL) -n "$$namespace" get \
	    pvc/radar-object-storage-docs-prod-checkpoint -o jsonpath='{.status.phase}' )"; \
	  [[ "$$phase" =~ ^(Pending|Bound)$$ ]] || \
	    { echo '[object-storage-docs-prod] checkpoint PVC has an invalid phase'; exit 1; }; \
	  $(KUBECTL) -n "$$namespace" get resourcequota/tenant-quota -o json | \
	    jq -e '.status.hard.persistentvolumeclaims == "3" and .status.used.persistentvolumeclaims == "3" and (.status.hard | has("requests.storage") | not)' >/dev/null; \
	  job_ref="$$( $(KUBECTL) create -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/inventory-job.yaml -o name )"; \
	  job="$${job_ref#job.batch/}"; \
	  $(KUBECTL) -n "$$namespace" wait --for=condition=PodScheduled \
	    pod -l "job-name=$$job" --timeout=120s >/dev/null; \
	  $(KUBECTL) -n "$$namespace" wait --for=jsonpath='{.status.phase}'=Bound \
	    pvc/radar-object-storage-docs-prod-checkpoint --timeout=120s >/dev/null; \
	  echo "$$job_ref"

.PHONY: object-storage-docs-prod-progress
object-storage-docs-prod-progress: ## Report aggregate PROD DOCS checkpoint progress without keys
	@if [ -z "$$KUBECONFIG" ] || [ -z "$(OBJECT_STORAGE_DOCS_PROD_JOB)" ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG and OBJECT_STORAGE_DOCS_PROD_JOB'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  pod="$$( $(KUBECTL) -n "$$namespace" get pods \
	    -l "job-name=$(OBJECT_STORAGE_DOCS_PROD_JOB)" -o jsonpath='{.items[0].metadata.name}' )"; \
	  [ -n "$$pod" ] || { echo '[object-storage-docs-prod] Job Pod is absent'; exit 1; }; \
	  $(KUBECTL) -n "$$namespace" exec "$$pod" -- /bin/bash -ceu \
	    'shopt -s nullglob; files=(/evidence/docs-prod-checkpoint/provisional/source/body-receipt-*.json); if [ "$${#files[@]}" -eq 0 ]; then jq -n '\''{phase:"provisional",side:"source",objects:0,bytes:0}'\''; else jq -s '\''{phase:"provisional",side:"source",shards:length,objects:(map(.objects)|add//0),bytes:(map(.bytes)|add//0)}'\'' "$${files[@]}"; fi'
