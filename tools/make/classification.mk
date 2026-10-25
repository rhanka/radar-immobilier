ENV ?= test-api-paniers
API_PORT ?= 18927
UI_PORT ?= 15927
MAILDEV_UI_PORT ?= 11927
export ENV API_PORT UI_PORT MAILDEV_UI_PORT FILES MSG SCOPE
.PHONY: FORCE
FORCE:
classification-%: FORCE
	rtk bash tools/make/classification-deliver.sh $*
