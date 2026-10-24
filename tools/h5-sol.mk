# Standalone A6 Git operations and environment-file-safe commit preflight.
SHELL := /bin/bash
ENV ?= test-artefacts-mcp-a6
override A6_BASE := 1d4adc1014ec24e02f7e1966edadae56291a9cb1
A6_EVIDENCE := $(CURDIR)/tmp/artefacts-mcp-a6

.PHONY: guard-env guard git-audit bundle
guard-env:
	@case "$(ENV)" in test-artefacts-mcp-a6|e2e-artefacts-mcp-a6) ;; *) exit 2;; esac

# Used after tools/immo-mcp-test.mk to replace its .env.example comparisons.
guard: guard-env
	@set -eu; found=$$(find . -name '.env*' ! -name '.env.example' -print -quit); \
	test -z "$$found" || { echo 'Refused: environment file present'; exit 2; }; \
	git diff --cached --name-only -z | while IFS= read -r -d '' file; do \
	case "$$file" in .env*|*/.env*) echo 'Refused: staged environment file'; exit 2;; esac; done
	@git diff --cached --check
	@git diff --cached --numstat | awk '{n += $$1 + $$2; files++} END {exit !(n > 0 && n <= 150 && files <= 15)}'
	@[[ "$$MSG" =~ ^(feat|fix|test|docs|chore|refacto|ci)(\([a-z0-9-]+\))?:\ [^[:cntrl:]]+$$ ]] && test "$${#MSG}" -le 72

git-audit: guard-env
	@set -eu; test "$$(git branch --show-current)" = feat/artefacts-mcp-a6; \
	git merge-base --is-ancestor $(A6_BASE) HEAD; \
	for sha in $$(git rev-list --reverse $(A6_BASE)..HEAD); do \
	  message=$$(git show -s --format=%B "$$sha"); \
	  [[ "$$message" != *$$'\n'* ]] && test "$${#message}" -le 72; \
	  printf '%s\n' "$$message" | grep -Eq '^(feat|fix|test|docs|chore|refacto|ci)(\([a-z0-9-]+\))?: .+$$'; \
	  stats=$$(git show --format= --numstat "$$sha" | awk '{a+=$$1; d+=$$2; f++; if ($$1=="-" || $$2=="-") bad=1} END {if (bad || a+d>150 || f>15) exit 2; print a,d,f}'); \
	  if git ls-tree -r --name-only "$$sha" -- api/tests/e2e | grep -Eq '/artifacts-reader.*\.spec\.ts$$'; then \
	    git show "$$sha:api/vitest.config.ts" | grep -Fq 'exclude: [...configDefaults.exclude, "tests/e2e/artifacts-reader*.spec.ts"]'; \
	  fi; \
	  printf '%s %s %s\n' "$$sha" "$$stats" "$$message"; \
	done

bundle: guard-env git-audit
	@set -eu; df -h .; test "$$(df -Pk . | awk 'NR==2 {print $$4}')" -ge 10485760; \
	mkdir -p "$(A6_EVIDENCE)"; target_head=$$(git rev-parse HEAD); \
	target_tree=$$(git rev-parse HEAD^{tree}); bundle_path="$(A6_EVIDENCE)/artefacts-mcp-a6.bundle"; \
	test ! -e "$$bundle_path"; \
	git bundle create "$$bundle_path" $(A6_BASE)..HEAD; \
	git bundle verify "$$bundle_path"; \
	reconstructed=$$(mktemp -d "$(A6_EVIDENCE)/reconstructed.XXXXXX"); \
	trap 'rm -rf "$$reconstructed"' EXIT; \
	git init --bare "$$reconstructed" >/dev/null; \
	git -C "$$reconstructed" fetch --depth=1 --no-tags "$(CURDIR)" $(A6_BASE); \
	git -C "$$reconstructed" fetch "$$bundle_path" HEAD:refs/heads/verified; \
	test "$$(git -C "$$reconstructed" rev-parse verified)" = "$$target_head"; \
	test "$$(git -C "$$reconstructed" rev-parse verified^{tree})" = "$$target_tree"; \
	printf 'Reconstructed HEAD=%s tree=%s\n' "$$target_head" "$$target_tree"; \
	sha256sum "$$bundle_path"
