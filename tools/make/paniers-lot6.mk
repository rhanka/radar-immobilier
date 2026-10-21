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
else
SCOPE ?= src/services/facets
endif
ACTION ?= verify
export ENV LOT API_PORT UI_PORT MAILDEV_UI_PORT SCOPE ACTION EVIDENCE_TAG CHECKPOINT_DIR

.PHONY: guard verify build typecheck lint test-api clean inspect diagnose commit prepare checkpoints deliver regression audit
guard:
	@case '$(ENV)' in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required'; exit 1;; esac
	@case '$(LOT)' in 6F|6G) ;; *) echo 'LOT must be 6F or 6G'; exit 1;; esac

verify build typecheck lint test-api: guard
	@bash tools/make/paniers-lot6-verify.sh $@

regression: guard
	@bash tools/make/paniers-lot6-verify.sh regression

.PHONY: scope-proof
scope-proof: guard
	@bash tools/make/paniers-lot6g-fix-scope.sh

prepare: guard
	@bash tools/make/paniers-lot6g-deliver.sh prepare

checkpoints: guard
	@bash tools/make/paniers-lot6-verify.sh checkpoints

deliver: guard
	@bash tools/make/paniers-lot6g-deliver.sh finish

audit: guard
	@bash tools/make/paniers-lot6g-deliver.sh audit

clean inspect diagnose: guard
	@bash tools/make/paniers-lot6-verify.sh $@

# The task explicitly requires one subject, without a body or trailers.
# This local repository is the fallback when shared metadata is read-only.
commit: guard
	@test -n "$$MSG"
	git -C tmp/paniers-$(shell echo $(LOT) | tr A-Z a-z)/git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$$MSG"
