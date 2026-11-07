# Git-backed artifacts, immo-side prerequisites (G0 v3 §4.1, §5 P7, CG6).
# Usage (ENV last, test-* only):
#   make -f tools/make/git-artifact.mk proof [REF=<git ref>] ENV=test-git-artifact
#   make -f tools/make/git-artifact.mk test ENV=test-git-artifact
#   make -f tools/make/git-artifact.mk gb1-rows ENV=test-git-artifact
#   make -f tools/make/git-artifact.mk down ENV=test-git-artifact
GIT_ARTIFACT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
REF ?= HEAD
GB1_ROWS := packages/artifacts-host/src/git-mode/gb1-install-script-rows.json
.PHONY: proof test down gb1-rows
# GB1 DISABLED install-script qualification rows, generated from package-lock.json (never by hand).
gb1-rows:
	@case "$(ENV)" in test-*) ;; *) echo 'ENV must be test-*'; exit 2;; esac
	@cd "$(GIT_ARTIFACT_ROOT)" && COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null -p "radar-$(ENV)" -f tools/make/git-artifact.compose.yml run --rm --no-deps -T node node tools/make/git-artifact-gb1-rows.mjs > "$(GB1_ROWS)"
	@$(MAKE) --no-print-directory -f "$(GIT_ARTIFACT_ROOT)/tools/make/git-artifact.mk" down ENV="$(ENV)"
proof:
	@cd "$(GIT_ARTIFACT_ROOT)" && ENV="$(ENV)" bash tools/make/git-artifact-verify.sh proof "$(REF)"
test:
	@cd "$(GIT_ARTIFACT_ROOT)" && ENV="$(ENV)" bash tools/make/git-artifact-verify.sh test
down:
	@case "$(ENV)" in test-*) ;; *) echo 'ENV must be test-*'; exit 2;; esac
	@cd "$(GIT_ARTIFACT_ROOT)" && COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null -p "radar-$(ENV)" -f tools/make/git-artifact.compose.yml down -v --remove-orphans
