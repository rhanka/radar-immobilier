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
	@node --check deploy/ci/inventory-docs-prod-fast.mjs
	@$(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	  $(OBJECT_STORAGE_DOCS_PROD_DIR) >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/inventory-job.yaml -o name >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/fast-inventory-job.yaml -o name >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/conditional-proof-job.yaml -o name >/dev/null
	@$(KUBECTL) create --dry-run=client --validate=false \
	  -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/copy-job.yaml -o name >/dev/null
	@! grep -Eq '(^|[[:space:]])jq([[:space:]]|$$)' \
	  $(OBJECT_STORAGE_DOCS_PROD_DIR)/copy-job.yaml

.PHONY: object-storage-docs-prod-fast-start
object-storage-docs-prod-fast-start: ## Start the low-memory canonical PROD inventory
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_FAST_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@$(MAKE) object-storage-docs-prod-validate KUBECTL="$(KUBECTL)" ENV=$(ENV)
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  [ "$$server" = "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ] || \
	    { echo '[object-storage-docs-prod] refused non-OVH context'; exit 1; }; \
	  render="$$(mktemp)"; trap 'rm -f "$$render"' EXIT; \
	  $(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	    $(OBJECT_STORAGE_DOCS_PROD_DIR) >"$$render"; \
	  $(KUBECTL) apply -f "$$render" >/dev/null; \
	  $(KUBECTL) create -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/fast-inventory-job.yaml -o name

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
	  [ "$$(sha256sum "$$destination/source-manifest.jsonl" | awk '{print $$1}')" = \
	    "$$(jq -r '.manifestSha256' "$$destination/summary.json")" ]; \
	  jq '{objects,bytes,manifestSha256,canonicalSha256}' "$$destination/summary.json"

.PHONY: object-storage-docs-prod-proof
object-storage-docs-prod-proof: ## Prove conditional OVH writes for the canonical PROD target
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_PROOF_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@$(MAKE) object-storage-docs-prod-validate KUBECTL="$(KUBECTL)" ENV=$(ENV)
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  render="$$(mktemp)"; trap 'rm -f "$$render"' EXIT; \
	  $(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	    $(OBJECT_STORAGE_DOCS_PROD_DIR) >"$$render"; \
	  $(KUBECTL) apply -f "$$render" >/dev/null; \
	  job_ref="$$( $(KUBECTL) create \
	    -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/conditional-proof-job.yaml -o name )"; \
	  $(KUBECTL) -n "$$namespace" wait --for=condition=complete "$$job_ref" \
	    --timeout=900s >/dev/null; echo "$$job_ref"

.PHONY: object-storage-docs-prod-copy
object-storage-docs-prod-copy: ## Start the exact canonical copy to OVH PROD
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_DOCS_PROD_COPY_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-docs-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@$(MAKE) object-storage-docs-prod-validate KUBECTL="$(KUBECTL)" ENV=$(ENV)
	@set -euo pipefail; \
	  [ "$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )" = \
	    "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ]; \
	  render="$$(mktemp)"; trap 'rm -f "$$render"' EXIT; \
	  $(KUBECTL) kustomize --load-restrictor LoadRestrictionsNone \
	    $(OBJECT_STORAGE_DOCS_PROD_DIR) >"$$render"; \
	  $(KUBECTL) apply -f "$$render" >/dev/null; \
	  $(KUBECTL) create -f $(OBJECT_STORAGE_DOCS_PROD_DIR)/copy-job.yaml -o name

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

.PHONY: object-storage-minio-prod-scale-zero
object-storage-minio-prod-scale-zero: ## Scale only the proven-empty, unconsumed PROD MinIO to zero
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_MINIO_PROD_SCALE_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-minio-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  [ "$$server" = "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ] || \
	    { echo '[object-storage-minio-prod] refused non-OVH context'; exit 1; }; \
	  replicas="$$( $(KUBECTL) -n "$$namespace" get statefulset/radar-minio \
	    -o jsonpath='{.spec.replicas}' )"; \
	  if [ "$$replicas" = 1 ]; then \
	    buckets="$$( $(KUBECTL) -n "$$namespace" exec radar-minio-0 -- /bin/sh -ceu \
	      'mc alias set local http://127.0.0.1:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" >/dev/null; mc ls --json local' )"; \
	    [ -z "$$buckets" ] || { echo '[object-storage-minio-prod] MinIO is not empty'; exit 1; }; \
	    $(KUBECTL) -n "$$namespace" get deployment/radar-api -o json | \
	      jq -e 'any(.spec.template.spec.containers[].env[]?; .name == "S3_ENDPOINT" and .value == "https://s3.fr-par.scw.cloud")' >/dev/null; \
	    [ "$$( $(KUBECTL) -n "$$namespace" get cronjobs -o json | jq '.items|length' )" = 0 ]; \
	    $(KUBECTL) -n "$$namespace" scale statefulset/radar-minio --replicas=0 >/dev/null; \
	    $(KUBECTL) -n "$$namespace" wait --for=delete pod/radar-minio-0 \
	      --timeout=120s >/dev/null; \
	  else [ "$$replicas" = 0 ]; fi; \
	  echo '[object-storage-minio-prod] empty unconsumed MinIO replicas=0'

.PHONY: object-storage-minio-prod-remove
object-storage-minio-prod-remove: ## Remove the proven-empty, unconsumed PROD MinIO resources
	@if [ "$(ENV)" != prod ] || [ -z "$$KUBECONFIG" ] || \
	  [ "$(OBJECT_STORAGE_MINIO_PROD_REMOVE_CONFIRM)" != 1 ]; then \
	  echo '[object-storage-minio-prod] require KUBECONFIG, confirmation, ENV=prod'; exit 1; \
	fi
	@set -euo pipefail; namespace="$(OBJECT_STORAGE_DOCS_PROD_NAMESPACE)"; \
	  server="$$( $(KUBECTL) config view --minify -o jsonpath='{.clusters[0].cluster.server}' )"; \
	  [ "$$server" = "$(OBJECT_STORAGE_DOCS_PROD_SERVER)" ] || \
	    { echo '[object-storage-minio-prod] refused non-OVH context'; exit 1; }; \
	  buckets="$$( $(KUBECTL) -n "$$namespace" exec radar-minio-0 -- /bin/sh -ceu \
	    'mc alias set local http://127.0.0.1:9000 "$$MINIO_ROOT_USER" "$$MINIO_ROOT_PASSWORD" >/dev/null; mc ls --json local' )"; \
	  [ -z "$$buckets" ] || { echo '[object-storage-minio-prod] MinIO is not empty'; exit 1; }; \
	  $(KUBECTL) -n "$$namespace" get deployment/radar-api -o json | \
	    jq -e 'any(.spec.template.spec.containers[].env[]?; .name == "S3_ENDPOINT" and .value == "https://s3.fr-par.scw.cloud")' >/dev/null; \
	  [ "$$( $(KUBECTL) -n "$$namespace" get cronjobs -o json | jq '.items|length' )" = 0 ]; \
	  claim=minio-data-radar-minio-0; \
	  [ "$$( $(KUBECTL) -n "$$namespace" get pvc/$$claim -o jsonpath='{.status.capacity.storage}' )" = 5Gi ]; \
	  $(KUBECTL) -n "$$namespace" delete statefulset/radar-minio service/radar-minio \
	    --wait=true >/dev/null; \
	  $(KUBECTL) -n "$$namespace" delete pvc/$$claim --wait=true >/dev/null; \
	  ! $(KUBECTL) -n "$$namespace" get statefulset/radar-minio service/radar-minio \
	    pvc/$$claim >/dev/null 2>&1; \
	  echo '[object-storage-minio-prod] removed empty StatefulSet, Service and 5Gi PVC'
