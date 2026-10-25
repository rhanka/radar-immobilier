# Development/delivery entrypoint. Deliberately never includes the root Makefile.
SHELL := /bin/bash
ENV ?= test-base-preprod
export ENV API_PORT UI_PORT MAILDEV_UI_PORT FILES MSG
override MSG := $(value MSG)
.PHONY: inspect-host stage commit bundle audit verify build-image test-operator
test-operator:
	@rtk bash tools/make/base-preprod-operator.test.sh
inspect-host:
	@rtk bash -c 'git status --short --branch; git rev-parse origin/main; command -v jq kubectl; df -h .; docker ps --format "{{.Names}}"; pgrep -af "docker (build|buildx build)" || true'
stage:
	@rtk bash tools/make/base-preprod-deliver.sh stage
commit:
	@rtk bash tools/make/base-preprod-deliver.sh commit
bundle:
	@rtk bash tools/make/base-preprod-deliver.sh bundle
audit:
	@rtk bash tools/make/base-preprod-deliver.sh audit
verify build-image:
	@rtk proxy bash tools/make/base-preprod-verify.sh $@
