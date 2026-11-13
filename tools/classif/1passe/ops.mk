# Entrée autonome. Aucun include et aucune lecture de .env.
SHELL := /bin/bash
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
	gh pr edit 1097 --title feat/classif-1passe-bc --body-file tools/classif/1passe/PR.md
custody:
	node tools/classif/1passe/custody.mjs
quota-claude:
	node tools/classif/1passe/claude-quota.mjs
verify:
	node tools/classif/1passe/verify.mjs
