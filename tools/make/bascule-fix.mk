# Standalone entrypoint: never includes the root Makefile or an environment file.
SHELL := /bin/bash
unexport GIT_DIR GIT_WORK_TREE
export ENV FILES MSG
override MSG := $(value MSG)
.PHONY: bootstrap stage commit audit bundle test-operator test-workflow render check
verify:
	@rtk bash tools/make/bascule-fix-verify.sh
bootstrap stage commit audit bundle:
	@GIT_DIR="$(CURDIR)/tmp/bascule-fix-evidence/astra/backup.git" GIT_WORK_TREE="$(CURDIR)" rtk bash tools/make/bascule-fix-deliver.sh $@
qualification-identity:
	@rtk bash tools/make/bascule-fix-identity.sh
test-qualification:
	@rtk bash tools/make/bascule-fix-identity.test.sh
test-operator:
	@rtk bash tools/make/base-preprod-operator.test.sh
test-workflow:
	@rtk bash deploy/ci/check-release-sha.test.sh
	@rtk bash deploy/ci/rollback-release.test.sh
render:
	@rtk bash -ec 'mkdir -p tmp/bascule-fix-evidence/astra; kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod > tmp/bascule-fix-evidence/astra/preprod.yaml; kubectl kustomize deploy/k8s > tmp/bascule-fix-evidence/astra/prod.yaml'
	@rtk bash deploy/ci/check-image-entrypoints.sh
	@rtk bash deploy/ci/check-image-entrypoints.test.sh
	@rtk bash deploy/ci/check-h3-preprod-render.sh
review-catalog:
	@rtk bash -ec 'if [[ -n $${ANTHROPIC_BASE_URL:-} ]]; then curl -fsS --max-time 15 "$${ANTHROPIC_BASE_URL%/}/v1/models" | jq "[.data[].id]"; else echo "No live mesh catalog URL in this session"; fi'
check:
	@rtk bash -ec 'for file in tools/make/base-preprod*.sh tools/make/bascule-fix*.sh deploy/ci/check-release-sha.test.sh; do bash -n "$$file"; done; git diff --check'
