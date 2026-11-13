# Standalone entry point: deliberately does not include the root .env.
CLASSIF_NODE ?= node
CLASSIF_HOME ?= /home/antoinefa/.local/share/radar-classif/1passe-csets
export CLASSIF_HOME
.PHONY: csets-commit
csets-commit:
	@git commit -m "$(MSG)"
.PHONY: csets-script
csets-script:
	@$(CLASSIF_NODE) $(SCRIPT) $(ARGS)
.PHONY: csets-volumes
csets-volumes:
	@docker volume ls --format '{{.Name}}'
.PHONY: csets-deps-inspect
csets-deps-inspect:
	@docker run --rm -v radar-dev_radar-root-node-modules:/deps:ro -v radar-dev_radar-api-node-modules:/api:ro -v radar-classif-deps-preprod:/classif:ro node:24-bookworm-slim sh -c 'ls -d /deps/tsx /deps/@sentropic/engram /api/tsx /api/@sentropic/engram /classif/* 2>/dev/null || true'
.PHONY: csets-capture
csets-capture:
	@docker run --rm -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -v $(CURDIR):/lane:ro -w /private/deps node:24-bookworm-slim sh -c 'cp -r /src/api/src api/; cp -r /src/packages/radar-sources/src packages/radar-sources/; cp -r /src/packages/radar-domain/src packages/radar-domain/; cp /lane/tools/classif/csets/capture.ts .; ln -sfn /src/radar radar; node --import ./node_modules/tsx/dist/loader.mjs /private/deps/capture.ts'
.PHONY: csets-deps
csets-deps:
	@mkdir -p $(CLASSIF_HOME)/deps
	@docker run --rm -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -w /private/deps node:24-bookworm-slim sh -c 'cp /src/package.json /src/package-lock.json .; for d in api ui packages/artifacts-host packages/immo-mcp packages/radar-domain packages/radar-scoring packages/radar-sources; do mkdir -p $$d; cp /src/$$d/package.json $$d/; done; npm ci --ignore-scripts --no-audit --no-fund -w api -w packages/radar-domain -w packages/radar-sources'
.PHONY: csets-own
csets-own:
	@docker run --rm -v $(CLASSIF_HOME):/private node:24-bookworm-slim chown -R $(shell id -u):$(shell id -g) /private
.PHONY: csets-test
csets-test:
	@$(CLASSIF_NODE) --test tools/classif/csets/metrics.test.mjs
.PHONY: csets-validate
csets-validate:
	@docker run --rm --user $(shell id -u):$(shell id -g) -v /home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass:/src:ro -v $(CLASSIF_HOME):/private -v $(CURDIR):/lane:ro -w /private/deps node:24-bookworm-slim sh -c 'cp /lane/tools/classif/csets/validate.ts .; node --import ./node_modules/tsx/dist/loader.mjs validate.ts'
