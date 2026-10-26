# Standalone runner: never includes environment-loading Makefiles.
SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT
override CMD := $(value CMD)
export CMD
.PHONY: run inspect commit manifests
run:
	@bash tools/make/artefacts-delivery-run.sh
inspect:
	@rtk bash -euo pipefail -c 'eval "$$CMD"'
commit:
	@git commit -m "$(MSG)"
manifests:
	@mkdir -p tmp/delivery-evidence/manifests
	@kubectl kustomize deploy/k8s > tmp/delivery-evidence/manifests/base.yaml
	@kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/overlays/preprod > tmp/delivery-evidence/manifests/preprod.yaml
	@kubectl apply --dry-run=client --validate=false -f tmp/delivery-evidence/manifests/preprod.yaml > tmp/delivery-evidence/manifests/dry-run.log
	@bash deploy/ci/check-preprod-auth-isolation.sh tmp/delivery-evidence/manifests/preprod.yaml
	@bash deploy/ci/check-h3-preprod-render.sh
