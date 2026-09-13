SHELL := /bin/sh

BENCHMARK_ROOT := $(abspath ../..)
MAIN_ROOT := $(abspath $(BENCHMARK_ROOT)/../..)
T1_ROOT := $(abspath $(BENCHMARK_ROOT)/../refresh-018)
RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/candidates
RUNTIME_TEXT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/runtime-text
CAS_ROOT := $(MAIN_ROOT)/.lanes/conductor/tmp/graphify-cas/run-dryrun2-final-20260911T215911Z
NODE_IMAGE := node:22-bookworm-slim
ROOT_MODULES := radar-test-refresh-018_radar-test-root-node-modules
OWNER_SCOPE := cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
T1_COMMIT := f9b311da536bda2e1442d154a05599c35b482518
KEYRING_SOURCE := /home/antoinefa/.sentropic/llm-mesh-keyring

.PHONY: test runtime-text prepare-prompts run-case quota inspect-validation

WATERLOO_18 := c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd
WICKHAM := 7d17c277199e3664a1c49ddd92f34f490f269578194d504a97380905826c0fa0
ST_BART := ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845
ST_ETIENNE := 27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d
WATERLOO_31 := 132187c152d73a08da3c2d48eece98d4e415379c899bdc4c8dfb261d0d2b372e
RUNTIME_FILES := $(addprefix $(RUNTIME_TEXT)/,$(addsuffix .txt,$(WATERLOO_18) $(WICKHAM) $(ST_BART) $(ST_ETIENNE) $(WATERLOO_31)))

runtime-text: $(RUNTIME_FILES)

$(RUNTIME_TEXT)/$(WATERLOO_18).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/waterloo/corpus/$(WATERLOO_18).pdf $@
$(RUNTIME_TEXT)/$(WICKHAM).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/wickham/corpus/$(WICKHAM).pdf $@
$(RUNTIME_TEXT)/$(ST_BART).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/saint-barthelemy/corpus/$(ST_BART).pdf $@
$(RUNTIME_TEXT)/$(ST_ETIENNE).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/saint-etienne-de-bolton/corpus/$(ST_ETIENNE).pdf $@
$(RUNTIME_TEXT)/$(WATERLOO_31).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/waterloo/corpus/$(WATERLOO_31).pdf $@

test: runtime-text
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs

prepare-prompts: runtime-text
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_T1_COMMIT=$(T1_COMMIT) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs

run-case: runtime-text
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
	  -e BENCHMARK_VARIANT=$(VARIANT) -e BENCHMARK_ATTEMPT=$(or $(ATTEMPT),1) \
	  -e BENCHMARK_RETRY_REASON='$(RETRY_REASON)' -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
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

inspect-validation:
	test "$(ENV)" = "test-refresh-benchmark"
	test -n "$(OUTPUT)"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=$(T1_ROOT) \
	  -e BENCHMARK_OUTPUT=$(OUTPUT) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  /workspace/node_modules/.bin/tsx tools/refresh-benchmark/inspect-validation.mjs
