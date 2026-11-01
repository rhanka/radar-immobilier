SHELL := /bin/bash

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../../..)
OVERLAY := $(ROOT)/deploy/k8s/refresh-cronjobs
PROD_OVERLAY := $(ROOT)/deploy/k8s/refresh-cronjobs-prod
NAMESPACE := radar-immobilier-preprod
EXPECTED_SERVER := https://hlhedx.c1.bhs5.k8s.ovh.net
K := kubectl --kubeconfig "$(KUBECONFIG)" -n $(NAMESPACE)
PLACEHOLDER := ghcr.io/rhanka/radar-api:PINNED-BY-CI-AT-RELEASE-DO-NOT-APPLY-UNEDITED
API_IMAGE := ghcr.io/rhanka/radar-api
CONTRACT_AWK := $(OVERLAY)/refresh-contract.awk
WINDOW_AWK := $(OVERLAY)/refresh-window.awk
WATCHDOG_AWK := $(OVERLAY)/refresh-watchdog.awk
STAGGER_AWK := $(OVERLAY)/refresh-stagger.awk
BASCULE_CRONS_AWK := $(OVERLAY)/bascule-crons.awk
BASCULE_WINDOW_AWK := $(OVERLAY)/bascule-window.awk
BACKUP_DAILY_MANIFEST := $(ROOT)/deploy/ci/backup/cronjob-backup-daily.yaml
REFRESH_STAGGER_MIN_MINUTES := 15

.PHONY: guard-preprod
guard-preprod:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@test -n "$(KUBECONFIG)" -a -f "$(KUBECONFIG)" || { echo "KUBECONFIG file is required" >&2; exit 1; }
	@server="$$(kubectl --kubeconfig "$(KUBECONFIG)" config view --minify -o jsonpath='{.clusters[0].cluster.server}')"; \
	  case "$$server" in "$(EXPECTED_SERVER)"|"$(EXPECTED_SERVER)":*) ;; *) echo "refusing unexpected API server" >&2; exit 1;; esac
	@$(K) get serviceaccount radar-app -o name >/dev/null

.PHONY: inspect-preprod
inspect-preprod: guard-preprod
	@kubectl --kubeconfig "$(KUBECONFIG)" auth whoami -o jsonpath='{.status.userInfo.username}{"\n"}'
	@for check in 'get cronjobs.batch' 'create cronjobs.batch' 'create jobs.batch' 'get secrets' 'create secrets' 'get persistentvolumeclaims' 'create persistentvolumeclaims'; do \
	  set -- $$check; printf '%-34s %s\n' "$$1 $$2" "$$($(K) auth can-i "$$1" "$$2")"; \
	done
	@$(K) get cronjob radar-refresh-pv --ignore-not-found \
	  -o custom-columns=NAME:.metadata.name,SUSPEND:.spec.suspend,SCHEDULE:.spec.schedule,IMAGE:.spec.jobTemplate.spec.template.spec.containers[0].image
	@if [ "$$($(K) auth can-i get secrets)" = yes ]; then \
	  $(K) get secret radar-refresh-keyring-bootstrap radar-refresh-runtime --ignore-not-found -o name; \
	else echo 'secret inventory: unavailable to this identity'; fi
	@if [ "$$($(K) auth can-i get persistentvolumeclaims)" = yes ]; then \
	  $(K) get pvc radar-refresh-keyring --ignore-not-found \
	    -o custom-columns=NAME:.metadata.name,STATUS:.status.phase,CLASS:.spec.storageClassName,ACCESS:.spec.accessModes[*]; \
	else echo 'PVC inventory: unavailable to this identity'; fi

.PHONY: keyring-summary
keyring-summary:
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@docker run --rm --user 0:0 -v "$(KEYRING_SOURCE_DIR):/source:ro" \
	  -v "$(OVERLAY)/keyring-summary.mjs:/workspace/keyring-summary.mjs:ro" "$(LOCAL_IMAGE)" \
	  /bin/sh -ceu 'mkdir /keyring; cp -a /source/. /keyring/; node /workspace/keyring-summary.mjs'

.PHONY: enroll-cloud-code
enroll-cloud-code:
	@test "$(ENV)" = "test-refresh-018" || { echo "ENV=test-refresh-018 is required" >&2; exit 1; }
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(CLOUD_CODE_OWNER_SCOPE_REF)" || { echo "CLOUD_CODE_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@docker run --rm --network host --user "$$(id -u):$$(id -g)" \
	  -e CLOUD_CODE_OWNER_SCOPE_REF="$(CLOUD_CODE_OWNER_SCOPE_REF)" \
	  -v "$(KEYRING_SOURCE_DIR):/keyring" \
	  -v "$(OVERLAY)/enroll-cloud-code.mjs:/workspace/enroll-cloud-code.mjs:ro" "$(LOCAL_IMAGE)" \
	  node /workspace/enroll-cloud-code.mjs

