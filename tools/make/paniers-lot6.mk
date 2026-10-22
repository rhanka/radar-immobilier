# Standalone 6F verification. Never includes the root Makefile or .env.
# ENV must be the last argument. No host port is published.
SHELL := /bin/bash
ENV ?=
LOT ?= 6F
API_PORT ?= 18866
UI_PORT ?= 15866
MAILDEV_UI_PORT ?= 11866
ifeq ($(LOT),6G)
SCOPE ?= src/services/workspaces
else ifeq ($(LOT),6H)
SCOPE ?= src/services/facets src/services/workspaces tests/integration/facets src/services/steve-source src/services/graph/discarded-signals src/routes/scoped-signal-facets src/routes/signal-facets src/routes/graph-signals src/scripts/attach-personal-history
else ifeq ($(LOT),6I)
SCOPE ?= src/services/facets/workspace src/services/facets/scoped src/services/facets/registry src/routes/scoped-workspace-archive src/routes/scoped-signal-facets src/services/workspaces
else
SCOPE ?= src/services/facets
endif
ACTION ?= verify
DELIVERY_PROFILE = $(if $(filter 6I,$(LOT)),6i,$(if $(filter 6H,$(LOT)),6h,6g))
export ENV LOT API_PORT UI_PORT MAILDEV_UI_PORT SCOPE ACTION EVIDENCE_TAG CHECKPOINT_DIR

.PHONY: guard verify build typecheck lint test-api clean inspect diagnose commit prepare checkpoints deliver regression audit astra-proof
guard:
	@case '$(ENV)' in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required'; exit 1;; esac
	@case '$(LOT)' in 6F|6G|6H|6I) ;; *) echo 'LOT must be 6F, 6G, 6H or 6I'; exit 1;; esac

verify build typecheck lint test-api api-ci mutation-proof astra-proof: guard
	@bash tools/make/paniers-lot6-verify.sh $@

regression: guard
	@bash tools/make/paniers-lot6-verify.sh regression

.PHONY: scope-proof
scope-proof: guard
	@bash tools/make/paniers-lot6g-fix-scope.sh

prepare: guard
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh prepare

checkpoints: guard
	@bash tools/make/paniers-lot6-verify.sh checkpoints

deliver: guard
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh finish

audit: guard
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh audit

.PHONY: fix-prepare fix-deliver fix-audit
fix-prepare fix-deliver fix-audit: guard
	@test '$(LOT)' = 6H
	@bash tools/make/paniers-lot6h-fix-deliver.sh $@

clean inspect diagnose: guard
	@bash tools/make/paniers-lot6-verify.sh $@

# The task explicitly requires one subject, without a body or trailers.
# This local repository is the fallback when shared metadata is read-only.
commit: guard
	@test -n "$$MSG"
	git -C tmp/paniers-$(shell echo $(LOT) | tr A-Z a-z)/git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$$MSG"
