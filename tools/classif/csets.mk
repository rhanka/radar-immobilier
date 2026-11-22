# Standalone executor: Node loads the owner-authorized environment without echoing it.
CLASSIF_NODE ?= node
CLASSIF_ENV_FILE ?= /home/antoinefa/src/radar-immobilier/.env
CSETS_VERSION ?= v1
CSETS_MODES ?= B
export CSETS_VERSION CSETS_MODES
CLASSIF_HOME ?= /home/antoinefa/.local/share/radar-classif/1passe-csets
export CLASSIF_HOME
.PHONY: csets-commit
.PHONY: csets-stage csets-diff-check csets-pr-status
csets-stage:
	@git add $(FILES)
csets-diff-check:
	@git diff --check
csets-pr-status:
	@gh pr view 1105 --json url,isDraft,headRefOid,statusCheckRollup
csets-commit:
	@git commit -m "$(MSG)"
.PHONY: csets-script
csets-script:
	@$(CLASSIF_NODE) --env-file=$(CLASSIF_ENV_FILE) $(SCRIPT) $(ARGS)
.PHONY: csets-capture
csets-capture:
	@docker run --rm --user $(shell id -u):$(shell id -g) -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -v $(CURDIR):/lane:ro -w /private/deps node:24-bookworm-slim sh -c 'cp -r /src/api/src api/; cp -r /src/packages/radar-sources/src packages/radar-sources/; cp -r /src/packages/radar-domain/src packages/radar-domain/; cp /lane/tools/classif/csets/capture.ts .; ln -sfn /src/radar radar; node --import ./node_modules/tsx/dist/loader.mjs /private/deps/capture.ts'
.PHONY: csets-deps
csets-deps:
	@mkdir -p $(CLASSIF_HOME)/deps
	@docker run --rm --user $(shell id -u):$(shell id -g) -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -w /private/deps node:24-bookworm-slim sh -c 'cp /src/package.json /src/package-lock.json .; for d in api ui packages/artifacts-host packages/immo-mcp packages/radar-domain packages/radar-scoring packages/radar-sources; do mkdir -p $$d; cp /src/$$d/package.json $$d/; done; npm ci --ignore-scripts --no-audit --no-fund -w api -w packages/radar-domain -w packages/radar-sources'
.PHONY: csets-push csets-pr
csets-push:
	@git push -u origin feat/classif-1passe-csets
csets-pr:
	@gh pr create --base feat/classif-pilot-l1l2 --head feat/classif-1passe-csets --draft --title 'feat/classif-1passe-csets' --body-file $(CLASSIF_HOME)/pr-body.md
.PHONY: csets-pr-update
csets-pr-update:
	@gh api repos/rhanka/radar-immobilier/pulls/1105 --method PATCH -F body=@$(CLASSIF_HOME)/pr-body.md --jq .html_url
.PHONY: csets-test
csets-test:
	@$(CLASSIF_NODE) --test tools/classif/csets/metrics.test.mjs
.PHONY: csets-validate
csets-validate:
	@docker run --rm --user $(shell id -u):$(shell id -g) -e CLASSIF_BLIND_KEY -e CSETS_HALF=$(if $(HALF),$(HALF),tuning) -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -v $(CURDIR):/lane:ro -w /private/deps node:24-bookworm-slim sh -c 'cp /lane/tools/classif/csets/validate.ts .; node --import ./node_modules/tsx/dist/loader.mjs validate.ts'
