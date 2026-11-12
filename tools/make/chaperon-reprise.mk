SHELL := /bin/bash
# Chaperon triage reprise gate (synthetic data only): plan builder unit tests
# (node --test) and the insert-only apply integration spec against the migrated
# schema. Standalone runner; the stack is always removed (down -v).
#   make -f tools/make/chaperon-reprise.mk test ENV=test-chaperon-reprise
ENV ?= test-chaperon-reprise
export COMPOSE_PROJECT_NAME := radar-$(ENV)
export UID ?= $(shell id -u)
export GID ?= $(shell id -g)
COMPOSE := docker compose -f docker-compose.yml -f docker-compose.test.yml
RUN_TESTS := npm ci --ignore-scripts && npm run db:migrate --workspace=api \
  && node --test scripts/chaperon-reprise.test.mjs \
  && npm run test --workspace=api -- tests/integration/chaperon-reprise-apply.spec.ts --maxWorkers=1

.PHONY: test
test:
	@[[ "$(ENV)" == test-* ]] || { echo "ENV must be test-*"; exit 2; }
	@mkdir -p node_modules api/node_modules
	$(COMPOSE) build api
	$(COMPOSE) run --rm --no-deps -T -u 0:0 --entrypoint sh api -c '[ "$$(stat -c %u /workspace/node_modules)" = "$(UID)" ] || chown -R $(UID):$(GID) /workspace/node_modules /workspace/api/node_modules'
	status=0; $(COMPOSE) up -d --wait postgres \
	  && $(COMPOSE) run --rm -T -e LOT_MIGRATION_DB_TEST=1 api sh -c "$(RUN_TESTS)" || status=$$?; \
	  $(COMPOSE) down -v --remove-orphans; exit $$status
