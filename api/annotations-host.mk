# Use: make -f Makefile -f api/annotations-host.mk <target> ENV=test-annotations-host
ANNOTATIONS_ARCHIVE := vendor/comments-m1/sentropic-comments-0.3.0.tgz
ANNOTATIONS_SOURCE := vendor/comments-m1/source.tar

.PHONY: annotations-contract-check annotations-contract-rebuild annotations-test annotations-retire-empty
annotations-contract-check:
	@echo 'dd7656275b56ac8903103e44295b6f2c5b2173890d7e49a530ab2c3f5766eb98  $(ANNOTATIONS_SOURCE)' | sha256sum -c -
	@echo '16fb88cee3869b810a7b3215e0807fbc2445e458501cc6153510af8cedff3f0c  $(ANNOTATIONS_ARCHIVE)' | sha256sum -c -
	@tar -xOf $(ANNOTATIONS_SOURCE) packages/comments/tests/fixtures/revision-hash-v1.json | cmp - vendor/comments-m1/revision-hash-v1.json

annotations-contract-rebuild: annotations-contract-check
	docker run --rm --tmpfs /build:exec -v "$(CURDIR)/vendor/comments-m1:/input:ro" -w /build node:24-bookworm-slim sh -ec 'tar -xf /input/source.tar; cd packages/comments; cp /input/build-lock.json package-lock.json; npm ci --ignore-scripts --no-audit --no-fund >/dev/null; npm run build; npm pack --silent; echo "16fb88cee3869b810a7b3215e0807fbc2445e458501cc6153510af8cedff3f0c  sentropic-comments-0.3.0.tgz" | sha256sum -c -'

annotations-test: annotations-contract-check
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) up -d postgres minio
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) run --rm -T api sh -ec 'npm ci --ignore-scripts --no-audit --no-fund; npm run db:migrate --workspace=api; npm run test --workspace=api -- src/services/annotations src/routes/annotations.test.ts tests/integration/annotations-host.spec.ts tests/integration/prospect-marks.spec.ts'

annotations-retire-empty:
	@case "$(ENV)" in test-*|e2e-*) ;; *) echo 'Use an isolated test environment for this qualification target'; exit 1;; esac
	@test -n "$(CLOSED_WINDOW_REF)" || { echo 'Pass CLOSED_WINDOW_REF=<authorized-cutover-reference>'; exit 1; }
	$(DOCKER_COMPOSE) $(COMPOSE_FILES_TEST) run --rm -T api npm run annotations:retire-empty --workspace=api -- --closed-window-ref="$(CLOSED_WINDOW_REF)"
