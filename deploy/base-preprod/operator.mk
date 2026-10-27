# Namespace-administrator entrypoint. No include, dotenv, discovery or root delegation.
SHELL := /bin/bash
.DEFAULT_GOAL := help
override OPERATOR_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
override INPUT := $(value INPUT)
override EXPECTED := $(value EXPECTED)
override PROOFS := $(value PROOFS)
override ROUTES := $(value ROUTES)
override OUTPUT := $(value OUTPUT)
export INPUT EXPECTED PROOFS ROUTES OUTPUT ENV
.PHONY: help validate render-job collect-job inspect init attach activate resume permissions inventory freeze-cd close restore-ingresses stop-job collect-maintenance start-api restart-api reopen-api delete-job
help:
	@echo 'Explicit INPUT=<absolute owner JSON> OUTPUT=<new evidence directory> ENV=preprod required; see BASE_API_ACTIVATION.md.'
validate render-job collect-job inspect init attach activate resume permissions inventory freeze-cd close restore-ingresses stop-job collect-maintenance start-api restart-api reopen-api delete-job:
	@rtk bash "$(OPERATOR_ROOT)/tools/make/base-preprod-operator.sh" $@
