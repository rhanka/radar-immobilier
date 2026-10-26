export ENV API_PORT UI_PORT MAILDEV_UI_PORT
.PHONY: pwd-verify pwd-commit-slices pwd-deliver commit
pwd-verify:
	@bash tools/make/base-api-pwd-verify.sh
pwd-commit-slices:
	@bash tools/make/base-api-pwd-commit.sh
pwd-deliver:
	@bash tools/make/base-api-pwd-deliver.sh
commit:
	@git -c core.hooksPath=/dev/null commit -m "$(MSG)"
