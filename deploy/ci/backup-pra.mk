SHELL := /bin/bash
ENV ?= test-backup-pra
BACKUP_IMAGE ?= $(shell cat tmp/backup-pra-image.txt 2>/dev/null || echo radar-backup:test)
.PHONY: backup-build backup-test backup-render backup-proof backup-activate backup-publish backup-provision backup-provision-test
backup-build:
	docker build --force-rm -f deploy/k8s/db-backup/Dockerfile -t $(BACKUP_IMAGE) .
backup-test: backup-build
	@test "$(ENV)" = test-backup-pra
	@$(MAKE) --no-print-directory -f deploy/ci/backup-pra.mk backup-render BACKUP_IMAGE="$(BACKUP_IMAGE)" ENV=both
	@bash -n deploy/ci/backup-pra.sh
	@bash -n deploy/ci/backup-provision.sh
	docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 512m --tmpfs /work:uid=999,gid=999 --tmpfs /scratch:uid=999,gid=999 -v "$(CURDIR):/repo:ro" --entrypoint python3 $(BACKUP_IMAGE) /repo/deploy/ci/backup-pra.test.py
	@$(MAKE) --no-print-directory -f deploy/ci/backup-pra.mk backup-provision-test BACKUP_IMAGE="$(BACKUP_IMAGE)" ENV=test-backup-pra
	docker run --rm --network none -v "$(CURDIR):/repo:ro" --entrypoint bash $(BACKUP_IMAGE) /repo/deploy/ci/db-backup.test.sh
backup-render:
	@bash deploy/ci/backup-pra.sh render "$(ENV)" "$(BACKUP_IMAGE)"
backup-proof:
	@bash deploy/ci/backup-pra.sh proof "$(ENV)" "$(BACKUP_IMAGE)"
backup-activate:
	@bash deploy/ci/backup-pra.sh activate "$(ENV)" "$(BACKUP_IMAGE)"
export PRA_PROVISION_GO BACKUP_ENV PRA_PRODUCTION_GO
backup-provision:
	@bash deploy/ci/backup-provision.sh "$(BACKUP_IMAGE)"
backup-provision-test:
	@test "$(ENV)" = test-backup-pra
	docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --tmpfs /tmp:exec,mode=1777 -v "$(CURDIR):/repo:ro" --entrypoint python3 $(BACKUP_IMAGE) /repo/deploy/ci/backup-provision.test.py
backup-publish: backup-build
	@test "$(PRA_PUBLISH_GO)" = 1
	docker push $(BACKUP_IMAGE)
	@mkdir -p tmp
	@docker image inspect --format='{{index .RepoDigests 0}}' $(BACKUP_IMAGE) > tmp/backup-pra-image.txt
