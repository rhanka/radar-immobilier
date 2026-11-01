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
PASS ?= 1
MODE ?= independent
GUIDE ?= G0
CONCURRENCY ?= 4
.PHONY: classif-l2-pass classif-l2-converge classif-l2-scrape classif-l2-amend
classif-l2-pass: ## Classification pilot L2: one annotation pass (PASS=n MODE=independent|reconcile GUIDE=G0 CONCURRENCY=4)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-pass] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/run.mjs --pass $(PASS) --mode $(MODE) --guide $(GUIDE) --concurrency $(CONCURRENCY) $(if $(LOTS),--lots $(LOTS),)

classif-l2-converge: ## Classification pilot L2: majority, α, unanimity, stop rule, next-pass todo (PASS=n)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/converge.mjs --pass $(PASS)

classif-l2-scrape: ## Classification pilot L2: traced complements for items flagged missing-information (scrape-manifest.jsonl)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-scrape] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/scrape.mjs

classif-l2-amend: ## Classification pilot L2: guide amendment by majority of the 3 annotators (FROM=G0 TO=G1 PASS=n)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-amend] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/amend.mjs --from $(FROM) --to $(TO) --pass $(PASS)

.PHONY: classif-l2-revalidate
classif-l2-revalidate: ## Classification pilot L2: re-run Engram validation on saved extractions of PASS=n (no seat call)
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/revalidate.mjs --pass $(PASS) $(if $(ALL),--all,)

.PHONY: classif-l2-chain
classif-l2-chain: ## Classification pilot L2: whole protocol, resumable (WAIT_UNIT=<systemd unit> CONCURRENCY=2)
	@test "$(ENV)" = "preprod" || { echo "[classif-l2-chain] ENV=preprod required"; exit 2; }
	@$(CLASSIF_NODE) $(CLASSIF_DIR)/l2/chain.mjs --concurrency $(CONCURRENCY) $(if $(WAIT_UNIT),--wait-unit $(WAIT_UNIT),)

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
