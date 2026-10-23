# BASE isolated entry points (B0). Standalone file: it reads no environment
# files and delegates nothing upward. Every invocation supplies all three
# ports with ENV last, e.g.:
#   make -f tools/make/base-api.mk base-api-test API_PORT=18910 UI_PORT=15910 MAILDEV_UI_PORT=11910 ENV=test-base-api-b0
ENV ?= test-base-api-b0
BASE_API_SOURCE ?= worktree
API_PORT ?= 18910
UI_PORT ?= 15910
MAILDEV_UI_PORT ?= 11910
BASE_API_MK := $(lastword $(MAKEFILE_LIST))
export ENV API_PORT UI_PORT MAILDEV_UI_PORT SCOPE MSG FILES OUT SLUG BRANCH START SRC RECEIPT BASE_API_SCOPE
export BASE_API_SOURCE
BASE_API_ARGS = "API_PORT=$$API_PORT" "UI_PORT=$$UI_PORT" "MAILDEV_UI_PORT=$$MAILDEV_UI_PORT" "ENV=$$ENV"
BASE_API_SCOPE := src/services/facets/scoped-db.test.ts src/services/facets/workspace-receipts-db.test.ts src/services/facets/projection-migration-db.test.ts src/routes/scoped-projection-events-db.test.ts

.PHONY: base-api-check-scope base-api-typecheck base-api-lint base-api-test
.PHONY: base-api-test-api base-api-mutation-proof base-api-input-guards
.PHONY: base-api-stage base-api-commit base-api-audit base-api-bundle
.PHONY: base-api-worktree base-api-integrate base-api-clean base-api-runner-proof
.PHONY: base-api-verify
.PHONY: base-api-contract-proof
.PHONY: base-api-network-proof

base-api-network-proof:
	rtk bash tools/make/base-api-verify.sh network-proof $(BASE_API_ARGS)

base-api-contract-proof:
	rtk bash tools/make/base-api-contract-proof.sh $(BASE_API_ARGS)

base-api-verify:
	rtk bash tools/make/base-api-verify.sh verify "SCOPE=$$BASE_API_SCOPE" $(BASE_API_ARGS)

base-api-check-scope:
	rtk bash tools/make/base-api-verify.sh check-scope $(BASE_API_ARGS)

base-api-typecheck:
	rtk bash tools/make/base-api-verify.sh typecheck $(BASE_API_ARGS)

base-api-lint:
	rtk bash tools/make/base-api-verify.sh lint $(BASE_API_ARGS)

base-api-test:
	rtk bash tools/make/base-api-verify.sh test "SCOPE=$$BASE_API_SCOPE" $(BASE_API_ARGS)

base-api-test-api:
	rtk bash tools/make/base-api-verify.sh test-api "SCOPE=$$SCOPE" $(BASE_API_ARGS)

base-api-mutation-proof:
	rtk bash tools/make/base-api-mutation.sh $(BASE_API_ARGS)

base-api-input-guards:
	rtk bash tools/make/base-api-verify.sh input-guards $(BASE_API_ARGS)

base-api-runner-proof:
	rtk bash tools/make/base-api-runner-proof.sh $(BASE_API_ARGS)

base-api-stage:
	rtk bash tools/make/base-api-deliver.sh stage "FILES=$$FILES" $(BASE_API_ARGS)

base-api-commit:
	rtk bash tools/make/base-api-deliver.sh commit "MSG=$$MSG" $(BASE_API_ARGS)

base-api-audit:
	rtk bash tools/make/base-api-deliver.sh audit $(BASE_API_ARGS)

base-api-bundle:
	rtk bash tools/make/base-api-deliver.sh bundle "OUT=$$OUT" $(BASE_API_ARGS)

base-api-worktree:
	rtk bash tools/make/base-api-deliver.sh worktree "SLUG=$$SLUG" "BRANCH=$$BRANCH" "START=$$START" $(BASE_API_ARGS)

base-api-integrate:
	rtk bash tools/make/base-api-deliver.sh integrate "SRC=$$SRC" "RECEIPT=$$RECEIPT" $(BASE_API_ARGS)

base-api-clean:
	rtk bash tools/make/base-api-verify.sh clean $(BASE_API_ARGS)
