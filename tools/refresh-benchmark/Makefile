SHELL := /bin/sh

BENCHMARK_ROOT := $(abspath ../..)
MAIN_ROOT := $(abspath $(BENCHMARK_ROOT)/../..)
T1_ROOT := $(abspath $(BENCHMARK_ROOT)/../refresh-018)
RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/candidates
V3_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v3
V4_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v4
RUNTIME_TEXT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/runtime-text
CAS_ROOT := $(MAIN_ROOT)/.lanes/conductor/tmp/graphify-cas/run-dryrun2-final-20260911T215911Z
NODE_IMAGE := node:22-bookworm-slim
ROOT_MODULES := radar-test-refresh-018_radar-test-root-node-modules
INTEGRATION_MODULES ?= $(ROOT_MODULES)
OWNER_SCOPE := cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
T1_COMMIT := f9b311da536bda2e1442d154a05599c35b482518
T1_COMMIT_V3 := 8f10ba1690a67e223851a467508f06e59d2ec668
KEYRING_SOURCE := /home/antoinefa/.sentropic/llm-mesh-keyring
BASELINE_GOLD := $(MAIN_ROOT)/.lanes/conductor/tmp/bench-llm/bench/v2/gold.json
PREFLIGHT_FILE ?= preflight-before.json
PREFLIGHT_MODEL ?= gpt-5.6-sol
GEMINI_DIAGNOSTIC_FILE ?= gemini-diagnostic.json
GEMINI_ENDPOINT ?= mesh
GEMINI_EFFORT ?= low

.PHONY: test test-v3 test-v4 test-diagnosis-v4 test-integration-contract-v4 check-v4-integration-ready test-score-v3 test-score-v4 score-v3 score-v4 freeze-blind-v3 freeze-blind-v4 runtime-text freeze-v3 prepare-prompts-v3 run-v3 run-v4 preflight-v3 gemini-diagnostic run-v3-sol-normal run-v4-all quota inspect-validation

WATERLOO_18 := c18dcea9adf05d028f5ee1c71b2244fb3dc5e83acdab86996c81401d4038cebd
WICKHAM := 7d17c277199e3664a1c49ddd92f34f490f269578194d504a97380905826c0fa0
ST_BART := ac5306d7efd793dc3b456afaf203b1d1a8e495456099ac560457f56591953845
ST_ETIENNE := 27799681a178dd23d99596d78811ff5c678be649901748e0eca3d9b0eb26c45d
WATERLOO_31 := 132187c152d73a08da3c2d48eece98d4e415379c899bdc4c8dfb261d0d2b372e
LAC_16 := 6bfd190a0aff3ea2679edf5bdf7e727161d24052ce08c0c385427b0ec3c07a96
VALCOURT := 31df8f116d84d1f50ef34a2aa8f746c6025c56089383b27345b901c8e45c026d
V3_DOCS := lac-des-seize-iles-2026-09-agenda saint-etienne-de-bolton-2026-08-04 valcourt-2026-06-01-agenda saint-barthelemy-2026-09-08 waterloo-2026-08-18
RUNTIME_FILES := $(addprefix $(RUNTIME_TEXT)/,$(addsuffix .txt,$(WATERLOO_18) $(WICKHAM) $(ST_BART) $(ST_ETIENNE) $(WATERLOO_31) $(LAC_16) $(VALCOURT)))

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
$(RUNTIME_TEXT)/$(LAC_16).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/lac-des-seize-iles/corpus/$(LAC_16).pdf $@
$(RUNTIME_TEXT)/$(VALCOURT).txt:
	mkdir -p $(RUNTIME_TEXT)
	pdftotext -q -enc UTF-8 $(CAS_ROOT)/workers/valcourt--le-val-saint-francois/corpus/$(VALCOURT).pdf $@

test: runtime-text
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs

test-v3: runtime-text
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v3 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V3) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs

test-v4: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v3 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V3) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs tools/refresh-benchmark/runtime-config.test.mjs \
	    tools/refresh-benchmark/gemini-diagnostic.test.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/gemini-preflight.mjs

test-diagnosis-v4:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=/src -w /src $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/diagnosis-v4.test.mjs

test-integration-contract-v4:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=/src -w /src $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/integration-contract.test.mjs \
	    tools/refresh-benchmark/release-readiness.test.mjs \
	    tools/refresh-benchmark/runtime-config.test.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/run-case.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/check-release-readiness.mjs

