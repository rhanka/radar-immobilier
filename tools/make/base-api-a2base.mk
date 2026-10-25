# Isolated API-only A2-BASE qualification; no root Makefile or environment discovery.
override SCOPE := $(value SCOPE)
export SCOPE
export API_PORT UI_PORT MAILDEV_UI_PORT ENV
override FILES := $(value FILES)
override MSG := $(value MSG)
export FILES MSG
.PHONY: a2base-stage a2base-commit a2base-audit a2base-bundle
a2base-stage:
	rtk bash tools/make/base-api-a2base-deliver.sh stage
a2base-commit:
	rtk bash tools/make/base-api-a2base-deliver.sh commit
a2base-audit:
	rtk bash tools/make/base-api-a2base-deliver.sh audit
a2base-bundle:
	rtk bash tools/make/base-api-a2base-deliver.sh bundle
.PHONY: a2base-test a2base-check a2base-host-check a2base-mutations a2base-status
a2base-test:
	rtk bash tools/make/base-api-a2base-verify.sh test
a2base-check:
	rtk bash tools/make/base-api-a2base-verify.sh check
a2base-host-check:
	rtk bash tools/make/base-api-a2base-host-check.sh
a2base-mutations:
	rtk bash tools/make/base-api-a2base-verify.sh mutations
a2base-status:
	rtk bash -euc 'docker ps --format "{{.Names}}"; df -Pk .'
