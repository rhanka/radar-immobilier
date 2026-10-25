# Namespace-administrator entrypoint. No include, dotenv, discovery or root delegation.
SHELL := /bin/bash
.DEFAULT_GOAL := help
override INPUT := $(value INPUT)
override EXPECTED := $(value EXPECTED)
override PROOFS := $(value PROOFS)
override OUTPUT := $(value OUTPUT)
export INPUT EXPECTED PROOFS OUTPUT ENV
.PHONY: help validate render-job inspect init attach activate resume permissions inventory freeze-cd close collect-maintenance reopen-api delete-job
help:
	@echo 'Explicit INPUT=<absolute owner JSON> OUTPUT=<new evidence directory> ENV=preprod required; see BASE_API_ACTIVATION.md.'
validate render-job inspect init attach activate resume permissions inventory freeze-cd close collect-maintenance reopen-api delete-job:
	@rtk bash tools/make/base-preprod-operator.sh $@
