SHELL := /bin/sh

BENCHMARK_ROOT := $(abspath ../..)
MAIN_ROOT := $(abspath $(BENCHMARK_ROOT)/../..)
T1_ROOT_LEGACY := $(abspath $(BENCHMARK_ROOT)/../refresh-018)
T1_ROOT := $(abspath $(BENCHMARK_ROOT)/../t1-profile-fix)
RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/candidates
V3_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v3
V4_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v4
V4_REAL_RESULTS := $(V4_RESULTS)/campaign-real
V5_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v5
V5_CONTROL_RESULTS := $(V5_RESULTS)/control
V5_CAP_RESULTS := $(V5_RESULTS)/cap-65536
V5_REAL_RESULTS := $(V5_RESULTS)/campaign-real
V6_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v6
V6_CONTROL_RESULTS := $(V6_RESULTS)/control
V6_REAL_RESULTS := $(V6_RESULTS)/campaign-real
V7_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v7
V7_CONTROL_RESULTS := $(V7_RESULTS)/control
V7_REAL_RESULTS := $(V7_RESULTS)/campaign-real
V8_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v8
V8_CONTROL_RESULTS := $(V8_RESULTS)/control
V8_REAL_RESULTS := $(V8_RESULTS)/campaign-real
V8_T1_ROOT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/t1-v8-f96356e9
V9_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v9
V9_REAL_RESULTS := $(V9_RESULTS)/campaign-real
V9_T1_ROOT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/t1-v9-f96356e9
V10_RESULTS := $(BENCHMARK_ROOT)/docs/reviews/refresh-benchmark/v10
V10_CONTROL_RESULTS := $(V10_RESULTS)/control
V10_REAL_RESULTS := $(V10_RESULTS)/campaign-real
V10_T1_ROOT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/t1-v10-50d91e0e
RUNTIME_TEXT := $(BENCHMARK_ROOT)/scratchtmp/refresh-benchmark/runtime-text
CAS_ROOT := $(MAIN_ROOT)/.lanes/conductor/tmp/graphify-cas/run-dryrun2-final-20260911T215911Z
NODE_IMAGE := node:22-bookworm-slim
ROOT_MODULES := radar-test-refresh-018_radar-test-root-node-modules
INTEGRATION_MODULES ?= $(ROOT_MODULES)
OWNER_SCOPE := cli:antoinefa-ROG-Flow-Z13-GZ302EA-GZ302EA
T1_COMMIT := f9b311da536bda2e1442d154a05599c35b482518
T1_COMMIT_V3 := 8f10ba1690a67e223851a467508f06e59d2ec668
T1_COMMIT_V5 := 5f227929ee71747cc7f3dc8245167b7d7f42c69d
T1_COMMIT_V6 := f96356e90a76b14b32ef0e913a82eb5805a9a413
T1_COMMIT_V7 := f96356e90a76b14b32ef0e913a82eb5805a9a413
T1_COMMIT_V8 := f96356e90a76b14b32ef0e913a82eb5805a9a413
T1_COMMIT_V9 := f96356e90a76b14b32ef0e913a82eb5805a9a413
T1_COMMIT_V10 := 50d91e0e12a0d990a5ba23cb1f01104d01bcbb78
KEYRING_SOURCE := /home/antoinefa/.sentropic/llm-mesh-keyring
BASELINE_GOLD := $(MAIN_ROOT)/.lanes/conductor/tmp/bench-llm/bench/v2/gold.json
PREFLIGHT_FILE ?= preflight-before.json
PREFLIGHT_MODEL ?= gpt-5.6-sol
GEMINI_DIAGNOSTIC_FILE ?= gemini-diagnostic.json
GEMINI_ENDPOINT ?= mesh
GEMINI_EFFORT ?= low
GEMINI_MODEL ?= gemini-3.8-flash-tiered

