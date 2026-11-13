# Entrée autonome. Aucun include et aucune lecture de .env.
SHELL := /bin/bash
BC_SHARED_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
.PHONY: commit quota annotate finalize inspect syntax
syntax:
	@for f in tools/classif/1passe/*.mjs; do node --check "$$f" || exit; done
commit:
	git -c core.hooksPath=/dev/null commit -m "$(MSG)"
quota:
	node tools/classif/1passe/quota.mjs
annotate:
	node tools/classif/1passe/annotate.mjs
finalize:
	node tools/classif/1passe/finalize.mjs
inspect:
	node tools/classif/1passe/inspect.mjs
status:
	node tools/classif/1passe/status.mjs $(ARGS)
reconcile:
	node tools/classif/1passe/reconcile.mjs
correction-freeze:
	node tools/classif/1passe/correction-freeze.mjs
resume-interrupted:
	node tools/classif/1passe/resume-interrupted.mjs
shared-recalc:
	node $(BC_SHARED_DIR)shared-recalc.mjs $(LANE) $(if $(HALF),$(HALF),tuning) $(CHECK)
snapshot-offline:
	node tools/classif/1passe/correction-report.mjs --snapshot
correction-report:
	node tools/classif/1passe/correction-report.mjs
test:
	node --test tools/classif/1passe/matching.test.mjs
arbitrate:
	node tools/classif/1passe/arbitrate.mjs
surface-agy:
	agy --help
push:
	git push origin HEAD
pr-view:
	gh pr view 1097 --json url,isDraft,headRefName,baseRefName,title
pr-update:
	gh api --method PATCH repos/rhanka/radar-immobilier/pulls/1097 -f title=feat/classif-1passe-bc -F body=@tools/classif/1passe/PR.md --jq .html_url
custody:
	node tools/classif/1passe/custody.mjs
quota-claude:
	node tools/classif/1passe/claude-quota.mjs
verify:
	node tools/classif/1passe/verify.mjs
await-reference:
	@while ! test -f /home/antoinefa/.local/share/radar-classif/1passe-bc/arbitration/run-summary.json; do sleep 10; done
	$(MAKE) -f tools/classif/1passe/ops.mk finalize verify ENV=$(ENV)