.PHONY: enroll-codex
enroll-codex:
	@test "$(ENV)" = "test-refresh-018" || { echo "ENV=test-refresh-018 is required" >&2; exit 1; }
	@test -n "$(LOCAL_IMAGE)" || { echo "LOCAL_IMAGE is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(REFRESH_OWNER_SCOPE_REF)" || { echo "REFRESH_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@docker run --rm --network host --user "$$(id -u):$$(id -g)" \
	  -e REFRESH_OWNER_SCOPE_REF="$(REFRESH_OWNER_SCOPE_REF)" \
	  -v "$(KEYRING_SOURCE_DIR):/keyring" \
	  -v "$(OVERLAY)/enroll-codex.mjs:/workspace/enroll-codex.mjs:ro" "$(LOCAL_IMAGE)" \
	  node /workspace/enroll-codex.mjs

IMPORT_TRANSPORT ?= codex

.PHONY: import-keyring-account
import-keyring-account:
	@[[ "$(IMPORT_TRANSPORT)" =~ ^(codex|cloud-code)$$ ]] \
	  || { echo "IMPORT_TRANSPORT must be codex or cloud-code" >&2; exit 1; }
	@[[ "$(IMPORT_IMAGE_REF)" =~ ^ghcr\.io/rhanka/radar-api@sha256:[0-9a-f]{64}$$ ]] \
	  || { echo "IMPORT_IMAGE_REF must be the radar API immutable digest" >&2; exit 1; }
	@test -d "$(IMPORT_SOURCE_DIR)" -a -f "$(IMPORT_SOURCE_DIR)/.key" \
	  || { echo "IMPORT_SOURCE_DIR with .key is required" >&2; exit 1; }
	@test -n "$(IMPORT_RENDER_OUT)" || { echo "IMPORT_RENDER_OUT is required" >&2; exit 1; }
	@# The render holds the base64 master key and encrypted accounts. It may only
	@# be CREATED (never overwritten, never through a symlink) in an existing 0700
	@# directory of yours, outside this checkout and outside any git work tree
	@# (e.g. `mktemp -d`); any failure deletes it.
	@set -uo pipefail; umask 077; out="$(IMPORT_RENDER_OUT)"; \
	  if [ -L "$$out" ] || [ -e "$$out" ]; then \
	    echo "IMPORT_RENDER_OUT must not exist yet (no symlink, no overwrite)" >&2; exit 1; fi; \
	  dir="$$(dirname -- "$$out")"; \
	  test -d "$$dir" || { echo "IMPORT_RENDER_OUT directory must exist" >&2; exit 1; }; \
	  dir="$$(cd -- "$$dir" && pwd -P)"; root="$$(cd -- "$(ROOT)" && pwd -P)"; \
	  case "$$dir/" in "$$root/"*) echo "IMPORT_RENDER_OUT must be outside the repository" >&2; exit 1;; esac; \
	  if git -C "$$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then \
	    echo "IMPORT_RENDER_OUT must be outside any git work tree" >&2; exit 1; fi; \
	  { test -O "$$dir" && test "$$(stat -c %a -- "$$dir")" = 700; } \
	    || { echo "IMPORT_RENDER_OUT directory must be yours with mode 0700" >&2; exit 1; }; \
	  out="$$dir/$$(basename -- "$$out")"; \
	  fail() { if [ ! -L "$$out" ]; then rm -f -- "$$out"; fi; echo "$$1; render deleted" >&2; exit 1; }; \
	  ( set -C; : > "$$out" ) 2>/dev/null || { echo "IMPORT_RENDER_OUT could not be created exclusively" >&2; exit 1; }; \
	  { [ ! -L "$$out" ] && [ -f "$$out" ] && [ "$$(cd -- "$$(dirname -- "$$(readlink -f -- "$$out")")" && pwd -P)" = "$$dir" ]; } \
	    || fail "IMPORT_RENDER_OUT resolved outside its directory"; \
	  { kubectl create secret generic radar-refresh-keyring-account-import \
	      --from-file="$(IMPORT_SOURCE_DIR)" --dry-run=client -o yaml && echo --- && \
	    kubectl kustomize --load-restrictor LoadRestrictionsNone "$(OVERLAY)/keyring-import" \
	      | sed -e "s#$(PLACEHOLDER)#$(IMPORT_IMAGE_REF)#g" -e "s#IMPORT-TRANSPORT-SET-BY-RENDER#$(IMPORT_TRANSPORT)#g"; \
	  } > "$$out" || fail "render failed"; \
	  test "$$(grep -c '^kind: Job$$' "$$out")" -eq 1 || fail "render must hold exactly one Job"; \
	  test "$$(grep -c '^kind: Secret$$' "$$out")" -eq 1 || fail "render must hold exactly one Secret"; \
	  ! grep -q 'PINNED-BY-CI\|radar-api:latest\|IMPORT-TRANSPORT-SET-BY-RENDER' "$$out" || fail "render is not pinned"; \
	  grep -A1 -E 'name: IMPORT_TRANSPORT$$' "$$out" | grep -Eq 'value: "?$(IMPORT_TRANSPORT)"?$$' \
	    || fail "rendered Job does not carry IMPORT_TRANSPORT=$(IMPORT_TRANSPORT)"