check-v4-integration-ready:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=volume,source=$(INTEGRATION_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_GRAPHIFY_PACKAGE_JSON=/workspace/node_modules/@sentropic/graphify/package.json \
	  -e BENCHMARK_MESH_PACKAGE_JSON=/workspace/node_modules/@sentropic/llm-mesh-refresh/package.json \
	  -w /src $(NODE_IMAGE) node tools/refresh-benchmark/check-release-readiness.mjs

test-score-v3:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --test tools/refresh-benchmark/score-v3.test.mjs

test-score-v4:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --test tools/refresh-benchmark/score-v4.test.mjs

score-v4:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V4_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_SCORE_ROOT=/results \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -e BENCHMARK_IMPORT_ONLY=1 \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v4.mjs

score-v3:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  -e BENCHMARK_SCORE_ROOT=/results -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json \
	  -w /src $(NODE_IMAGE) node tools/refresh-benchmark/score-v3.mjs

freeze-blind-v3:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=/src -e BENCHMARK_BUNDLE_ROOT=/results \
	  -w /src $(NODE_IMAGE) node tools/refresh-benchmark/freeze-blind-v3.mjs

freeze-blind-v4:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V4_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_BUNDLE_ROOT=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-blind-v4.mjs

freeze-v3: runtime-text
	test "$(ENV)" = "test-refresh-benchmark"
	mkdir -p $(V3_RESULTS)/candidates
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAS_ROOT=$(CAS_ROOT) \
	  -e BENCHMARK_BASELINE_GOLD=$(BASELINE_GOLD) -e BENCHMARK_T1_ROOT=$(T1_ROOT) \
	  -e BENCHMARK_OUTPUT_DIR=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/freeze-v3.mjs

prepare-prompts-v3:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v3 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V3) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs

run-v3:
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v3 \
	  CAMPAIGN_RESULTS=$(V3_RESULTS)/candidates T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V3) ENV=$(ENV)

run-v4:
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v4 \
	  CAMPAIGN_RESULTS=$(V4_RESULTS)/candidates T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V3) ENV=$(ENV)

run-v4-all:
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V4_RESULTS)/candidates
	printf '%s\n' $(V3_DOCS) | xargs -n1 -P2 sh -c \
	  '$(MAKE) run-v4 DOC="$$1" VARIANT="$(VARIANT)" ENV=test-t1-model-benchmark' _

preflight-v3:
	test "$(ENV)" = "test-refresh-benchmark" -o "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --tmpfs /workspace --tmpfs /run \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_PREFLIGHT_OUTPUT=/results/$(PREFLIGHT_FILE) \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) -e BENCHMARK_MODEL=$(PREFLIGHT_MODEL) \
	  -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/codex-preflight.mjs'

gemini-diagnostic:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --tmpfs /workspace --tmpfs /run \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V4_RESULTS),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) -e BENCHMARK_PREFLIGHT_OUTPUT=/results/$(GEMINI_DIAGNOSTIC_FILE) \
	  -e BENCHMARK_MODEL=gemini-3.8-flash -e BENCHMARK_EFFORT=$(GEMINI_EFFORT) \
	  -e BENCHMARK_ENDPOINT=$(GEMINI_ENDPOINT) -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/gemini-preflight.mjs'

run-v3-sol-normal:
	test "$(ENV)" = "test-refresh-benchmark"
	test -f $(V3_RESULTS)/preflight-before.json
	printf '%s\n' $(V3_DOCS) | xargs -n1 -P3 sh -c \
	  '$(MAKE) run-v3 DOC="$$1" VARIANT=sol-normal ENV=test-refresh-benchmark' _

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
	test "$(ENV)" = "test-refresh-benchmark" -o "$(ENV)" = "test-t1-model-benchmark"
	test -n "$(DOC)" && test -n "$(VARIANT)"
	docker run --rm --tmpfs /workspace --tmpfs /run --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(or $(CAMPAIGN_RESULTS),$(RESULTS)),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=$(T1_ROOT)/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=$(T1_ROOT) \
	  -e BENCHMARK_T1_COMMIT=$(or $(T1_CAMPAIGN_COMMIT),$(T1_COMMIT)) -e BENCHMARK_CAMPAIGN=$(CAMPAIGN) \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) \
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
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) -e BENCHMARK_MODEL=$(PREFLIGHT_MODEL) \
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
