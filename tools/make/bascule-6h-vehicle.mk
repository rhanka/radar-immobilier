# Entrée locale isolée : aucune inclusion du Makefile racine ni de dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
unexport GIT_DIR GIT_WORK_TREE KUBECONFIG
export ENV
.PHONY: test-operator test-time check
test-operator:
	@[[ "$(ENV)" == test-* ]]
	@rtk bash tools/make/base-preprod-operator.test.sh
test-time:
	@[[ "$(ENV)" == test-* ]]
	@rtk bash tools/make/base-preprod-time.test.sh identity
	@rtk bash tools/make/base-preprod-time.test.sh rejection
check:
	@rtk bash -ec 'for file in tools/make/base-preprod*.sh; do bash -n "$$file"; done; git diff --check'
