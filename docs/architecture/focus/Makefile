SHELL := /bin/bash
FOCUS_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
KIT_ROOT ?= /home/antoinefa/src/sentropic/.tmp/focus-cluster-mesh-decision-kit
NODE_IMAGE ?= node:24-bookworm-slim
ENV ?= test-architecture
RUN = docker run --rm --network none --cpus=1.5 --memory=1536m --pids-limit=256 --user "$$(id -u):$$(id -g)" -e NODE_OPTIONS=--max-old-space-size=1100 -v $(FOCUS_DIR)/../..:/docs -v $(KIT_ROOT):/kit:ro -v $(KIT_ROOT)/node_modules:/docs/architecture/focus/node_modules:ro -w /docs/architecture/focus $(NODE_IMAGE) node
.PHONY: build map test
map:
	$(RUN) build-map.mjs
build: map
	$(RUN) node_modules/vite/bin/vite.js build --config vite.config.js --configLoader runner
	$(RUN) portable.mjs
test: map
	$(RUN) --test mapping.test.mjs
	git diff --check