.PHONY: test test-v3 test-v4 test-v5 test-v6 test-v7 test-v8 test-v9 test-v10 test-diagnosis-v4 test-integration-contract-v4 install-v4-integration-deps check-v4-integration-ready preflight-v4-integration run-v4-integration run-v4-real provider-availability test-score-v3 test-score-v4 score-v3 score-v4 score-v6 score-v7 score-v8 score-v9 score-v10 freeze-blind-v3 freeze-blind-v4 freeze-blind-v6 freeze-blind-v7 freeze-blind-v8 runtime-text t1-v8-snapshot t1-v9-snapshot t1-v10-snapshot freeze-v3 freeze-v5 freeze-v6 freeze-v7 freeze-v8 replay-v9-freeze replay-v10-freeze prepare-prompts-v3 prepare-prompts-v5 prepare-prompts-v6 prepare-prompts-v7 prepare-prompts-v8 prepare-prompts-v10 run-v3 run-v4 run-v5-control run-v5-cap run-v5-real run-v6-control run-v6-real run-v7-control run-v7-real run-v8-control run-v8-real run-v9-real run-v10-control run-v10-real requalify-v6-control requalify-v7-receipts requalify-v8-receipts requalify-v9-receipts requalify-v10-receipts sonnet-env-status preflight-v3 gemini-diagnostic gemini-catalogue-probe gemini-catalogue-probe-check run-v3-sol-normal run-v4-all quota inspect-validation

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

t1-v8-snapshot:
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V8_T1_ROOT)
	git -C $(BENCHMARK_ROOT) archive $(T1_COMMIT_V8) | tar -x -C $(V8_T1_ROOT)

t1-v9-snapshot:
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V9_T1_ROOT)
	git -C $(BENCHMARK_ROOT) archive $(T1_COMMIT_V9) | tar -x -C $(V9_T1_ROOT)

t1-v10-snapshot:
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V10_T1_ROOT)
	git -C $(BENCHMARK_ROOT) archive $(T1_COMMIT_V10) | tar -x -C $(V10_T1_ROOT)

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

test-v5: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v5 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V5) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs

test-v6: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v6 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V6) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs tools/refresh-benchmark/runtime-config.test.mjs

test-v7: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v7 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V7) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs tools/refresh-benchmark/runtime-config.test.mjs

test-v8: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v8 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V8) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs tools/refresh-benchmark/runtime-config.test.mjs

test-v9: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v9 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V9) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs \
	    tools/refresh-benchmark/integration-contract.test.mjs \
	    tools/refresh-benchmark/runtime-config.test.mjs

test-v10: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v10 \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V10) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node --test tools/refresh-benchmark/benchmark.test.mjs \
	    tools/refresh-benchmark/integration-contract.test.mjs \
	    tools/refresh-benchmark/runtime-config.test.mjs

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
	    tools/refresh-benchmark/gemini-diagnostic.test.mjs \
	    tools/refresh-benchmark/pinned-wire-planner.test.mjs \
	    tools/refresh-benchmark/release-readiness.test.mjs \
	    tools/refresh-benchmark/runtime-config.test.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/run-case.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/requalify-v6.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/requalify-v7-receipts.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/freeze-blind-v6.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/score-v6.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/check-release-readiness.mjs
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/provider-availability.mjs

install-v4-integration-deps:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --tmpfs /workspace \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/repo,readonly \
	  --mount type=volume,source=$(INTEGRATION_MODULES),target=/workspace/node_modules \
	  -w /workspace node:24-bookworm-slim sh -c 'cp -a /repo/. /workspace/ && npm ci'

