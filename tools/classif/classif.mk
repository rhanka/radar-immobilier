# Classification pilot tooling (plan-pilote-v2 §B-L0, §C). Included from the root Makefile.
# Host Node on purpose (exception BRCLASSIF-EX1): the targets drive host-only CLIs
# (kubectl, s5cmd, muse, agy, claude, vibe) and use node: built-ins only (no npm dependency).
# Private outputs live in $(CLASSIF_HOME) (mode 700), never in the repository.
# No DB, cluster or S3 write: DB = SELECT in a READ ONLY transaction, S3 = s5cmd cp/ls only.

CLASSIF_NODE   ?= node
CLASSIF_HOME   ?= $(HOME)/.local/share/radar-classif
CLASSIF_SEED   ?=
CLASSIF_DIR    := tools/classif
export CLASSIF_HOME

.PHONY: classif-test classif-check classif-guard-unseal classif-l0-pvs classif-l0-signals classif-l0-probe classif-sandbox-build

classif-test: ## Classification pilot: unit tests (synthetic fixtures only)
	@mkdir -p -m 700 "$(CLASSIF_HOME)/tmp-test"
	TMPDIR="$(CLASSIF_HOME)/tmp-test" $(CLASSIF_NODE) --test $(CLASSIF_DIR)/test/*.test.mjs

classif-check: ## Classification pilot: syntax check of every module
	@set -e; for f in $$(find $(CLASSIF_DIR) -name '*.mjs' | sort); do $(CLASSIF_NODE) --check "$$f"; done; echo "[classif-check] OK"

# Guardian act, run ONCE by the conductor: REFERENCE_C_KEY and CLASSIF_EVAL_KEY must be in the
# process environment (injected at launch). Unseals reference-c in memory, seals the evaluation
# set into docs/spec/reports/classif-eval/, writes label-free guard material, prints hashes only.
classif-guard-unseal: ## Classification pilot: unseal reference-c in memory + seal the evaluation set (conductor-run)
	@test "$(ENV)" = "preprod" || { echo "[classif-guard-unseal] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/guard/unseal.mjs

classif-l0-pvs: ## Classification pilot: draw 120 recent PVs without signal + fetch text read-only (CLASSIF_SEED=...)
	@test "$(ENV)" = "preprod" || { echo "[classif-l0-pvs] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l0/pvs.mjs --seed "$(CLASSIF_SEED)" $(CLASSIF_ARGS)

classif-l0-signals: ## Classification pilot: signal pool + strata (DRY_RUN=1 prints strata; draw needs exclusions.json)
	@test "$(ENV)" = "preprod" || { echo "[classif-l0-signals] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l0/signals.mjs --seed "$(CLASSIF_SEED)" $(if $(DRY_RUN),--dry-run,) $(CLASSIF_ARGS)

classif-l0-probe: ## Classification pilot: 12 route probes on one synthetic non-Steve item
	@test "$(ENV)" = "preprod" || { echo "[classif-l0-probe] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l0/probe.mjs $(CLASSIF_ARGS)

classif-sandbox-build: ## Classification pilot: refuse any sandbox file hitting a fingerprint list (DIR=<sandbox>)
	@test -n "$(DIR)" || { echo "Pass DIR=<sandbox dir>"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/guard/sandbox-build.mjs "$(DIR)"

# Dependencies of the B′ classifier (repository TypeScript run with tsx in a node:24 container).
# Installed in a dedicated docker volume, never on the host; `classif-down` removes it (down -v).
CLASSIF_NODE_IMAGE ?= node:24-bookworm-slim
CLASSIF_DEPS_VOLUME ?= radar-classif-deps-$(ENV)
export CLASSIF_NODE_IMAGE CLASSIF_DEPS_VOLUME

.PHONY: classif-deps classif-down
classif-deps: ## Classification pilot: install classifier deps in a docker volume (npm ci, workspaces api + packages)
	docker volume create $(CLASSIF_DEPS_VOLUME) >/dev/null
	docker run --rm -v $(CLASSIF_DEPS_VOLUME):/w -v "$(CURDIR)":/src:ro -w /w $(CLASSIF_NODE_IMAGE) sh -c '\
	  cp /src/package.json /src/package-lock.json /w/ && \
	  for d in api ui packages/artifacts-host packages/immo-mcp packages/radar-domain packages/radar-scoring packages/radar-sources; do mkdir -p /w/$$d && cp /src/$$d/package.json /w/$$d/; done && \
	  npm ci --ignore-scripts --no-audit --no-fund -w api -w packages/radar-domain -w packages/radar-sources'

classif-down: ## Classification pilot: remove the classifier deps volume (absent volume is success; a failed removal fails loudly)
	@if out=$$(docker volume inspect $(CLASSIF_DEPS_VOLUME) 2>&1); then docker volume rm $(CLASSIF_DEPS_VOLUME); elif echo "$$out" | grep -qi 'no such volume'; then echo "[classif-down] volume $(CLASSIF_DEPS_VOLUME) absent, nothing to remove"; else echo "$$out" >&2; exit 1; fi

.PHONY: classif-l1-profile
classif-l1-profile: ## Classification pilot L1: codebook export + Engram profile validate/dataprep/profile-prompt
	@test "$(ENV)" = "preprod" || { echo "[classif-l1-profile] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l1/profile.mjs

.PHONY: classif-l1-guide
classif-l1-guide: ## Classification pilot L1: guide G0 by one isolated Opus 5.5 max session (allowed pack only)
	@test "$(ENV)" = "preprod" || { echo "[classif-l1-guide] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l1/guide-g0.mjs

# L2 — convergence passes of the 3 max-effort annotators over the dev items (never the evaluation set).
# Plan v3: trio = muse-wonder-max, astra-max, opus-5.5-max (ANNOTATORS in l2/run.mjs); a deferred
# annotator keeps its last vote (DEFERRED=a,b). Modes: independent (pass 1) or crossreview (A2+,
# needs the golden pack). A manual pass can be restricted to one split half (HALF=tuning|blind).
PASS ?= 1
MODE ?= independent
GUIDE ?= G0
CONCURRENCY ?= 4
DEFERRED ?=
HALF ?=
.PHONY: classif-l2-pass classif-l2-converge classif-l2-scrape classif-l2-amend
classif-l2-pass: ## Classification pilot L2: one annotation pass (PASS=n MODE=independent|crossreview GUIDE=G0 CONCURRENCY=4 DEFERRED= HALF=)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-pass] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/run.mjs --pass $(PASS) --mode $(MODE) --guide $(GUIDE) --concurrency $(CONCURRENCY) $(if $(LOTS),--lots $(LOTS),) $(if $(DEFERRED),--deferred $(DEFERRED),) $(if $(HALF),--half $(HALF),)

classif-l2-converge: ## Classification pilot L2: majority, v3 stop rule, next-pass todo (PASS=n DEFERRED=)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/converge.mjs --pass $(PASS) $(if $(DEFERRED),--deferred $(DEFERRED),)

classif-l2-scrape: ## Classification pilot L2: traced complements for items flagged missing-information (scrape-manifest.jsonl)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-scrape] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/scrape.mjs

classif-l2-amend: ## Classification pilot L2: guide amendment from tuning-half disagreements (FROM=G0 TO=G1 PASS=n HALF=tuning DEFERRED=)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-amend] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/amend.mjs --from $(FROM) --to $(TO) --pass $(PASS) --half $(if $(HALF),$(HALF),tuning) $(if $(DEFERRED),--deferred $(DEFERRED),)

.PHONY: classif-l2-revalidate
classif-l2-revalidate: ## Classification pilot L2: re-run Engram validation on saved extractions of PASS=n (no seat call)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/revalidate.mjs --pass $(PASS) $(if $(ALL),--all,)

.PHONY: classif-l2-chain classif-l2-golden-pack classif-l2-golden-delete classif-l2-ambiguity-map
classif-l2-chain: ## Classification pilot L2: whole v3 phase-A protocol, resumable (WAIT_UNIT=<unit> CONCURRENCY=2 DEFERRED= STAGE=main|blind)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-chain] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/chain.mjs --concurrency $(if $(CONCURRENCY),$(CONCURRENCY),2) $(if $(WAIT_UNIT),--wait-unit $(WAIT_UNIT),) $(if $(DEFERRED),--deferred $(DEFERRED),) $(if $(STAGE),--stage $(STAGE),)

classif-l2-golden-pack: ## Classification pilot L2b: conductor-run, unseals reference-c + eval set in memory, writes the private 113-row golden pack (never committed)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-golden-pack] ENV=preprod required"; exit 2; }
	@test "$(CLASSIF_ROLE)" = "test-executor" || { echo "[classif-l2-golden-pack] CLASSIF_ROLE=test-executor required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/golden-pack.mjs

classif-l2-golden-delete: ## Classification pilot L2b: deletes the private golden pack at the end of phase A
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-golden-delete] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/golden-pack.mjs --delete

classif-l2-ambiguity-map: ## Classification pilot L2b: residual cause map + question draft (PASS=n)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-ambiguity-map] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/ambiguity.mjs --pass $(PASS)

.PHONY: classif-l2-fingerprint-audit classif-l2-dev-firewall-audit classif-l3-reference
classif-l2-fingerprint-audit: ## Classification pilot: which fingerprint list caused the complement refusals (no change to the lists)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/fingerprint-audit.mjs

classif-l2-dev-firewall-audit: ## Classification pilot: scan the frozen dev corpus with the current guard scanner (0 LLM, measurement only, OUT=...)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/dev-firewall-audit.mjs --out "$(OUT)"

OUT ?= $(CLASSIF_HOME)/recompute-972
classif-l2-exit-audit: ## Classification pilot L2: audit exit≠0 votes, recompute convergence + L3 rows without LLM (PASS=n OUT=...)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/exit-audit.mjs --pass $(PASS) --out "$(OUT)"

classif-l3-reference: ## Classification pilot L3: dev reference (model_consensus), partitions, manifest (0 LLM call, L3OUT=... redirects the private rows copy)
	@test "$(ENV)" = "preprod" || { echo "[classif-l3-reference] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l3/reference.mjs $(if $(L3OUT),--out "$(L3OUT)",)

# L3b — reference set D, 50/50 city-grouped split, blind seal (plan v3 D2/D3).
.PHONY: classif-l3b-split classif-l3b-reference
classif-l3b-split: ## Classification pilot L3b: 50/50 city-grouped seeded split (commit l3/manifests/split-seed.json first; refuses redraw)
	@test "$(ENV)" = "preprod" || { echo "[classif-l3b-split] ENV=preprod required"; exit 2; }
	@test -n "$(CLASSIF_SEED)" || { echo "[classif-l3b-split] CLASSIF_SEED=<seed> required (must equal the committed split-seed.json seed)"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l3/split.mjs --seed "$(CLASSIF_SEED)"

classif-l3b-reference: ## Classification pilot L3b: reference set D (provenances, core/unresolved) + blind-half seal (CLASSIF_ROLE=test-executor, after guide FINAL)
	@test "$(ENV)" = "preprod" || { echo "[classif-l3b-reference] ENV=preprod required"; exit 2; }
	@test "$(CLASSIF_ROLE)" = "test-executor" || { echo "[classif-l3b-reference] CLASSIF_ROLE=test-executor required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l3/reference-d.mjs

# L4 — P0 + prompt-tuning series with blind evaluation (plan v3 C/D, Annex M in l4/ANNEX-M.md).
# SERIES=k last; P0 is builder-authored (0 LLM); dev runs tuning only; blind is executor-only.
SERIES ?= 0
.PHONY: classif-l4-p0 classif-l4-dev classif-l4-optimise classif-l4-blind
classif-l4-p0: ## Classification pilot L4: author baseline P0 from guide FINAL (0 LLM call)
	@test "$(ENV)" = "preprod" || { echo "[classif-l4-p0] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l4/p0.mjs

classif-l4-dev: ## Classification pilot L4: tuning-half evaluation of every route (SERIES=k DEFERRED= CONCURRENCY=2)
	@test "$(ENV)" = "preprod" || { echo "[classif-l4-dev] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l4/dev.mjs --series $(SERIES) $(if $(DEFERRED),--deferred $(DEFERRED),) --concurrency $(if $(CONCURRENCY),$(CONCURRENCY),2)

# Seat override (recorded method deviation in the optimise manifest): OPTIMISERS=a,b RECONCILER=x
# among the max seats of run-seat.mjs; DEVIATION="<reason>" unless it is the recorded owner 06/11 choice.
classif-l4-optimise: ## Classification pilot L4: 2 max optimisers + reconciliation to one common P(k+1) (SERIES=k DEFERRED= OPTIMISERS= RECONCILER= DEVIATION=)
	@test "$(ENV)" = "preprod" || { echo "[classif-l4-optimise] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l4/optimise.mjs --series $(SERIES) $(if $(DEFERRED),--deferred $(DEFERRED),) $(if $(OPTIMISERS),--optimisers $(OPTIMISERS),) $(if $(RECONCILER),--reconciler $(RECONCILER),) $(if $(DEVIATION),--deviation '$(DEVIATION)',)

classif-l4-blind: ## Classification pilot L4: executor-only blind-half scoring + S113 secondary (SERIES=k CLASSIF_ROLE=test-executor RERUN_INFRA_FAILED=route,route)
	@test "$(ENV)" = "preprod" || { echo "[classif-l4-blind] ENV=preprod required"; exit 2; }
	@test "$(CLASSIF_ROLE)" = "test-executor" || { echo "[classif-l4-blind] CLASSIF_ROLE=test-executor required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l4/blind.mjs --series $(SERIES) $(if $(DEFERRED),--deferred $(DEFERRED),) --concurrency $(if $(CONCURRENCY),$(CONCURRENCY),2) $(if $(RERUN_INFRA_FAILED),--rerun-infra-failed $(RERUN_INFRA_FAILED),)

# L4 GEPA — population of prompts (P0..P4), reflective mutation by astra-max (fallback and
# repair opus-5.5-max), per-case Pareto selection on the tuning half only, 5 evaluation routes
# (opus-5.5-low, glm-5.3-low, sol-6.1-low, luna-6-low, mistral-large-4-low). MAX_CALLS caps the
# run (lib/budget.mjs runBudget, on top of the pilot cap); resume = same SERIES/RUN/SEED.
# GEPA_CONCURRENCY = calls in flight per route (2 per seat, branch guardrail).
MAX_CALLS ?= 5000
GEPA_CONCURRENCY ?= 2
.PHONY: classif-l4-gepa
classif-l4-gepa: ## Classification pilot L4: GEPA prompt optimisation, tuning half only (SERIES=k MAX_CALLS=5000 SEED= RUN= MAX_ITER= FINAL_TOP=3 GEPA_CONCURRENCY=2)
	@test "$(ENV)" = "preprod" || { echo "[classif-l4-gepa] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l4/gepa.mjs --series $(SERIES) --max-calls $(MAX_CALLS) --concurrency $(GEPA_CONCURRENCY) $(if $(SEED),--seed '$(SEED)',) $(if $(RUN),--run $(RUN),) $(if $(MAX_ITER),--max-iterations $(MAX_ITER),) $(if $(FINAL_TOP),--final-top $(FINAL_TOP),)
