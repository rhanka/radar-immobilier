# No root Makefile include: never load .env or cluster credentials.
SHELL := /bin/bash
ENV ?= test-ui-sw
override COMPOSE_DISABLE_ENV_FILE := 1
export COMPOSE_DISABLE_ENV_FILE
override COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.yml -f docker-compose.test.yml -f tools/ui-continuity.compose.yml
RUN := $(COMPOSE) run --rm --no-deps -T --entrypoint '' api
.PHONY: guard test-ui typecheck lint test-api test-immo-mcp test-e2e down commit merge push inspect
guard:
	@case "$(ENV)" in test-*) ;; *) echo 'Require ENV=test-*'; exit 2;; esac
test-ui: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN) sh -ec 'npm ci --no-audit --no-fund && npm run test --workspace=ui -- $(SCOPE)'
typecheck: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN) sh -ec 'npm ci --no-audit --no-fund && npm run typecheck --workspaces --if-present'
lint: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN) sh -ec 'npm ci --no-audit --no-fund && npx --no-install eslint . && bash deploy/k8s/nginx/check-header-parity.sh'
test-api: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; if ! $(COMPOSE) up -d --wait postgres minio; then $(COMPOSE) logs --tail=80 postgres; exit 1; fi; $(RUN) sh -ec 'npm ci --no-audit --no-fund && npm run db:migrate --workspace=api && npm run test --workspace=api -- $(SCOPE)'
test-immo-mcp: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN) sh -ec 'npm ci --no-audit --no-fund && npm run test --workspace=packages/immo-mcp -- --exclude "**/*.e2e.test.ts" $(SCOPE)'
test-e2e: guard
	@ENV=$(ENV) bash tools/make/e2e-real.sh
test-worker: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; $(RUN) sh -ec 'npm ci --no-audit --no-fund && ./node_modules/.bin/playwright install --with-deps --only-shell chromium && cd ui && ../node_modules/.bin/playwright test --config playwright.real.config.ts e2e-real/ui-sync-sw.spec.ts --grep "preserve two tabs"'
down: guard
	$(COMPOSE) down -v --remove-orphans
commit: guard
	@test -n "$$MSG"
	git commit -m "$$MSG"
merge: guard
	git merge --no-ff --no-commit fix/preprod-nginx-worker-csp
push: guard
	git push -u origin feat/ui-sw-store-sync
inspect: guard
	docker ps -a --filter label=com.docker.compose.project=radar-$(ENV) --format '{{.Names}} {{.Image}} {{.Status}}'
inspect-all: guard
	docker ps --format '{{.Names}} {{.Status}}'
