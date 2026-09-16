SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DOCS_DIR := $(abspath $(FOCUS_DIR)/../../../..)
CHAIN_DIR := $(DOCS_DIR)/architecture/focus
KIT_ROOT ?= /home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit
NODE_IMAGE ?= node:24-bookworm-slim
CHROME ?= /home/antoinefa/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
CDP_PORT ?= 9239
ENV ?= test-dossier-kanban
WORKDIR := /docs/spec/reports/dossier-kanban-iteration/focus
# La chaîne est importée, jamais recopiée : /kit porte le kit h2a, et les
# dépendances sont celles de docs/architecture/focus (cible `deps` de sa Makefile).
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" \
  -e NODE_OPTIONS=--max-old-space-size=1100 \
  -v $(DOCS_DIR):/docs -v $(KIT_ROOT):/kit:ro -v $(CHAIN_DIR)/node_modules:/docs/node_modules:ro \
  -w $(WORKDIR) $(NODE_IMAGE) node

.PHONY: deps map test build browser chrome-run proofs
deps:
	$(MAKE) -f $(CHAIN_DIR)/Makefile deps ENV=$(ENV)
chrome-run:
	$(CHROME) --headless=new --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 \
	  --remote-debugging-port=$(CDP_PORT) --user-data-dir=/tmp/radar-kanban-focus-chromium
map:
	$(RUN) build-map.mjs
test: map
	$(RUN) --test mapping.test.mjs
	git diff --check
build: map
	$(RUN) /docs/node_modules/vite/bin/vite.js build --config vite.config.js --configLoader runner
	$(RUN) portable.mjs
browser:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e CDP_PORT=$(CDP_PORT) \
	  -e FOCUS_FILE_ROOT=$(FOCUS_DIR)/.. -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
proofs:
	test -s $(FOCUS_DIR)/../decision-focus.html
	test -s $(FOCUS_DIR)/.generated/browser-check.json
	mkdir -p $(FOCUS_DIR)/../preuves
	cp $(FOCUS_DIR)/.generated/browser-check.json $(FOCUS_DIR)/.generated/portable.json $(FOCUS_DIR)/../preuves/
	cp $(FOCUS_DIR)/.generated/dossier-preview-*.png $(FOCUS_DIR)/.generated/scene-*.png $(FOCUS_DIR)/../preuves/
	node -e "const r=require('$(FOCUS_DIR)/.generated/browser-check.json'); \
	  if(r.status!=='pass') throw Error('browser check did not pass'); \
	  if(r.scenes.length!==2) throw Error('two scenes expected'); \
	  if(r.consoleErrors.length||r.runtimeErrors.length) throw Error('console is not clean'); \
	  if(r.externalRequests.length) throw Error('the page is not offline'); \
	  console.log(JSON.stringify({scenes:r.scenes.map(s=>({id:s.sceneId,cards:s.cards,edges:s.edges,scale:s.initialScale})),choices:r.choices}))"
