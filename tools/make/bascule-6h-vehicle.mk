# Entrée locale isolée : aucune inclusion du Makefile racine ni de dotenv.
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
unexport GIT_DIR GIT_WORK_TREE
export KUBECONFIG := /dev/null
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
.PHONY: test test-paths test-probe rehearse
test: test-operator test-time test-paths test-probe
test-paths:
	@rtk bash tools/make/base-preprod-paths.test.sh
test-probe:
	@rtk bash tools/make/base-preprod-probe.test.sh
rehearse: test-paths
	@rtk bash tools/make/base-preprod-rehearse.sh
.PHONY: test-context test-freeze-time
test: test-context test-freeze-time
test-context:
	@[[ "$(ENV)" == test-* ]]
	@rtk bash tools/make/base-preprod-context.test.sh
test-freeze-time:
	@[[ "$(ENV)" == test-* ]]
	@rtk bash tools/make/base-preprod-freeze-time.test.sh fractions
	@rtk bash tools/make/base-preprod-freeze-time.test.sh invalid
	@rtk bash tools/make/base-preprod-freeze-time.test.sh recovery
.PHONY: test-reclose-mutations
test-reclose-mutations:
	@[[ "$(ENV)" == test-* ]]
	@rtk bash tools/make/base-preprod-reclose-mutations.sh
