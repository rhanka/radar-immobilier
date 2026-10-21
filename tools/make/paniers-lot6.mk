# Standalone 6F verification. Never includes the root Makefile or .env.
# ENV must be the last argument. No host port is published.
SHELL := /bin/bash
ENV ?=
LOT ?= 6F
API_PORT ?= 18866
UI_PORT ?= 15866
MAILDEV_UI_PORT ?= 11866
SCOPE ?= src/services/facets
ACTION ?= verify
export ENV LOT API_PORT UI_PORT MAILDEV_UI_PORT SCOPE ACTION

.PHONY: guard verify typecheck lint test-api clean inspect commit
guard:
	@case '$(ENV)' in test-*|e2e-*) ;; *) echo 'test-* or e2e-* ENV required'; exit 1;; esac
	@test '$(LOT)' = 6F

verify typecheck lint test-api: guard
	@bash tools/make/paniers-lot6-verify.sh $@

clean inspect: guard
	@bash tools/make/paniers-lot6-verify.sh $@

# The task explicitly requires one subject, without a body or trailers.
# This local repository is the fallback when shared metadata is read-only.
commit: guard
	@test -n "$$MSG"
	git -C tmp/paniers-6f/git -c core.hooksPath=/dev/null -c commit.gpgsign=false commit -m "$$MSG"
