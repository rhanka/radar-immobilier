SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
KIT_ROOT ?= /home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit
NODE_IMAGE ?= node:24-bookworm-slim
CHROME ?= /home/antoinefa/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
ENV ?= test-architecture
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" -e NODE_OPTIONS=--max-old-space-size=1100 -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT):/kit:ro -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node
.PHONY: build map mermaid test browser clipboard tokens report-check serve-run chrome-run
chrome-run:
	$(CHROME) --headless=new --no-sandbox --disable-gpu --remote-debugging-address=127.0.0.1 --remote-debugging-port=9238 --user-data-dir=/tmp/radar-architecture-focus-chromium
tokens:
	for shard in 0 1 2 3 4 5; do node $(FOCUS_DIR)/../../reports/architecture-monthly/token-audit.mjs claude $$shard 6 & done; wait
	node $(FOCUS_DIR)/../../reports/architecture-monthly/token-audit.mjs codex
	node $(FOCUS_DIR)/../../reports/architecture-monthly/token-audit.mjs combine 6
map:
	$(RUN) build-map.mjs
mermaid: map
	docker run --rm --network host --cpus=1.5 --memory=1024m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/..:/work -w /work/focus $(NODE_IMAGE) node render-mermaid.mjs
build: mermaid
	$(RUN) node_modules/vite/bin/vite.js build --config vite.config.js --configLoader runner
	$(RUN) portable.mjs
	docker run --rm --network host --cpus=1.5 --memory=1024m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node report-render.mjs
test: map
	$(RUN) --test mapping.test.mjs nested.test.mjs choices.test.mjs provenance.test.mjs
	git diff --check
browser:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
clipboard:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node clipboard-check.mjs
report-check:
	test -s $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf
	pdfinfo $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf
	pdftotext $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report.txt
	rg -q "10 août" $(FOCUS_DIR)/.generated/report.txt
	rg -q "septembre 2026" $(FOCUS_DIR)/.generated/report.txt
	rg -q "59,017 keys et hashes" $(FOCUS_DIR)/.generated/report.txt
	rg -q "320.095438 CAD" $(FOCUS_DIR)/.generated/report.txt
	pdftoppm -f 1 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-preview
serve-run: map
	docker run --rm --network host --cpus=1.5 --memory=1536m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT):/kit:ro -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --config vite.config.js --configLoader runner
