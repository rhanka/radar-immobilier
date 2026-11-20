# Entrée autonome : aucun include, aucune lecture de .env.
SHELL := /bin/bash
IMAGE := node:24-bookworm-slim
PRIVATE := /home/antoinefa/.local/share/radar-classif/1passe-bc
.PHONY: prepare check freeze
prepare:
	docker run --rm --network none --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/repo" -v "$(PRIVATE):/private" -w /repo $(IMAGE) node tools/classif/1passe/prepare.mjs
check:
	docker run --rm --network none --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/repo:ro" -w /repo $(IMAGE) node --check tools/classif/1passe/prepare.mjs
	docker run --rm --network none --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/repo:ro" -w /repo $(IMAGE) node --check tools/classif/1passe/check.mjs
	docker run --rm --network none --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/repo:ro" -v "$(PRIVATE):/private:ro" -v "$(PRIVATE)/../l1/pack:/pack:ro" -w /repo $(IMAGE) node tools/classif/1passe/check.mjs
freeze:
	docker run --rm --network none --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/repo" -v "$(PRIVATE):/private:ro" -v "$(PRIVATE)/../l1/pack:/pack:ro" -w /repo $(IMAGE) node tools/classif/1passe/check.mjs --freeze
