SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
DOCS_DIR := $(abspath $(FOCUS_DIR)/../../../..)
CHAIN_DIR := $(DOCS_DIR)/architecture/focus
KIT_ROOT ?= /home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit
NODE_IMAGE ?= node:24-bookworm-slim
CHROME ?= /home/antoinefa/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome
CDP_PORT ?= 9242
ENV ?= test-dossier-712
WORKDIR := /docs/spec/reports/dossier-backup-pra-712/focus
# La chaîne est importée, jamais recopiée : /kit porte le kit h2a, et les
# dépendances sont celles de docs/architecture/focus (cible `deps` de sa Makefile).
# Dérogation à la porte de lisibilité : vide par défaut (le build refuse alors une
# scène sous le seuil) ; seulement explicite et motivée, par exemple
#   make build LEGIBILITE_DEROGATION="décision owner attendue : options au compte rendu"
LEGIBILITE_DEROGATION ?=
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" \
  -e NODE_OPTIONS=--max-old-space-size=1100 -e LEGIBILITE_DEROGATION="$(LEGIBILITE_DEROGATION)" \
  -v $(DOCS_DIR):/docs -v $(KIT_ROOT):/kit:ro -v $(CHAIN_DIR)/node_modules:/docs/node_modules:ro \
  -w $(WORKDIR) $(NODE_IMAGE) node

.PHONY: deps map test build browser chrome-run proofs sweep legibility-before
# Dépendance propre au dossier, épinglée dans package.json : elkjs (placement ELK),
# exécuté au build. @hpcc-js/wasm-graphviz a été retiré avec le rendu Graphviz dot
# (ARCH-7, demande de l'owner).
deps:
	$(MAKE) -f $(CHAIN_DIR)/Makefile deps ENV=$(ENV)
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e npm_config_cache=/tmp/npm-cache -v $(FOCUS_DIR):/work -w /work $(NODE_IMAGE) npm install --ignore-scripts
chrome-run:
	$(CHROME) --headless=new --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 \
	  --remote-debugging-port=$(CDP_PORT) --user-data-dir=/tmp/radar-712-focus-chromium
map:
	$(RUN) build-map.mjs
# Balayage de lisibilité (réglages natifs ELK et Graphviz, chaque candidat placé,
# contrôlé, mesuré) ; le tableau est une preuve, copié dans ../preuves.
sweep:
	$(RUN) sweep-legibility.mjs
	mkdir -p $(FOCUS_DIR)/../preuves
	cp $(FOCUS_DIR)/.generated/balayage-lisibilite.json $(FOCUS_DIR)/.generated/balayage-lisibilite.csv $(FOCUS_DIR)/.generated/balayage-lisibilite.md $(FOCUS_DIR)/../preuves/
# Mesure de lisibilité seule, sur une autre page (par exemple celle d'avant) :
#   make legibility-before BEFORE_ROOT=/chemin/du/dossier/de/la/page TAG=avant
BEFORE_ROOT ?=
TAG ?= avant
legibility-before:
	test -s $(BEFORE_ROOT)/decision-focus.html
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e CDP_PORT=$(CDP_PORT) -e LEGIBILITY_ONLY=$(TAG) \
	  -e FOCUS_FILE_ROOT=$(BEFORE_ROOT) -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
test: map
	$(RUN) --test mapping.test.mjs
	git diff --check
build: map
	$(RUN) /docs/node_modules/vite/bin/vite.js build --config vite.config.js --configLoader runner
	$(RUN) portable.mjs
browser:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e CDP_PORT=$(CDP_PORT) \
	  -e FOCUS_FILE_ROOT=$(FOCUS_DIR)/.. -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
# Le rapport est publié arrondi au millième : 16:9 exact s'écrit 1,778 (le contrôle
# exact est fait dans Chromium par checkGeometry, qui arrête browser-check.mjs).
proofs:
	test -s $(FOCUS_DIR)/../decision-focus.html
	test -s $(FOCUS_DIR)/.generated/browser-check.json
	mkdir -p $(FOCUS_DIR)/../preuves
	cp $(FOCUS_DIR)/.generated/browser-check.json $(FOCUS_DIR)/.generated/portable.json $(FOCUS_DIR)/../preuves/
	rm -f $(FOCUS_DIR)/../preuves/*.png $(FOCUS_DIR)/../preuves/*.pdf
	cp $(FOCUS_DIR)/.generated/dossier-preview-*.png $(FOCUS_DIR)/.generated/scene-*.png $(FOCUS_DIR)/.generated/impression-*.pdf $(FOCUS_DIR)/../preuves/
	cp $(FOCUS_DIR)/.generated/legibility-*.json $(FOCUS_DIR)/../preuves/ 2>/dev/null || true
	node -e "const r=require('$(FOCUS_DIR)/.generated/browser-check.json'); \
	  if(r.status!=='pass') throw Error('browser check did not pass'); \
	  if(r.scenes.length!==3) throw Error('three scenes expected'); \
	  if(r.consoleErrors.length||r.runtimeErrors.length) throw Error('console is not clean'); \
	  if(r.externalRequests.length) throw Error('the page is not offline'); \
	  if(r.geometry.length!==6||r.geometry.some(g=>g.offBorder||g.crossings||g.detachedLabels||g.ratio<4/3-5e-4||g.ratio>16/9+5e-4)) throw Error('geometry'); \
	  if(r.legibility.length!==9||r.legibility.some(l=>l.modelGapPx>0.05)) throw Error('legibility measure'); \
	  if(r.legibility.some(l=>l.faults.length)&&!r.legibilityDerogation) throw Error('legibility gate'); \
	  console.log(JSON.stringify({scenes:r.scenes.map(s=>({id:s.sceneId,cards:s.cards,edges:s.edges,scale:s.initialScale})),choices:r.choices}))"
