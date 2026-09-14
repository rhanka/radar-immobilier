SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
NODE_IMAGE ?= node:24-bookworm-slim
CHROME ?= /home/antoinefa/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
ENV ?= test-architecture
PORT ?= 5188
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" -e NODE_OPTIONS=--max-old-space-size=1100 -v $(FOCUS_DIR)/../..:/docs -w /docs/architecture/focus $(NODE_IMAGE) node
.PHONY: deps dependency-versions build map mermaid test browser clipboard inspect-live reset-live-zoom clean-live tokens report-check serve-run chrome-run audit
dependency-versions:
	docker run --rm --network host $(NODE_IMAGE) npm view @xyflow/svelte@1.6.6 version
deps:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e npm_config_cache=/tmp/npm-cache -v $(FOCUS_DIR):/work -w /work $(NODE_IMAGE) npm install --ignore-scripts --force
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
	docker run --rm --network host --cpus=1.5 --memory=1024m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/../..:/docs -w /docs/architecture/focus $(NODE_IMAGE) node report-render.mjs
	cd $(FOCUS_DIR) && node report-finalize.mjs
test: map
	$(RUN) --test mapping.test.mjs nested.test.mjs choices.test.mjs provenance.test.mjs
	git diff --check
browser:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e FOCUS_PORT=$(PORT) -e FOCUS_FILE_ROOT=$(FOCUS_DIR)/.. -v $(FOCUS_DIR):/out -w /out $(NODE_IMAGE) node browser-check.mjs
audit:
	docker run --rm --network host --user "$$(id -u):$$(id -g)" -e npm_config_cache=/tmp/npm-cache -v $(FOCUS_DIR):/work -w /work $(NODE_IMAGE) npm audit --json
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
	test "$$(pdfdetach -list $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf | rg -c 'study-2026-08-report.pdf')" -eq 1
	test "$$(rg -c '\"sceneId\":' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json)" -ge 8
	rg -q '\"scale\": 1' $(FOCUS_DIR)/.generated/report-render.json
	rg -q '\"printScale\": 1' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json
	rg -q '\"extractedAttachmentSha256\": \"86ae37810016bca61cc897105121cfcbcd1951426fc889616ae1efe37ae29528\"' $(FOCUS_DIR)/../../reports/architecture-monthly/evidence-manifest-2026-09-13.json
	pdftotext $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report.txt
	rg -q "10 août" $(FOCUS_DIR)/.generated/report.txt
	rg -q "septembre" $(FOCUS_DIR)/.generated/report.txt
	rg -q "35 jours / 840 heures" $(FOCUS_DIR)/.generated/report.txt
	rg -q "dormante" $(FOCUS_DIR)/.generated/report.txt
	rg -q "promotion" $(FOCUS_DIR)/.generated/report.txt
	rg -q "modèle" $(FOCUS_DIR)/.generated/report.txt
	rg -q "non classable" $(FOCUS_DIR)/.generated/report.txt
	rg -q "SCW TEM explicitement conservé" $(FOCUS_DIR)/.generated/report.txt
	rg -q "320.095438" $(FOCUS_DIR)/.generated/report.txt
	for scene in storage-before-20260809 storage-after-20260913 refresh-before-20260809 refresh-after-20260913; do rg -q "$$scene" $(FOCUS_DIR)/.generated/report.txt; test -s $(FOCUS_DIR)/.generated/report-graph-$$scene.png; done
	pdftoppm -f 1 -l 1 -singlefile -png -r 110 $(FOCUS_DIR)/../../reports/architecture-monthly/report-through-2026-09-13.pdf $(FOCUS_DIR)/.generated/report-preview
serve-run: map
	docker run --rm --network host --cpus=1.5 --memory=1536m --user "$$(id -u):$$(id -g)" -v $(FOCUS_DIR)/../..:/docs -w /docs/architecture/focus $(NODE_IMAGE) node node_modules/vite/bin/vite.js --host 127.0.0.1 --port $(PORT) --strictPort --config vite.config.js --configLoader runner
