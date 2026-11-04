# Standalone runner: never include the root Makefile or read environment files.
include tools/immo-mcp-test.mk
override COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.test.yml -f tools/mcp-p0b.services.yml
override CI_COMPOSE := docker compose --env-file /dev/null -p radar-$(ENV) -f docker-compose.yml -f docker-compose.test.yml -f tools/mcp-p0b.ci.services.yml
RUN_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' api
RUN_DATABASE_API := $(COMPOSE) run --rm --no-deps -T --entrypoint '' -e P0B_DATABASE_URL=postgres://p0b:p0b-test-only@postgres:5432/p0b
.DEFAULT_GOAL := verify
INSTALL := npm ci --cache /tmp/immo-p0c-npm
SOURCE ?= /home/antoinefa/src/sentropic/tmp/worktrees/artifacts-parity-p0b/packages/artifacts
P0B_VERSION ?= 0.2.13

.PHONY: prepare lock registry verify candidate integration database-check test-api down-api
prepare: guard
	@mkdir -p tmp/mcp-p0b
database-check: guard
	@trap '$(COMPOSE) logs --no-color postgres; $(COMPOSE) down -v --remove-orphans' EXIT; $(COMPOSE) up -d --wait postgres
database-logs: guard-env
	@$(COMPOSE) ps -a
	@$(COMPOSE) logs --no-color postgres
	@df -h .
lock: guard
	@$(CHECK) 'npm install --cache /tmp/immo-p0c-npm --package-lock-only --ignore-scripts'
registry: guard
	@$(CHECK) 'npm --cache /tmp/immo-p0c-npm view @sentropic/artifacts@$(P0B_VERSION) version'
integrity: guard
	@$(CHECK) 'actual=$$(npm --cache /tmp/immo-p0c-npm view @sentropic/artifacts@0.2.13 dist.integrity); test "$$actual" = "sha512-E8bVdKCAq3q+CMgsb4Jn382I2Jr2aw0o5IcdH00urfEqIM8facJXAudNjTkJq/Hm2m6DnLADo6W2GeeudBljVQ==" && printf "%s\n" "$$actual"'
upstream: guard
	@$(CHECK) 'mkdir -p tmp/mcp-p0c/upstream && npm --cache /tmp/immo-p0c-npm pack @sentropic/artifacts@0.2.13 --pack-destination /tmp && tar -xzf /tmp/sentropic-artifacts-0.2.13.tgz -C tmp/mcp-p0c/upstream'
verify: guard
ifeq ($(CANDIDATE),1)
	@$(MAKE) --no-print-directory -f tools/mcp-p0b.mk candidate P0B_VERSION='$(P0B_VERSION)' SOURCE='$(SOURCE)' ENV=$(ENV)
else
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) api sh tools/mcp-p0c-verify.sh
endif
# A copy is built inside the container; the upstream checkout is mounted read-only.
candidate: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) -e P0B_VERSION='$(P0B_VERSION)' -v '$(SOURCE):/candidate:ro' api sh tools/mcp-p0b-candidate.sh
integration: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) api sh -ec '$(INSTALL) && npm run test --workspace=packages/artifacts-host -- src/p0b.integration.test.ts src/p0b-uploads.integration.test.ts src/p0c.integration.test.ts src/p0c-lifecycle.integration.test.ts src/publish-s3-deadline.integration.test.ts --maxWorkers=1'
strict: guard
	@trap '$(COMPOSE) down -v --remove-orphans' EXIT; \
	$(COMPOSE) up -d --wait postgres && \
	$(RUN_DATABASE_API) api sh -ec '$(INSTALL) && ARTIFACTS_PROFILE_REVISION=immo-artifacts.cas.v2 npm run test --workspace=packages/immo-mcp -- src/registry/p0c-transport.test.ts src/registry/p0c-http.test.ts --maxWorkers=1 && ARTIFACTS_PROFILE_REVISION=immo-artifacts.v2 ARTIFACTS_INPUTS_QUALIFIED=true ARTIFACTS_RESULTS_QUALIFIED=true npm run test --workspace=packages/immo-mcp -- src/registry/p0c-transport.test.ts src/registry/p0c-http.test.ts --maxWorkers=1'

# Same API gate as the root test-api / CI test target, without including .env.
test-api: guard
	@trap 'status=$$?; if [ "$$status" -ne 0 ]; then $(CI_COMPOSE) logs --no-color --tail=100 postgres minio; fi; $(CI_COMPOSE) down -v --remove-orphans; exit "$$status"' EXIT; \
	$(CI_COMPOSE) up -d --wait postgres minio && \
	$(CI_COMPOSE) run --rm -T api sh -ec '$(INSTALL) && npm run db:migrate --workspace=api && npm run test --workspace=api $(if $(SCOPE),-- $(SCOPE),)'

down-api: guard-env
	$(CI_COMPOSE) down -v --remove-orphans

.PHONY: push clean-deps
push: guard
	git push -u origin HEAD
clean-deps: guard-env
	@$(CHECK) 'rm -rf packages/*/node_modules ui/node_modules tmp/mcp-p0b/artifacts tmp/mcp-p0b/toolchain tmp/mcp-p0b/graph'
	@rmdir node_modules api/node_modules 2>/dev/null || true
