SHELL := /bin/bash
DIR := tools/classif/1passe/recall1099
PRIVATE := /home/antoinefa/.local/share/radar-classif/1passe-recall1099
PRODUCTION := /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass
BENCH := /home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11
.PHONY: inspect quota check commit push pr prepare validate
TSRUN = docker run --rm --network none --user "$$(id -u):$$(id -g)" -e HOME=$(HOME) -v "$(PRODUCTION):/workspace:ro" -v "$(BENCH):/bench:ro" -v radar-dev_radar-test-root-node-modules:/workspace/node_modules:ro -v radar-dev_radar-test-api-node-modules:/workspace/api/node_modules:ro -v "$(PRIVATE):/runtime" -v "$(PRIVATE):$(PRIVATE)" -v radar-dev_radar-test-root-node-modules:/runtime/node_modules:ro -v "$(PRODUCTION)/packages:/runtime/packages:ro" -v "$(HOME)/.local/share/radar-classif/1passe-bc:$(HOME)/.local/share/radar-classif/1passe-bc:ro" -v "$(CURDIR):/lane" -w /lane node:24-bookworm-slim node /workspace/node_modules/tsx/dist/cli.mjs
prepare:
	mkdir -p "$(PRIVATE)"
	$(TSRUN) $(DIR)/production.mts prepare
validate:
	$(TSRUN) $(DIR)/production.mts validate
preflight:
	$(TSRUN) $(DIR)/production.mts preflight
score:
	node $(DIR)/score.mjs
inspect:
	docker run --rm --network none -v radar-dev_radar-test-root-node-modules:/deps:ro -v radar-dev_radar-test-api-node-modules:/api-deps:ro node:24-bookworm-slim sh -c 'ls /deps/tsx /deps/@sentropic/engram /api-deps/@sentropic/engram /deps/@radar/sources 2>/dev/null; ls /api-deps/tsx 2>/dev/null'
quota:
	node $(DIR)/quota.mjs
run:
	node $(DIR)/run.mjs
check:
	@for f in $(DIR)/*.mjs; do node --check "$$f" || exit; done
commit:
	git -c core.hooksPath=/dev/null commit -m "$(MSG)"
push:
	git push -u origin HEAD
pr:
	gh pr create --draft --base feat/classif-1passe-recall --title feat/classif-1passe-recall1099 --body-file $(DIR)/REPORT.md
