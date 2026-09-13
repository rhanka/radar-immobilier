SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
KIT_ROOT ?= /home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit
NODE_IMAGE ?= node:24-bookworm-slim
CHROME ?= /home/antoinefa/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
ENV ?= test-architecture
PORT ?= 5188
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" -e NODE_OPTIONS=--max-old-space-size=1100 -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT):/kit:ro -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node
.PHONY: build map mermaid test browser clipboard inspect-live reset-live-zoom clean-live tokens report-check serve-run chrome-run
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
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e FOCUS_PORT=$(PORT) -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
clipboard:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e FOCUS_PORT=$(PORT) -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node clipboard-check.mjs
inspect-live:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e CDP_PORT=$(CDP_PORT) -e TARGET_ID=$(TARGET_ID) -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node cdp-inspect.mjs
reset-live-zoom:
	test -n "$$DISPLAY"
	window_ids="$$(xdotool search --name 'Immo · dossier de décision Focus')"; test -n "$$window_ids"; for window_id in $$window_ids; do xdotool windowactivate --sync $$window_id; xdotool key --window $$window_id --clearmodifiers ctrl+0; done
clean-live:
	$(RM) $(FOCUS_DIR)/live-before.png $(FOCUS_DIR)/live-after.png $(FOCUS_DIR)/live-summary.png $(FOCUS_DIR)/live-inspection.json
report-check:
	test -s $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf
	pdfinfo $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf
	pdfinfo -f 5 -l 14 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf
	test "$$(pdfinfo $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf | awk '/^Pages:/ {print $$2}')" -eq 14
	test "$$(pdfinfo -f 5 -l 14 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf | rg -c '^Page +[0-9]+ size:.*A3')" -eq 10
	test "$$(rg -c '\"graph\": \"asis-1\"' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json)" -eq 5
	test "$$(rg -c '\"graph\": \"target-3\"' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json)" -eq 5
	rg -q '\"diagramPage\": \"A3 landscape\"' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json
	pdftotext $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report.txt
	rg -q "10 août" $(FOCUS_DIR)/.generated/report.txt
	rg -q "septembre 2026" $(FOCUS_DIR)/.generated/report.txt
	rg -q "59,017 keys et hashes" $(FOCUS_DIR)/.generated/report.txt
	rg -q "320.095438 CAD" $(FOCUS_DIR)/.generated/report.txt
	rg -q "Architecture AVANT" $(FOCUS_DIR)/.generated/report.txt
	rg -q "Architecture APRÈS" $(FOCUS_DIR)/.generated/report.txt
	rg -q "ouverte et non critique" $(FOCUS_DIR)/.generated/report.txt
	pdftoppm -f 1 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-preview
	pdftoppm -f 5 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-before
	pdftoppm -f 6 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-before-partition
	pdftoppm -f 10 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-after
	pdftoppm -f 11 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-after-partition
serve-run: map
	docker run --rm --network host --cpus=1.5 --memory=1536m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT):/kit:ro -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $(PORT) --strictPort --config vite.config.js --configLoader runner
