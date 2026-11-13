# Standalone entry point: no repository Makefile or environment file is loaded.
ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
BENCH_DIR ?= $(ROOT)/tools/bench-v11
BENCH_REFERENCE ?= /tmp/bench-wonder
RUN_DIR ?= /tmp/radar-cp-plus
KEYRING_COPY ?= $(RUN_DIR)/keyring
SEAT_KEYRING ?= $(HOME)/.sentropic/llm-mesh-keyring
MUSE_BIN ?= $(HOME)/.local/bin/muse-bin-1.4.18-R8587.1
IMAGE ?= node:24-bookworm-slim
CONCURRENCY ?= 4
MUSE_EFFORT ?= xhigh
STOP_WEEKLY_PCT ?= 85
DOCKER = docker run --rm --network host --user $(shell id -u):$(shell id -g) -v $(ROOT):$(ROOT) -v $(RUN_DIR):$(RUN_DIR) -w $(RUN_DIR)/empty -e BENCH_DIR=$(BENCH_DIR) -e MUSE_EFFORT=$(MUSE_EFFORT) -e STOP_WEEKLY_PCT=$(STOP_WEEKLY_PCT)
SCRIPT = $(BENCH_DIR)/full
.PHONY: setup freeze replay validate filter audit score report pdf checksums
setup:
	@mkdir -p "$(RUN_DIR)/empty"
	@test ! -e "$(KEYRING_COPY)"
	@cp -a "$(SEAT_KEYRING)" "$(KEYRING_COPY)"
freeze:
	@$(DOCKER) $(IMAGE) node $(SCRIPT)/prepare-prompts.mjs
replay:
	@test -n "$(BENCH_MESH_DIR)" -a -n "$(BENCHMARK_OWNER_SCOPE)"
	@$(DOCKER) -v $(BENCH_MESH_DIR):$(BENCH_MESH_DIR):ro -e BENCH_MESH_DIR=$(BENCH_MESH_DIR) -e BENCH_KEYRING=$(KEYRING_COPY) -e BENCHMARK_OWNER_SCOPE=$(BENCHMARK_OWNER_SCOPE) $(IMAGE) node $(SCRIPT)/run-arm-astra-mesh.mjs medium $(CONCURRENCY)
validate:
	@$(DOCKER) $(IMAGE) node $(SCRIPT)/validate-outputs.mjs $(SCRIPT)/arms/astra-medium-rejeu
filter:
	@$(DOCKER) -v $(MUSE_BIN):/usr/local/bin/muse:ro -v $(HOME)/.config/muse:$(HOME)/.config/muse -v $(HOME)/.local/share/muse:$(HOME)/.local/share/muse -v $(HOME)/.codex/skills:$(HOME)/.codex/skills:ro -v $(HOME)/.npm-global:$(HOME)/.npm-global:ro -e HOME=$(HOME) -e PATH=$(HOME)/.npm-global/bin:/usr/local/bin:/usr/bin:/bin -e MUSE_CWD=$(RUN_DIR)/empty $(IMAGE) node $(SCRIPT)/run-cascade-muse.mjs $(CONCURRENCY)
audit:
	@$(DOCKER) $(IMAGE) node $(SCRIPT)/audit-muse-surface.mjs $(SCRIPT)/arms/cp-plus-muse13-$(MUSE_EFFORT)
score:
	@$(DOCKER) $(IMAGE) node $(SCRIPT)/score-cp-plus.mjs
report:
	@$(DOCKER) -v $(BENCH_REFERENCE):$(BENCH_REFERENCE):ro -w $(ROOT) -e BENCH_REPORT=v12 $(IMAGE) node $(BENCH_DIR)/build-v11-report.mjs $(BENCH_REFERENCE)
pdf:
	@$(DOCKER) $(IMAGE) node $(BENCH_DIR)/print-report.mjs
checksums:
	@cd $(BENCH_DIR) && sha256sum -c SHA256SUMS