IMPORT_WAIT_SECONDS ?= 21600
IMPORT_POLL_SECONDS ?= 10
IMPORT_REQUEST_SECONDS ?= 30
IMPORT_OBJECTS := job/radar-refresh-keyring-account-import secret/radar-refresh-keyring-account-import \
  configmap/radar-refresh-keyring-import-script
# Every API call of the import is bounded, both by kubectl and by the clock.
IMPORT_K = timeout $$(( $(IMPORT_REQUEST_SECONDS) * 3 )) $(K) --request-timeout=$(IMPORT_REQUEST_SECONDS)s
# Removes the local render without ever following a symlink (only the link goes).
IMPORT_SHRED_LOCAL = if [ -n "$(IMPORT_RENDER_OUT)" ]; then \
	  if [ -L "$(IMPORT_RENDER_OUT)" ]; then rm -f -- "$(IMPORT_RENDER_OUT)"; \
	  elif [ -f "$(IMPORT_RENDER_OUT)" ]; then shred -u -- "$(IMPORT_RENDER_OUT)" 2>/dev/null || rm -f -- "$(IMPORT_RENDER_OUT)"; fi; fi

# Creates the render's objects ONCE (`kubectl create`: no client-side apply, so
# no last-applied annotation carrying the Secret), waits for the Job to succeed
# or fail (it may first wait on .refresh.lock for a running pass), prints its
# pseudonymized log, and ALWAYS runs cleanup-keyring-import — guard failure,
# create refusal, Job failure, timeout or interruption included. kubectl's
# stderr on the create path is never echoed (it may quote the object): only
# the API reason token is. Exit status is the Job's.
.PHONY: run-keyring-import
run-keyring-import:
	@set -uo pipefail; status=1; \
	  cleanup() { $(MAKE) -s -f "$(lastword $(MAKEFILE_LIST))" cleanup-keyring-import \
	    KUBECONFIG="$(KUBECONFIG)" IMPORT_RENDER_OUT="$(IMPORT_RENDER_OUT)" ENV=$(ENV) \
	    || { echo "keyring import cleanup FAILED: rerun cleanup-keyring-import" >&2; exit 1; }; }; \
	  trap cleanup EXIT; trap 'exit 130' INT TERM; \
	  $(MAKE) -s -f "$(lastword $(MAKEFILE_LIST))" guard-preprod KUBECONFIG="$(KUBECONFIG)" ENV=$(ENV) || exit 1; \
	  test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }; \
	  { [ ! -L "$(IMPORT_RENDER_OUT)" ] && [ -f "$(IMPORT_RENDER_OUT)" ]; } \
	    || { echo "IMPORT_RENDER_OUT must be the regular render file" >&2; exit 1; }; \
	  $(IMPORT_K) delete $(IMPORT_OBJECTS) --ignore-not-found --wait=true >/dev/null 2>&1 \
	    || { echo "could not clear a previous import" >&2; exit 1; }; \
	  err="$$($(IMPORT_K) create -f "$(IMPORT_RENDER_OUT)" 2>&1 >/dev/null)" || { \
	    reason="$$(printf '%s\n' "$$err" | grep -oE '^Error from server \([A-Za-z]+\)' | head -1 | grep -oE '[A-Za-z]+\)$$' | tr -d ')')"; [ -n "$$reason" ] || reason=unknown; \
	    echo "kubectl create refused (reason: $$reason); details withheld, they may quote the Secret" >&2; \
	    err=; exit 1; }; err=; \
	  deadline=$$(( $$(date +%s) + $(IMPORT_WAIT_SECONDS) )); \
	  while :; do \
	    state="$$($(IMPORT_K) get job radar-refresh-keyring-account-import -o jsonpath='{.status.succeeded}/{.status.failed}')" \
	      || { echo "could not read the import Job" >&2; break; }; \
	    case "$$state" in 1/*) status=0; break;; */[1-9]*) echo "keyring import Job failed" >&2; break;; esac; \
	    [ "$$(date +%s)" -lt "$$deadline" ] || { echo "keyring import Job did not finish in time" >&2; break; }; \
	    sleep $(IMPORT_POLL_SECONDS); \
	  done; \
	  $(IMPORT_K) logs job/radar-refresh-keyring-account-import || true; \
	  exit $$status

