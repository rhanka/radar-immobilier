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
