# Task-local commands. Always invoke with -f Makefile -f this file.
export E2E_SPEC
.PHONY: geo-bootstrap geo-probe geo-config-test
geo-bootstrap: chown-dev-node-modules
	$(COMPOSE_RUN_API_NODEPS) npm ci --no-audit --no-fund
geo-probe:
	curl --fail --silent --show-error --max-time 30 -o /tmp/geo-quickwins-probe.json -w 'geo preprod HTTP %{http_code}\n' 'https://api.preprod.geo.sent-tech.ca/collections/qc-lots-rawdon/items?limit=1&coordPrecision=6'
	curl --fail --silent --show-error --max-time 30 -o /tmp/geo-quickwins-exact.json -w 'geo exact item HTTP %{http_code}\n' 'https://api.preprod.geo.sent-tech.ca/collections/qc-lots-rawdon/items/ca%2Fqc%2Flot%2F5-530-108'
geo-config-test:
	$(COMPOSE_RUN_API_NODEPS) npm run test --workspace=ui -- src/lib/maps/geo-proxy-config.test.ts

.PHONY: geo-mirror-probe
geo-mirror-probe:
	@set -eu; for city in rawdon saint-eustache; do \
	  curl --fail --compressed --silent --show-error --max-time 30 -D /tmp/geo-m1-$$city.headers -o /tmp/geo-m1-$$city.json -w "$$city display HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n" "https://api.preprod.geo.sent-tech.ca/collections/qc-lots-$$city/items?profile=display"; \
	  etag=$$(awk 'tolower($$1) == "etag:" { sub(/\r$$/, ""); print $$2 }' /tmp/geo-m1-$$city.headers); \
	  if [ -n "$$etag" ]; then curl --silent --show-error --max-time 30 -H "If-None-Match: $$etag" --compressed -o /dev/null -w "$$city revalidation HTTP %{http_code}, %{size_download} bytes, %{time_total}s\n" "https://api.preprod.geo.sent-tech.ca/collections/qc-lots-$$city/items?profile=display"; fi; \
	done
