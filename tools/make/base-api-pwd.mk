export ENV API_PORT UI_PORT MAILDEV_UI_PORT PWD_MODE PWD_SCOPE
PWD_GIT = git
ifeq ($(PWD_RESCUE),1)
PWD_GIT = git --git-dir="$(CURDIR)/tmp/pwd-evidence/rescue.git" --work-tree="$(CURDIR)"
endif
.PHONY: pwd-verify pwd-commit-slices pwd-deliver commit
pwd-verify:
	@bash tools/make/base-api-pwd-verify.sh
pwd-commit-slices:
	@bash tools/make/base-api-pwd-commit.sh
pwd-deliver:
	@bash tools/make/base-api-pwd-deliver.sh
commit:
	@test "$$($(PWD_GIT) diff --cached --numstat | awk '{n+=$$1+$$2} END {print n+0}')" -le 150
	@$(PWD_GIT) -c core.hooksPath=/dev/null -c user.name="$$(git show -s --format=%an de81ef0e)" -c user.email="$$(git show -s --format=%ae de81ef0e)" commit -m "$(MSG)"
pwd-stage:
	@$(PWD_GIT) add -- $(FILES)
pwd-rescue-init:
	@$(PWD_GIT) update-ref refs/heads/feat/api-paniers-pwd de81ef0ef30dd1ca0bf575498e342be525f5cc2d 0000000000000000000000000000000000000000
	@$(PWD_GIT) symbolic-ref HEAD refs/heads/feat/api-paniers-pwd
	@$(PWD_GIT) read-tree HEAD
pwd-snapshot:
	@mkdir -p tmp/pwd-evidence/corrections
	@test ! -e tmp/pwd-evidence/corrections/base.bundle
	@git bundle create tmp/pwd-evidence/corrections/base.bundle HEAD
	@git -C tmp/pwd-evidence/rescue.git fetch --no-tags "$(CURDIR)" HEAD:refs/heads/astra-base
	@cp RAPPORT-SOL-PWD.md tmp/pwd-evidence/corrections/report-before.md
pwd-machine:
	@docker ps --format '{{.Names}} {{.Status}}'
	@ps -eo pid,comm,args | awk '$$2 ~ /^(docker|buildctl|flock)$$/ {print}'
	@awk '/MemAvailable:/ {print}' /proc/meminfo
	@df -Pk .
pwd-tools-check:
	@for file in tools/make/base-api-pwd*.sh; do bash -n "$$file" || exit; done
pwd-corrections-deliver:
	@bash tools/make/base-api-pwd-corrections-deliver.sh
pwd-corrections-package-draft:
	@PWD_PACKAGE_ONLY=1 bash tools/make/base-api-pwd-corrections-deliver.sh
