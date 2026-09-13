SHELL := /bin/bash
DOC_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
ENV ?= docs-architecture
PORT ?= 5188
FOCUS_RUNTIME ?= /home/antoinefa/.npm-global/lib/node_modules/@sentropic/h2a/node_modules/@sentropic/track/dist/focus-vendor
NODE_IMAGE ?= node:24-bookworm-slim

.PHONY: render assets serve verify
assets:
	mkdir -p $(DOC_DIR)/vendor
	curl --fail --silent --show-error --location --max-time 60 https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js -o $(DOC_DIR)/vendor/marked.min.js
	curl --fail --silent --show-error --location --max-time 60 https://cdn.jsdelivr.net/npm/dompurify@3.2.6/dist/purify.min.js -o $(DOC_DIR)/vendor/purify.min.js
	curl --fail --silent --show-error --location --max-time 60 https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js -o $(DOC_DIR)/vendor/mermaid.min.js

render:
	test -f $(FOCUS_RUNTIME)/index.js
	docker run --rm --user "$$(id -u):$$(id -g)" --network none -v $(FOCUS_RUNTIME):/focus:ro -v $(DOC_DIR)/..:/docs -w /docs $(NODE_IMAGE) node architecture/render-focus.mjs

serve:
	docker run --rm --name radar-architecture-preview -p 127.0.0.1:$(PORT):8080 --user "$$(id -u):$$(id -g)" --read-only --cap-drop ALL --security-opt no-new-privileges -v $(DOC_DIR)/..:/docs:ro -w /docs $(NODE_IMAGE) node architecture/serve.mjs

verify:
	test -s $(DOC_DIR)/architecture.html
	docker run --rm --network none -v $(DOC_DIR)/..:/docs:ro $(NODE_IMAGE) node /docs/architecture/verify-resources.mjs
	docker run --rm --network none -v $(DOC_DIR):/src:ro $(NODE_IMAGE) node --check /src/viewer.js
	docker run --rm --network none -v $(DOC_DIR):/src:ro $(NODE_IMAGE) node --check /src/render-focus.mjs
	git diff --check
