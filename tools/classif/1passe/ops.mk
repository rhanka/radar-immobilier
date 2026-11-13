# Entrée autonome. Aucun include et aucune lecture de .env.
SHELL := /bin/bash
.PHONY: commit quota annotate finalize inspect syntax
syntax:
	@for f in tools/classif/1passe/*.mjs; do node --check "$$f" || exit; done
commit:
	git -c core.hooksPath=/dev/null commit -m "$(MSG)"
quota:
	node tools/classif/1passe/quota.mjs
annotate:
	node tools/classif/1passe/annotate.mjs
finalize:
	node tools/classif/1passe/finalize.mjs
inspect:
	node tools/classif/1passe/inspect.mjs
