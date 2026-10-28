# PW-E qualification without root Makefile or environment-file discovery.
SHELL := /bin/bash
ENV ?= test-api-paniers-pwe
API_PORT ?= 18935
UI_PORT ?= 15935
MAILDEV_UI_PORT ?= 11935
PHASE ?= pg
SCOPE ?=
MUTANTS ?=
override MSG := $(value MSG)
export ENV API_PORT UI_PORT MAILDEV_UI_PORT PHASE SCOPE FILES MSG MUTANTS
.PHONY: pwcr-verify pwcr-stage pwcr-commit pwcr-audit pwcr-bundle
pwcr-verify:
	rtk bash tools/make/base-api-pwc-review-verify.sh
pwcr-stage:
	rtk bash tools/make/base-api-pwc-review-deliver.sh stage
pwcr-commit:
	rtk bash tools/make/base-api-pwc-review-deliver.sh commit
pwcr-audit:
	rtk bash tools/make/base-api-pwc-review-deliver.sh audit
pwcr-bundle:
	rtk bash tools/make/base-api-pwc-review-deliver.sh bundle
