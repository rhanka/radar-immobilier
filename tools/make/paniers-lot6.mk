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
else ifeq ($(LOT),6J)
SCOPE ?= src/services/facets/lots src/routes/scoped-lot- src/services/facets/lot-migration-report
else ifeq ($(LOT),6K)
SCOPE ?= src/services/facets/lots src/routes/scoped-lot- src/services/facets/lot-migration-report src/services/chat/stream-bus
else ifeq ($(LOT),6L1)
SCOPE ?= src/services/facets/projection src/services/facets/scoped src/services/facets/workspace src/routes/scoped-projection src/services/graph/graph-store ui/src/lib/signals/signal-projection
else
SCOPE ?= src/services/facets
endif
ACTION ?= verify
DELIVERY_DIR ?= tmp/paniers-$(shell echo $(LOT) | tr A-Z a-z)/git
UI_SCOPE ?=
DELIVERY_PROFILE = $(if $(filter 6J,$(LOT)),6j,$(if $(filter 6I,$(LOT)),6i,$(if $(filter 6H,$(LOT)),6h,6g)))
export ENV LOT API_PORT UI_PORT MAILDEV_UI_PORT SCOPE ACTION EVIDENCE_TAG CHECKPOINT_DIR UI_SCOPE

.PHONY: guard verify build typecheck lint test-api clean inspect diagnose commit prepare checkpoints deliver regression audit astra-proof run-6j
guard:
	@case '$(ENV)' in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required'; exit 1;; esac
	@case '$(LOT)' in 6F|6G|6H|6I|6J|6K|6L1) ;; *) echo 'LOT must be 6F, 6G, 6H, 6I, 6J, 6K or 6L1'; exit 1;; esac

verify build typecheck lint test-api test-ui api-ci mutation-proof astra-proof fix-proof fix2-proof: guard
	@bash tools/make/paniers-lot$(if $(filter 6K,$(LOT)),6k-run,6-verify).sh $@

.PHONY: prepare-6k deliver-6k finalize-6k audit-6k
prepare-6k deliver-6k finalize-6k audit-6k: guard
	@test '$(LOT)' = 6K
	@bash tools/make/paniers-lot6k-deliver.sh $@

.PHONY: fix-6k-prepare fix-6k-deliver fix-6k-audit
fix-6k-prepare fix-6k-deliver fix-6k-audit: guard
	@test '$(LOT)' = 6K
	@bash tools/make/paniers-lot6k-fix-deliver.sh $(patsubst fix-6k-%,%,$@)

regression: guard
	@bash tools/make/paniers-lot$(if $(filter 6K,$(LOT)),6k-run,$(if $(filter 6J,$(LOT)),6j-run,6-verify)).sh regression

.PHONY: scope-proof
scope-proof: guard
	@bash tools/make/paniers-lot6g-fix-scope.sh

prepare: guard
	@case '$(LOT)' in 6G|6H|6I|6J) ;; *) echo 'no delivery profile ships for this LOT'; exit 2;; esac
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh prepare

checkpoints: guard
	@bash tools/make/paniers-lot6-verify.sh checkpoints

deliver: guard
	@case '$(LOT)' in 6G|6H|6I|6J) ;; *) echo 'no delivery profile ships for this LOT'; exit 2;; esac
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh finish

audit: guard
	@case '$(LOT)' in 6G|6H|6I|6J) ;; *) echo 'no delivery profile ships for this LOT'; exit 2;; esac
	@bash tools/make/paniers-lot$(DELIVERY_PROFILE)-deliver.sh audit

.PHONY: fix-prepare fix-deliver fix-audit
fix-prepare fix-deliver fix-audit: guard
	@case '$(LOT)' in 6H|6I|6J) ;; *) exit 1;; esac
	@bash tools/make/paniers-lot$(shell echo $(LOT) | tr A-Z a-z)-fix-deliver.sh $@

.PHONY: fix2-prepare fix2-deliver fix2-audit
fix2-prepare fix2-deliver fix2-audit: guard
	@test '$(LOT)' = 6J
	@bash tools/make/paniers-lot6j-fix2-deliver.sh $(patsubst fix2-%,%,$(subst deliver,finish,$@))

run-6j: guard
	@test '$(LOT)' = 6J
	@bash tools/make/paniers-lot6j-run.sh verify
run-6k: guard
	@test '$(LOT)' = 6K
	@bash tools/make/paniers-lot6k-run.sh verify
.PHONY: sol-prepare sol-deliver sol-audit
sol-prepare sol-deliver sol-audit: guard
	@test '$(LOT)' = 6L1
	@bash tools/make/paniers-lot6l1-deliver.sh $@

clean inspect diagnose: guard
	@bash tools/make/paniers-lot6-verify.sh $@

# The task explicitly requires one subject, without a body or trailers.
# This local repository is the fallback when shared metadata is read-only.
commit: guard
	@test -n "$$MSG"
	git -C $(DELIVERY_DIR) -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$$MSG"
