# Git-backed artifacts, immo-side prerequisites (G0 v3 §4.1, §5 P7, CG6).
# Usage (ENV last, test-* only):
#   make -f tools/make/git-artifact.mk proof [REF=<git ref>] ENV=test-git-artifact
#   make -f tools/make/git-artifact.mk test ENV=test-git-artifact
#   make -f tools/make/git-artifact.mk down ENV=test-git-artifact
GIT_ARTIFACT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
REF ?= HEAD
.PHONY: proof test down
proof:
	@cd "$(GIT_ARTIFACT_ROOT)" && ENV="$(ENV)" bash tools/make/git-artifact-verify.sh proof "$(REF)"
test:
	@cd "$(GIT_ARTIFACT_ROOT)" && ENV="$(ENV)" bash tools/make/git-artifact-verify.sh test
down:
	@case "$(ENV)" in test-*) ;; *) echo 'ENV must be test-*'; exit 2;; esac
	@cd "$(GIT_ARTIFACT_ROOT)" && COMPOSE_DISABLE_ENV_FILE=1 docker compose --env-file /dev/null -p "radar-$(ENV)" -f tools/make/git-artifact.compose.yml down -v --remove-orphans
