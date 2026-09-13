SHELL := /bin/sh

BENCHMARK_ROOT := $(abspath ../..)
MAIN_ROOT := $(abspath $(BENCHMARK_ROOT)/../..)
T1_ROOT := $(abspath $(BENCHMARK_ROOT)/../refresh-018)
RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/candidates
NODE_IMAGE := node:22-bookworm-slim
ROOT_MODULES := radar-test-refresh-018_radar-test-root-node-modules
OWNER_SCOPE := cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
T1_COMMIT := f9b311da536bda2e1442d154a05599c35b482518
KEYRING_SOURCE := /home/antoinefa/.sentropic/llm-mesh-keyring

.PHONY: test prepare-prompts run-case quota

test:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs

prepare-prompts:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_T1_COMMIT=$(T1_COMMIT) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs

run-case:
	test "$(ENV)" = "test-refresh-benchmark"
	test -n "$(DOC)" && test -n "$(VARIANT)"
	docker run --rm --tmpfs /workspace --tmpfs /run --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(RESULTS),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=$(T1_ROOT) \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT) -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) \
	  -e BENCHMARK_OUTPUT_DIR=/results -e BENCHMARK_DOCUMENT=$(DOC) \
	  -e BENCHMARK_VARIANT=$(VARIANT) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/run-case.mjs'

quota:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --tmpfs /workspace --tmpfs /run \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) -e BENCHMARK_MODEL=gpt-5.6-sol \
	  -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/codex-preflight.mjs'
