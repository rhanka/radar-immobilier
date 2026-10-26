SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT SCOPE PWA_MODE
export FILES MSG
override PWA_COMMAND := $(value CMD)
export PWA_COMMAND
.PHONY: pwa-inspect pwa-backup pwa-rescue pwa-qualify pwa-deliver pwa-stage pwa-commit pwa-commit-slices
pwa-inspect:
	@bash -c "$$PWA_COMMAND"
pwa-backup:
	@mkdir -p tmp/pwa-evidence/backup
	@git bundle create tmp/pwa-evidence/backup/before.bundle --all
	@git ls-files --modified --others --exclude-standard -z -- api | tar --null -T - -cf tmp/pwa-evidence/backup/uncommitted.tar
	@sha256sum tmp/pwa-evidence/backup/*
pwa-rescue:
	@git init --bare -q tmp/pwa-evidence/rescue.git
	@git -C tmp/pwa-evidence/rescue.git fetch ../backup/before.bundle 'refs/heads/feat/api-paniers-pwa:refs/heads/rescue'
	@git -C tmp/pwa-evidence/rescue.git fsck --full
pwa-qualify:
	@bash tools/make/base-api-pwa-verify.sh
pwa-unit:
	@bash tools/make/base-api-pwa-unit.sh
pwa-deliver:
	@bash tools/make/base-api-pwa-deliver.sh
pwa-commit-slices:
	@bash tools/make/base-api-pwa-deliver.sh commit-slices
pwa-stage:
	@bash tools/make/base-api-pwa-git.sh stage
pwa-commit:
	@bash tools/make/base-api-pwa-git.sh commit