# Idempotent. The LOCAL render goes first and unconditionally (a guard or API
# failure must never leave the key on disk), then the Job, its Secret (owner
# keyring) and its script ConfigMap. Safe to rerun after any failure; the Job
# TTL alone would leave the Secret and ConfigMap behind.
.PHONY: cleanup-keyring-import
cleanup-keyring-import:
	@$(IMPORT_SHRED_LOCAL)
	@$(MAKE) -s -f "$(lastword $(MAKEFILE_LIST))" guard-preprod KUBECONFIG="$(KUBECONFIG)" ENV=$(ENV)
	@$(IMPORT_K) delete $(IMPORT_OBJECTS) --ignore-not-found --wait=true

.PHONY: test-keyring-import
test-keyring-import: ## Hermetic tests of the keyring account import (no cluster)
	@node --test "$(OVERLAY)/keyring-import/account-import.selftest.mjs"
	@bash "$(OVERLAY)/keyring-import/keyring-import.test.sh"

.PHONY: consent-cloud-code
consent-cloud-code:
	@test "$(ENV)" = "test-refresh-018" || { echo "ENV=test-refresh-018 is required" >&2; exit 1; }
	@[[ "$(OAUTH_URL)" == https://accounts.google.com/* ]] \
	  || { echo "OAUTH_URL must be the active Google authorization URL" >&2; exit 1; }
	@docker run --rm --network host --tmpfs /workspace \
	  -e OAUTH_URL="$(OAUTH_URL)" \
	  -v "$(OVERLAY)/oauth-consent.mjs:/workspace/oauth-consent.mjs:ro" \
	  -w /workspace node:22-bookworm-slim node oauth-consent.mjs

.PHONY: push-immutable
push-immutable:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@[[ "$(PUSH_TAG)" =~ ^r018-[0-9a-f]{8}$$ ]] \
	  || { echo "PUSH_TAG must be the isolated r018 commit tag" >&2; exit 1; }
	@docker image inspect "radar-immobilier-api:$(PUSH_TAG)" >/dev/null
	@docker tag "radar-immobilier-api:$(PUSH_TAG)" "$(API_IMAGE):$(PUSH_TAG)"
	@docker push "$(API_IMAGE):$(PUSH_TAG)"

.PHONY: image-digest
image-digest:
	@test "$(ENV)" = "preprod" || { echo "ENV=preprod is required" >&2; exit 1; }
	@[[ "$(PUSH_TAG)" =~ ^r018-[0-9a-f]{8}$$ ]] \
	  || { echo "PUSH_TAG must be the isolated r018 commit tag" >&2; exit 1; }
	@docker image inspect "$(API_IMAGE):$(PUSH_TAG)" \
	  --format '{{range .RepoDigests}}{{println .}}{{end}}' | grep '^$(API_IMAGE)@sha256:'

.PHONY: render-preprod
render-preprod:
	@[[ "$(IMAGE_REF)" =~ ^ghcr\.io/rhanka/radar-api@sha256:[0-9a-f]{64}$$ ]] \
	  || { echo "IMAGE_REF must be the radar API immutable digest" >&2; exit 1; }
	@test -n "$(RENDER_OUT)" || { echo "RENDER_OUT is required" >&2; exit 1; }
	@set -o pipefail; umask 077; kubectl kustomize --load-restrictor LoadRestrictionsNone "$(OVERLAY)" \
	  | sed "s#$(PLACEHOLDER)#$(IMAGE_REF)#g" > "$(RENDER_OUT)"
	@! grep -q 'PINNED-BY-CI\|radar-api:latest' "$(RENDER_OUT)"

.PHONY: render-prod
render-prod:
	@[[ "$(IMAGE_REF)" =~ ^ghcr\.io/rhanka/radar-api@sha256:[0-9a-f]{64}$$ ]] \
	  || { echo "IMAGE_REF must be the radar API immutable digest" >&2; exit 1; }
	@test -n "$(RENDER_OUT)" || { echo "RENDER_OUT is required" >&2; exit 1; }
	@set -o pipefail; umask 077; kubectl kustomize --load-restrictor LoadRestrictionsNone "$(PROD_OVERLAY)" \
	  | sed "s#$(PLACEHOLDER)#$(IMAGE_REF)#g" > "$(RENDER_OUT)"
	@! grep -q 'PINNED-BY-CI\|radar-api:latest' "$(RENDER_OUT)"

# Contrat de rendu des DEUX overlays. Au-delà du contrat de modèle, il épingle
# depuis #734 le balayage toutes-villes : une commande sans `--all`, ou avec un
# slug en dur, est refusée ici — c'est cette garde qui manquait quand le job
# quotidien a silencieusement cessé de rafraîchir autre chose qu'une ville.
#
# La garde est STRUCTURELLE, pas numérique. Elle exige `--all`, l'absence de
# slug positionnel, et la PRÉSENCE des variables de balayage — pas leurs
# valeurs. Épingler ici les réglages (échéances, plafonds, réserve) transformait
# chaque ajustement d'exploitation en double modification, et gelait en CI des
# valeurs dont la conception dit elles-mêmes qu'elles doivent bouger à la
# première mesure réelle. Ce qui doit rester figé — modèles, efforts, activation,
# enveloppe mémoire prod — l'est par les autres blocs.
#
# Depuis l'armement du CD de production (2026-09-20), trois blocs s'ajoutent, et
# ils ne figent toujours aucune valeur d'exploitation :
#   - PARITÉ DES DEUX OVERLAYS (refresh-contract.awk) : tout ce qui n'est pas une
#     divergence VOULUE — namespace, enveloppe mémoire, liaison S3 — doit
#     coïncider entre le rendu préprod et le rendu prod. C'est la garde qui
#     manquait : #736 a porté `--all`, l'échéance à 19 800 s et quatre passages
#     dans la BASE, donc les deux overlays en héritent ; rien n'empêchait
#     jusqu'ici un patch prod de s'en écarter en silence ;
#   - COHÉRENCE TEMPORELLE (refresh-window.awk) : le balayage doit s'arrêter
#     avant l'échéance du Job, et un passage doit tenir dans son créneau — en
#     `concurrencyPolicy: Forbid`, un passage encore en vol fait SAUTER le
#     suivant ;
#   - l'enveloppe mémoire de production reste épinglée en toutes lettres, avec
#     le message d'erreur qui manquait.
#
# Depuis l'incident du 2026-10-09 (prod et préprod lancées à la même minute sur
# le même nœud, PVC keyring RWO bloqués à l'attachement, 4 h 30 de Pending),
# deux blocs s'ajoutent, eux aussi relationnels :
#   - DÉCALAGE (refresh-stagger.awk) : forme `<minute> <heures> * * *`, et les
#     lancements prod et préprod les plus proches à au moins
#     REFRESH_STAGGER_MIN_MINUTES l'un de l'autre (la minute et le nombre de
#     passages, communs, sont gardés par la parité) ;
#   - GARDIEN DES PODS PENDING (refresh-watchdog.awk) : le CronJob
#     radar-refresh-pending-watchdog est rendu, actif, câblé sur le label du pod
#     de passage, et le Job de passage garde `backoffLimit: 0`.
# Cutover suspension/drainage is covered by the controller tests in Quality gates;
# the engine captures every CronJob instead of consuming QUIESCE_CRONJOBS.
# Les tests de mutation de ces blocs : verify-renders.test.sh (CI).

.PHONY: verify-renders
verify-renders:
	@set -euo pipefail; tmp="$$(mktemp -d)"; trap 'rm -rf "$$tmp"' EXIT; \
	  image='ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000'; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$$image" RENDER_OUT="$$tmp/preprod.yaml" ENV=$(ENV); \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-prod IMAGE_REF="$$image" RENDER_OUT="$$tmp/prod.yaml" ENV=$(ENV); \
	  for render in "$$tmp/preprod.yaml" "$$tmp/prod.yaml"; do \
	    test -s "$$render" || { echo "empty refresh render: $$render" >&2; exit 1; }; \
	    awk 'BEGIN{RS="\n---\n"} /[^[:space:]]/ { if ($$0 !~ /apiVersion:/ || $$0 !~ /kind:/) { print "missing apiVersion/kind in refresh render" > "/dev/stderr"; bad=1 } } END{ exit bad }' "$$render"; \
	    awk -f "$(WATCHDOG_AWK)" "$$render" \
	      || { echo "refresh pending watchdog contract failed: $$render" >&2; exit 1; }; \
	    test "$$(grep -c '^kind: CronJob$$' "$$render")" -eq 2 \
	      || { echo "refresh render must contain exactly two CronJobs (radar-refresh-pv, radar-refresh-pending-watchdog): $$render" >&2; exit 1; }; \
	    test "$$(grep -c '^kind: PersistentVolumeClaim$$' "$$render")" -eq 1; \
	    awk 'BEGIN{RS="\n---\n"} /kind: CronJob/ && /\n  name: radar-refresh-pv\n/ { \
	      pv=1; \
	      if ($$0 !~ /suspend: false/) exit 1; \
	      if (($$0 !~ /name: REFRESH_PROVIDER\n[ ]+value: openai\n/ \
	        || $$0 !~ /name: REFRESH_MODEL\n[ ]+value: gpt-6-astra\n/ \
	        || $$0 !~ /name: REFRESH_REASONING_EFFORT\n[ ]+value: medium\n/ \
	        || $$0 !~ /name: REFRESH_PRIMARY_QUALITY_ATTEMPTS\n[ ]+value: "2"/ \
	        || $$0 !~ /name: REFRESH_FALLBACK_PROVIDER\n[ ]+value: gemini\n/ \
	        || $$0 !~ /name: REFRESH_FALLBACK_MODEL\n[ ]+value: gemini-3.8-flash\n/ \
	        || $$0 !~ /name: REFRESH_FALLBACK_REASONING_EFFORT\n[ ]+value: low\n/ \
	        || $$0 !~ /name: REFRESH_VERIFY_ENABLED\n[ ]+value: "1"/ \
	        || $$0 !~ /name: REFRESH_VERIFY_PROVIDER\n[ ]+value: gemini\n/ \
	        || $$0 !~ /name: REFRESH_VERIFY_MODEL\n[ ]+value: gemini-3.8-flash\n/ \
	        || $$0 !~ /name: REFRESH_VERIFY_REASONING_EFFORT\n[ ]+value: low\n/ \
	        || $$0 !~ /name: REFRESH_MAX_OUTPUT_TOKENS\n[ ]+value: "32768"/)) exit 1; \
	    } END { if (!pv) exit 1 }' "$$render" || { echo "refresh activation/model contract failed: $$render" >&2; exit 1; }; \
	    awk 'BEGIN{RS="\n---\n"} /kind: CronJob/ && /\n  name: radar-refresh-pv\n/ { pv=1; \
	      if ($$0 !~ /- dist\/scripts\/refresh-pv\.js\n[ ]+- --all\n[ ]+env:/) exit 1; \
	      if ($$0 ~ /refresh-pv\.js\n[ ]+- [a-z]/) exit 1; \
	      if ($$0 !~ /activeDeadlineSeconds: [0-9]+\n/) exit 1; \
	      if ($$0 !~ /terminationGracePeriodSeconds: [0-9]+\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_WINDOW_DAYS\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_ACQUISITION_LIMIT\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_SWEEP_DEADLINE_MS\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_SWEEP_MAX_SUBMISSIONS\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_MAX_DOCUMENT_FAILURES\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_SWEEP_CITY_RESERVE_MS\n/) exit 1; \
	      if ($$0 !~ /name: REFRESH_SWEEP_MAX_FAILURE_RATE\n/) exit 1; \
	    } END { if (!pv) exit 1 }' "$$render" || { echo "refresh whole-list sweep contract failed: $$render" >&2; exit 1; }; \
	    awk 'function flush(){if(active && literal && reference){print "mixed value/valueFrom: " name > "/dev/stderr"; bad=1} literal=0; reference=0} \
	      /^[[:space:]]*- name:/ {flush(); active=1; name=$$0; next} \
	      active && /^[[:space:]]+value:[[:space:]]/ {literal=1} \
	      active && /^[[:space:]]+valueFrom:[[:space:]]*$$/ {reference=1} \
	      END {flush(); exit bad}' "$$render"; \
	    awk -f "$(WINDOW_AWK)" "$$render" \
	      || { echo "refresh temporal contract failed: $$render" >&2; exit 1; }; \
	  done; \
	  awk 'BEGIN{RS="\n---\n"} /name: radar-refresh-pv\n/ { \
	    if ($$0 !~ /memory: 768Mi/ || $$0 !~ /--max-old-space-size=512/) exit 1; \
	  }' "$$tmp/prod.yaml" \
	    || { echo "prod memory envelope contract failed: the prod render must keep memory: 768Mi and --max-old-space-size=512 (quota radar-immobilier)" >&2; exit 1; }; \
	  awk -f "$(CONTRACT_AWK)" "$$tmp/preprod.yaml" | sort > "$$tmp/preprod.contract"; \
	  awk -f "$(CONTRACT_AWK)" "$$tmp/prod.yaml" | sort > "$$tmp/prod.contract"; \
	  test -s "$$tmp/prod.contract" || { echo "empty refresh contract projection" >&2; exit 1; }; \
	  diff -u "$$tmp/preprod.contract" "$$tmp/prod.contract" \
	    || { echo "refresh overlay parity failed: preprod and prod diverge outside the four intended differences (namespace, memory envelope, S3 binding, refresh hour list) — see the diff above (< preprod, > prod)" >&2; exit 1; }; \
	  wf="$(ROOT)/.github/workflows/bascule-preprod.yml"; \
	  awk -v min_minutes=$(REFRESH_STAGGER_MIN_MINUTES) -f "$(STAGGER_AWK)" "$$tmp/preprod.yaml" "$$tmp/prod.yaml" \
	    || { echo "refresh stagger failed: the closest prod and preprod refresh starts must be at least $(REFRESH_STAGGER_MIN_MINUTES) minutes apart (incident 2026-10-09)" >&2; exit 1; }; \
	  crons="$$(awk -f "$(BASCULE_CRONS_AWK)" "$$wf")" \
	    || { echo "bascule window contract failed: unreadable on.schedule in $$wf" >&2; exit 1; }; \
	  test "$$(printf "%s\n" "$$crons" | grep -c .)" -eq 1 \
	    || { echo "bascule window contract failed: $$wf must carry exactly one active on.schedule cron (got: $$(printf "%s" "$$crons" | tr "\n" "|"))" >&2; exit 1; }; \
	  mkdir "$$tmp/backup" && cp "$(BACKUP_DAILY_MANIFEST)" "$$tmp/backup/manifest.yaml" \
	    && printf "resources:\n  - manifest.yaml\n" > "$$tmp/backup/kustomization.yaml" \
	    && kubectl kustomize "$$tmp/backup" > "$$tmp/backup.yaml" \
	    || { echo "bascule window contract failed: cannot render $(BACKUP_DAILY_MANIFEST) (canonical YAML documents are required)" >&2; exit 1; }; \
	  awk -v restore="$$crons" -f "$(BASCULE_WINDOW_AWK)" "$$tmp/preprod.yaml" "$$tmp/prod.yaml" "$$tmp/backup.yaml" \
	    || { echo "bascule window contract failed: the daily restore slot of $$wf must stay after the daily backup and clear of every refresh start" >&2; exit 1; }

.PHONY: seed-preprod
seed-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -f "$(KEYRING_SOURCE_DIR)/.key" || { echo "keyring master key is required" >&2; exit 1; }
	@test -n "$(REFRESH_OWNER_SCOPE_REF)" || { echo "REFRESH_OWNER_SCOPE_REF is required" >&2; exit 1; }
	@set -o pipefail; $(K) create secret generic radar-refresh-keyring-bootstrap \
	  --from-file="$(KEYRING_SOURCE_DIR)" --dry-run=client -o yaml | $(K) apply -f -
	@set -o pipefail; $(K) create secret generic radar-refresh-runtime \
	  --from-literal=REFRESH_PRINCIPAL_REF=radar-refresh-pv-preprod \
	  --from-literal=REFRESH_OWNER_SCOPE_REF="$(REFRESH_OWNER_SCOPE_REF)" \
	  --dry-run=client -o yaml | $(K) apply -f -

.PHONY: apply-preprod
apply-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$(IMAGE_REF)" RENDER_OUT="$$tmp" ENV=preprod; \
	  $(K) apply -f "$$tmp"

.PHONY: validate-preprod
validate-preprod: guard-preprod
	@set -e; tmp="$$(mktemp)"; trap 'rm -f "$$tmp"' EXIT; \
	  $(MAKE) -f "$(lastword $(MAKEFILE_LIST))" render-preprod IMAGE_REF="$(IMAGE_REF)" RENDER_OUT="$$tmp" ENV=preprod; \
	  $(K) apply --dry-run=server -f "$$tmp" >/dev/null

.PHONY: trigger-preprod
trigger-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) create job "radar-refresh-pv-$(RUN_ID)" --from=cronjob/radar-refresh-pv

.PHONY: observe-scheduled-preprod
observe-scheduled-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@old_schedule="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.spec.schedule}')"; \
	  before="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.status.lastScheduleTime}')"; \
	  restore() { $(K) patch cronjob radar-refresh-pv --type=merge \
	    -p "{\"spec\":{\"schedule\":\"$$old_schedule\"}}" >/dev/null; }; \
	  trap restore EXIT; \
	  $(K) patch cronjob radar-refresh-pv --type=merge \
	    -p '{"spec":{"schedule":"* * * * *"}}' >/dev/null; \
	  current=""; \
	  for attempt in $$(seq 1 24); do \
	    current="$$($(K) get cronjob radar-refresh-pv -o jsonpath='{.status.lastScheduleTime}')"; \
	    test -n "$$current" -a "$$current" != "$$before" && break; \
	    sleep 5; \
	  done; \
	  test -n "$$current" -a "$$current" != "$$before" \
	    || { echo "CronJob controller did not schedule within 120 seconds" >&2; exit 1; }; \
	  if ! restore; then echo "Failed to restore the daily schedule" >&2; exit 1; fi; \
	  trap - EXIT; \
	  job="$$($(K) get jobs \
	    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.ownerReferences[0].name}{"\t"}{.metadata.creationTimestamp}{"\n"}{end}' \
	    | awk '$$2 == "radar-refresh-pv" { print }' | sort -k3 | tail -1 | cut -f1)"; \
	  test -n "$$job" || { echo "Scheduled Job owner reference not found" >&2; exit 1; }; \
	  $(K) wait --for=condition=complete "job/$$job" --timeout=19800s; \
	  $(K) get "job/$$job" -o custom-columns=NAME:.metadata.name,OWNER:.metadata.ownerReferences[0].name,IMAGE:.spec.template.spec.containers[0].image,START:.status.startTime,END:.status.completionTime; \
	  $(K) logs "job/$$job" --all-containers=true

.PHONY: replace-zero-pod-preprod
replace-zero-pod-preprod: guard-preprod
	@test "$(PREPROD_CONFIRM)" = "1" || { echo "PREPROD_CONFIRM=1 is required" >&2; exit 1; }
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@test -z "$$($(K) get pods -l "job-name=radar-refresh-pv-$(RUN_ID)" -o name)" \
	  || { echo "refusing to replace a Job that created a Pod" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" -o name >/dev/null
	@$(K) delete job "radar-refresh-pv-$(RUN_ID)" --wait=true
	@$(K) create job "radar-refresh-pv-$(RUN_ID)" --from=cronjob/radar-refresh-pv

.PHONY: status-preprod
status-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=NAME:.metadata.name,ACTIVE:.status.active,SUCCEEDED:.status.succeeded,FAILED:.status.failed,START:.status.startTime,END:.status.completionTime
	@$(K) get pods -l "job-name=radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=NAME:.metadata.name,PHASE:.status.phase,REASON:.status.reason,IMAGE:.spec.containers[0].image

.PHONY: logs-preprod
logs-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) logs "job/radar-refresh-pv-$(RUN_ID)" --all-containers=true

.PHONY: diagnose-preprod
diagnose-preprod: guard-preprod
	@test -n "$(RUN_ID)" || { echo "RUN_ID is required" >&2; exit 1; }
	@$(K) get job "radar-refresh-pv-$(RUN_ID)" \
	  -o jsonpath='{range .status.conditions[*]}{.type}{"="}{.status}{" reason="}{.reason}{" message="}{.message}{"\n"}{end}'
	@$(K) get events --field-selector "involvedObject.name=radar-refresh-pv-$(RUN_ID)" \
	  -o custom-columns=TIME:.lastTimestamp,TYPE:.type,REASON:.reason,MESSAGE:.message
	@$(K) get resourcequota preprod-cap -o jsonpath='requests.cpu={.status.used.requests\.cpu}/{.status.hard.requests\.cpu}{"\n"}limits.cpu={.status.used.limits\.cpu}/{.status.hard.limits\.cpu}{"\n"}requests.memory={.status.used.requests\.memory}/{.status.hard.requests\.memory}{"\n"}limits.memory={.status.used.limits\.memory}/{.status.hard.limits\.memory}{"\n"}'
