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
.PHONY: l5-verify l5-stage l5-commit l5-audit l5-bundle l5-images
l5-verify:
	rtk bash tools/make/base-api-l5-verify.sh
l5-stage:
	rtk bash tools/make/base-api-l5-deliver.sh stage
l5-commit:
	rtk bash tools/make/base-api-l5-deliver.sh commit
l5-audit:
	rtk bash tools/make/base-api-l5-deliver.sh audit
l5-bundle:
	rtk bash tools/make/base-api-l5-deliver.sh bundle
l5-images:
	rtk bash tools/make/base-api-l5-images.sh
