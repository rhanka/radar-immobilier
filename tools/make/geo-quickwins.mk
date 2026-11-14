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
