# Standalone container gate. Never loads environment files.
ENV ?= test-migration-journal
.PHONY: check test
check:
	docker run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -w /workspace node:22-bookworm-slim node deploy/ci/check-migration-journal.mjs
test:
	docker run --rm --user "$$(id -u):$$(id -g)" -v "$(CURDIR):/workspace:ro" -w /workspace node:22-bookworm-slim node --test deploy/ci/check-migration-journal.test.mjs