check-v4-integration-ready:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=volume,source=$(INTEGRATION_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_GRAPHIFY_PACKAGE_JSON=/workspace/node_modules/@sentropic/graphify/package.json \
	  -e BENCHMARK_MESH_PACKAGE_JSON=/workspace/node_modules/@sentropic/llm-mesh/package.json \
	  -w /src $(NODE_IMAGE) node tools/refresh-benchmark/check-release-readiness.mjs

preflight-v4-integration: check-v4-integration-ready
	$(MAKE) gemini-diagnostic GEMINI_ENDPOINT=package \
	  GEMINI_DIAGNOSTIC_FILE=gemini-integration-preflight.json \
	  ROOT_MODULES=$(INTEGRATION_MODULES) ENV=$(ENV)

run-v4-integration: check-v4-integration-ready
	$(MAKE) run-v4 DOC=$(DOC) VARIANT=$(VARIANT) ATTEMPT=$(ATTEMPT) \
	  RETRY_REASON='$(RETRY_REASON)' ROOT_MODULES=$(INTEGRATION_MODULES) ENV=$(ENV)

run-v4-real: check-v4-integration-ready
	mkdir -p $(V4_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v4 \
	  CAMPAIGN_RESULTS=$(V4_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V3) \
	  T1_CAMPAIGN_ROOT=$(T1_ROOT_LEGACY) \
	  ROOT_MODULES=$(INTEGRATION_MODULES) ATTEMPT=$(ATTEMPT) \
	  RETRY_REASON='$(RETRY_REASON)' ENV=$(ENV)

provider-availability:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --tmpfs /workspace --tmpfs /run \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V4_RESULTS),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(INTEGRATION_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) \
	  -e BENCHMARK_AVAILABILITY_OUTPUT=/results/provider-availability.json \
	  -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/provider-availability.mjs'

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

score-v6:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V6_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_RESULT_ROOT=/results/campaign-real \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v6.mjs

score-v7:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V7_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v7 \
	  -e BENCHMARK_RESULT_ROOT=/results/campaign-real \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v6.mjs

score-v8:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V8_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v8 \
	  -e BENCHMARK_VARIANT=gemini-high -e BENCHMARK_RESULT_ROOT=/results/campaign-real \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v6.mjs

score-v9:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V9_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v9 \
	  -e BENCHMARK_VARIANT=gemini-low -e BENCHMARK_RESULT_ROOT=/results/campaign-real \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v6.mjs

score-v10:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V10_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v10 \
	  -e BENCHMARK_VARIANT=gemini-low -e BENCHMARK_RESULT_ROOT=/results/campaign-real \
	  -e BENCHMARK_SCORE_OUTPUT=/results/comparison.json -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/score-v6.mjs

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

freeze-blind-v6:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V6_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_BUNDLE_ROOT=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-blind-v6.mjs

freeze-blind-v7:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V7_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v7 \
	  -e BENCHMARK_BUNDLE_ROOT=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  node tools/refresh-benchmark/freeze-blind-v6.mjs

freeze-blind-v8:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V8_RESULTS),target=/results \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v8 \
	  -e BENCHMARK_VARIANT=gemini-high -e BENCHMARK_BUNDLE_ROOT=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-blind-v6.mjs

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

freeze-v5: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V5_RESULTS)/candidates
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V5_RESULTS),target=/results \
	  -e BENCHMARK_CAMPAIGN=v5 -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_CAS_ROOT=$(CAS_ROOT) -e BENCHMARK_BASELINE_GOLD=$(BASELINE_GOLD) \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_OUTPUT_DIR=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-v3.mjs

freeze-v6: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V6_RESULTS)/candidates
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V6_RESULTS),target=/results \
	  -e BENCHMARK_CAMPAIGN=v6 -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_CAS_ROOT=$(CAS_ROOT) -e BENCHMARK_BASELINE_GOLD=$(BASELINE_GOLD) \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_OUTPUT_DIR=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-v3.mjs

freeze-v7: runtime-text
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V7_RESULTS)/candidates
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V7_RESULTS),target=/results \
	  -e BENCHMARK_CAMPAIGN=v7 -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_CAS_ROOT=$(CAS_ROOT) -e BENCHMARK_BASELINE_GOLD=$(BASELINE_GOLD) \
	  -e BENCHMARK_T1_ROOT=$(T1_ROOT) -e BENCHMARK_OUTPUT_DIR=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-v3.mjs

freeze-v8: runtime-text t1-v8-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	mkdir -p $(V8_RESULTS)/candidates
	docker run --rm --network none \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V8_RESULTS),target=/results \
	  -e BENCHMARK_CAMPAIGN=v8 -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_CAS_ROOT=$(CAS_ROOT) -e BENCHMARK_BASELINE_GOLD=$(BASELINE_GOLD) \
	  -e BENCHMARK_T1_ROOT=$(V8_T1_ROOT) -e BENCHMARK_OUTPUT_DIR=/results \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) node tools/refresh-benchmark/freeze-v3.mjs

