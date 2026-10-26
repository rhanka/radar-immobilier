ENV ?= test-api-paniers
API_PORT ?= 18927
UI_PORT ?= 15927
MAILDEV_UI_PORT ?= 11927
export ENV API_PORT UI_PORT MAILDEV_UI_PORT FILES MSG SCOPE
.PHONY: FORCE
FORCE:
classification-targeted classification-qualify classification-types classification-test classification-typecheck classification-lint classification-ci: FORCE
	rtk bash tools/make/classification-verify.sh $(subst lint,types,$(subst typecheck,types,$(subst test,targeted,$(subst ci,qualify,$(patsubst classification-%,%,$@)))))
classification-%: FORCE
	rtk bash tools/make/classification-deliver.sh $*
