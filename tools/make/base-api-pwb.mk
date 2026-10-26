SHELL := /bin/bash
export ENV API_PORT UI_PORT MAILDEV_UI_PORT SCOPE
.PHONY: pwb-qualify pwb-deliver
pwb-qualify:
	rtk bash tools/make/base-api-pwb-verify.sh
pwb-deliver:
	rtk bash tools/make/base-api-pwb-deliver.sh