replay-v9-freeze:
	test "$(ENV)" = "test-t1-model-benchmark"
	test ! -e $(V9_RESULTS)/manifest.json
	mkdir -p $(V9_RESULTS)
	cp $(V7_RESULTS)/manifest.json $(V9_RESULTS)/manifest.json
	cp $(V7_RESULTS)/prompt-freeze.json $(V9_RESULTS)/prompt-freeze.json
	cp $(V7_RESULTS)/manual-oracle.json $(V9_RESULTS)/manual-oracle.json
	sed -i 's/"campaign":"v7"/"campaign":"v9"/' $(V9_RESULTS)/manifest.json $(V9_RESULTS)/prompt-freeze.json

replay-v10-freeze:
	test "$(ENV)" = "test-t1-model-benchmark"
	test ! -e $(V10_RESULTS)/manifest.json
	mkdir -p $(V10_RESULTS)
	cp $(V9_RESULTS)/manifest.json $(V10_RESULTS)/manifest.json
	cp $(V9_RESULTS)/manual-oracle.json $(V10_RESULTS)/manual-oracle.json
	sed -i 's/"campaign":"v9"/"campaign":"v10"/' $(V10_RESULTS)/manifest.json

prepare-prompts-v3:
	test "$(ENV)" = "test-refresh-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT_LEGACY),target=/t1-source,readonly \
	  --mount type=bind,source=$(V3_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v3 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V3) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

prepare-prompts-v5:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V5_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v5 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V5) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

prepare-prompts-v6:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V6_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v6 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V6) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

prepare-prompts-v7:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V7_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v7 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V7) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

prepare-prompts-v8: t1-v8-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V8_T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V8_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v8 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V8) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

prepare-prompts-v10: t1-v10-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V10_T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V10_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_CAMPAIGN=v10 \
	  -e BENCHMARK_FREEZE_OUTPUT=/results/prompt-freeze.json \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V10) \
	  -w $(BENCHMARK_ROOT) $(NODE_IMAGE) \
	  sh -c 'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/prepare-prompts.mjs'

run-v3:
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v3 \
	  CAMPAIGN_RESULTS=$(V3_RESULTS)/candidates T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V3) \
	  T1_CAMPAIGN_ROOT=$(T1_ROOT_LEGACY) ENV=$(ENV)

run-v4:
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v4 \
	  CAMPAIGN_RESULTS=$(V4_RESULTS)/candidates T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V3) \
	  T1_CAMPAIGN_ROOT=$(T1_ROOT_LEGACY) ENV=$(ENV)

