SHELL := /bin/bash
.PHONY: freeze quota run score check commit push pr
freeze:
	node tools/classif/1passe/recall/setup.mjs
quota:
	node tools/classif/1passe/recall/quota.mjs
status:
	node tools/classif/1passe/recall/status.mjs
verify:
	node tools/classif/1passe/recall/verify.mjs
run:
	node tools/classif/1passe/recall/run.mjs
score:
	node tools/classif/1passe/recall/score.mjs
score-c:
	node tools/classif/1passe/recall/score-c.mjs
historical:
	node tools/classif/1passe/recall/historical.mjs
tuning-audit:
	node tools/classif/1passe/recall/tuning-audit.mjs
check:
	@for f in tools/classif/1passe/recall/*.mjs; do node --check "$$f" || exit; done
test:
	node --test tools/classif/1passe/recall/metrics.test.mjs
commit:
	git -c core.hooksPath=/dev/null commit -m "$(MSG)"
push:
	git push -u origin HEAD
pr:
	gh pr create --draft --base feat/classif-1passe-bc --title feat/classif-1passe-recall --body-file tools/classif/1passe/recall/PR.md
pr-status:
	gh pr view --json url,isDraft,baseRefName,headRefName,headRefOid,statusCheckRollup