run-v5-control: check-v4-integration-ready
	mkdir -p $(V5_CONTROL_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-low CAMPAIGN=v5 \
	  CAMPAIGN_RESULTS=$(V5_CONTROL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V5) ENV=$(ENV)

run-v5-cap: check-v4-integration-ready
	mkdir -p $(V5_CAP_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-low CAMPAIGN=v5 \
	  CAMPAIGN_RESULTS=$(V5_CAP_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V5) \
	  BENCHMARK_MAX_OUTPUT_TOKENS=65536 ENV=$(ENV)

run-v5-real: check-v4-integration-ready
	mkdir -p $(V5_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v5 \
	  CAMPAIGN_RESULTS=$(V5_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V5) \
	  ATTEMPT=$(ATTEMPT) RETRY_REASON='$(RETRY_REASON)' ENV=$(ENV)

run-v6-control: check-v4-integration-ready
	mkdir -p $(V6_CONTROL_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-low CAMPAIGN=v6 \
	  CAMPAIGN_RESULTS=$(V6_CONTROL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V6) ENV=$(ENV)

run-v6-real: check-v4-integration-ready
	mkdir -p $(V6_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v6 \
	  CAMPAIGN_RESULTS=$(V6_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V6) \
	  ATTEMPT=$(ATTEMPT) RETRY_REASON='$(RETRY_REASON)' ENV=$(ENV)

run-v7-control: check-v4-integration-ready
	mkdir -p $(V7_CONTROL_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-low CAMPAIGN=v7 \
	  CAMPAIGN_RESULTS=$(V7_CONTROL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V7) ENV=$(ENV)

run-v7-real: check-v4-integration-ready
	mkdir -p $(V7_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=$(VARIANT) CAMPAIGN=v7 \
	  CAMPAIGN_RESULTS=$(V7_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V7) \
	  ATTEMPT=$(ATTEMPT) RETRY_REASON='$(RETRY_REASON)' ENV=$(ENV)

run-v8-control: check-v4-integration-ready t1-v8-snapshot
	mkdir -p $(V8_CONTROL_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-high CAMPAIGN=v8 \
	  CAMPAIGN_RESULTS=$(V8_CONTROL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V8) \
	  T1_CAMPAIGN_ROOT=$(V8_T1_ROOT) ENV=$(ENV)

run-v8-real: check-v4-integration-ready t1-v8-snapshot
	mkdir -p $(V8_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=gemini-high CAMPAIGN=v8 \
	  CAMPAIGN_RESULTS=$(V8_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V8) \
	  T1_CAMPAIGN_ROOT=$(V8_T1_ROOT) ATTEMPT=$(ATTEMPT) \
	  RETRY_REASON='$(RETRY_REASON)' ENV=$(ENV)

run-v9-real: check-v4-integration-ready t1-v9-snapshot
	test -f $(V9_RESULTS)/manifest.json -a -f $(V9_RESULTS)/prompt-freeze.json
	mkdir -p $(V9_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=gemini-low CAMPAIGN=v9 \
	  CAMPAIGN_RESULTS=$(V9_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V9) \
	  T1_CAMPAIGN_ROOT=$(V9_T1_ROOT) ENV=$(ENV)

run-v10-control: check-v4-integration-ready t1-v10-snapshot
	mkdir -p $(V10_CONTROL_RESULTS)
	$(MAKE) run-case DOC=valcourt-2026-06-01-agenda VARIANT=gemini-low CAMPAIGN=v10 \
	  CAMPAIGN_RESULTS=$(V10_CONTROL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V10) \
	  T1_CAMPAIGN_ROOT=$(V10_T1_ROOT) ENV=$(ENV)

run-v10-real: check-v4-integration-ready t1-v10-snapshot
	test -f $(V10_RESULTS)/manifest.json -a -f $(V10_RESULTS)/prompt-freeze.json
	mkdir -p $(V10_REAL_RESULTS)
	$(MAKE) run-case DOC=$(DOC) VARIANT=gemini-low CAMPAIGN=v10 \
	  CAMPAIGN_RESULTS=$(V10_REAL_RESULTS) T1_CAMPAIGN_COMMIT=$(T1_COMMIT_V10) \
	  T1_CAMPAIGN_ROOT=$(V10_T1_ROOT) ENV=$(ENV)

requalify-v6-control:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V6_CONTROL_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_RESULT_ROOT=/results -e BENCHMARK_DOCUMENT=valcourt-2026-06-01-agenda \
	  -e BENCHMARK_T1_COMMIT=$(T1_COMMIT_V6) -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/requalify-v6.mjs'

requalify-v7-receipts:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V7_REAL_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_RESULT_ROOT=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/requalify-v7-receipts.mjs'

requalify-v8-receipts: t1-v8-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V8_T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V8_REAL_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_CAMPAIGN=v8 -e BENCHMARK_VARIANT=gemini-high \
	  -e BENCHMARK_RESULT_ROOT=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/requalify-v7-receipts.mjs'

requalify-v9-receipts: t1-v9-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V9_T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V9_REAL_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_CAMPAIGN=v9 -e BENCHMARK_VARIANT=gemini-low \
	  -e BENCHMARK_RESULT_ROOT=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/requalify-v7-receipts.mjs'

requalify-v10-receipts: t1-v10-snapshot
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none --tmpfs /workspace --tmpfs /tmp \
	  --mount type=bind,source=$(MAIN_ROOT),target=$(MAIN_ROOT),readonly \
	  --mount type=bind,source=$(V10_T1_ROOT),target=/t1-source,readonly \
	  --mount type=bind,source=$(V10_REAL_RESULTS),target=/results \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_CAMPAIGN=v10 -e BENCHMARK_VARIANT=gemini-low \
	  -e BENCHMARK_RESULT_ROOT=/results -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/requalify-v7-receipts.mjs'

sonnet-env-status:
	@if test -n "$$ANTHROPIC_API_KEY"; then echo present; else echo absent; fi

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
	  -e BENCHMARK_MODEL=$(GEMINI_MODEL) -e BENCHMARK_EFFORT=$(GEMINI_EFFORT) \
	  -e BENCHMARK_ENDPOINT=$(GEMINI_ENDPOINT) -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/gemini-preflight.mjs'

gemini-catalogue-probe-check:
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --network none \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  -w /src $(NODE_IMAGE) node --check tools/refresh-benchmark/gemini-catalogue-probe.mjs

gemini-catalogue-probe: gemini-catalogue-probe-check
	test "$(ENV)" = "test-t1-model-benchmark"
	docker run --rm --tmpfs /workspace --tmpfs /run \
	  --mount type=bind,source=$(BENCHMARK_ROOT),target=/src,readonly \
	  --mount type=bind,source=$(V4_RESULTS),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(INTEGRATION_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) \
	  -e GEMINI_CATALOGUE_D_P1_OUTPUT=/results/gemini-pro-catalogue-d-p1.json \
	  -e GEMINI_CATALOGUE_D_P2_OUTPUT=/results/gemini-pro-catalogue-d-p2.json \
	  -e GEMINI_PROBE_B2_OUTPUT=/results/gemini-pro-suffix-probe-b2.json \
	  -e GEMINI_PROBE_E_OUTPUT=/results/gemini-pro-suffix-probe-e.json \
	  -e GEMINI_PROBE_F_OUTPUT=/results/gemini-pro-suffix-probe-f.json \
	  -w /src $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && exec node tools/refresh-benchmark/gemini-catalogue-probe.mjs'

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
	  --mount type=bind,source=$(or $(T1_CAMPAIGN_ROOT),$(T1_ROOT)),target=/t1-source,readonly \
	  --mount type=bind,source=$(or $(CAMPAIGN_RESULTS),$(RESULTS)),target=/results \
	  --mount type=bind,source=$(KEYRING_SOURCE),target=/keyring-source,readonly \
	  --mount type=volume,source=$(ROOT_MODULES),target=/workspace/node_modules,readonly \
	  -e BENCHMARK_REPOSITORY_ROOT=$(BENCHMARK_ROOT) \
	  -e BENCHMARK_T1_ROOT=/workspace/t1 \
	  -e BENCHMARK_T1_COMMIT=$(or $(T1_CAMPAIGN_COMMIT),$(T1_COMMIT)) -e BENCHMARK_CAMPAIGN=$(CAMPAIGN) \
	  -e BENCHMARK_OWNER_SCOPE=$(OWNER_SCOPE) \
	  -e BENCHMARK_OUTPUT_DIR=/results -e BENCHMARK_DOCUMENT=$(DOC) \
	  -e BENCHMARK_VARIANT=$(VARIANT) -e BENCHMARK_ATTEMPT=$(or $(ATTEMPT),1) \
	  -e BENCHMARK_MAX_OUTPUT_TOKENS=$(BENCHMARK_MAX_OUTPUT_TOKENS) \
	  -e BENCHMARK_RETRY_REASON='$(RETRY_REASON)' -w $(BENCHMARK_ROOT) $(NODE_IMAGE) sh -c \
	  'cp -a /keyring-source /run/benchmark-keyring && chmod -R u+rw /run/benchmark-keyring && cp -a /t1-source /workspace/t1 && exec /workspace/node_modules/.bin/tsx tools/refresh-benchmark/run-case.mjs'

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
