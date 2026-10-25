#!/usr/bin/env bash
# Hermetic host tests: fake cluster binaries, unreadable environment sentinel, no Docker.
set -euo pipefail
root=$(pwd -P)
mkdir -p "$root/tmp"
testdir=$(mktemp -d "$root/tmp/base-preprod-tests.XXXXXX")
trap 'status=$?; if [[ $status == 0 ]]; then rm -rf "$testdir"; else cat "$testdir"/result-*.log >&2; echo "Retained: $testdir" >&2; fi' EXIT
mkdir -p "$testdir/tools/make" "$testdir/deploy/base-preprod" "$testdir/bin" "$testdir/.env"
cp tools/make/base-preprod*.sh tools/make/base-preprod*.jq "$testdir/tools/make/"
cp deploy/base-preprod/operator.mk "$testdir/deploy/base-preprod/"
printf '%s\n' '$(error root_makefile_was_read)' > "$testdir/Makefile"
printf '#!/bin/sh\nprintf unexpected >> "%s/cluster-calls"\nexit 1\n' "$testdir" > "$testdir/bin/kubectl"
cp "$testdir/bin/kubectl" "$testdir/bin/gh"
chmod +x "$testdir/bin/"*
export PATH="$testdir/bin:$PATH"
cd "$testdir"
now=$(date -u +%FT%TZ)
jq -n --arg now "$now" '{context:"synthetic-context",namespace:"radar-immobilier-preprod",
 image:("ghcr.io/fixture/api@sha256:"+("a"*64)),jobName:"base-operator-synthetic",operation:"inspect",
 repository:"fixture/repository",reason:"synthetic qualification",
 binding:{workspaceId:"11111111-1111-4111-8111-111111111111",actorSub:"opaque:fixture",
 maintenanceAttemptId:"22222222-2222-4222-8222-222222222222",releaseId:(("b"*40)+":synthetic")},
 backup:{reference:"synthetic-backup",sha256:("c"*64),restoredAt:$now,restoreReceiptSha256:("d"*64)}}' > input.json
n=0
invoke() {
  n=$((n+1))
  make --no-print-directory -f deploy/base-preprod/operator.mk "$@" INPUT="$testdir/input.json" OUTPUT="$testdir/out-$n" ENV=preprod > "$testdir/result-$n.log" 2>&1
}
reject() {
  if invoke "$@"; then echo "Unexpected success: $*" >&2; exit 1; fi
  [[ ! -e cluster-calls ]] || { cat cluster-calls >&2; exit 1; }
}
invoke validate
invoke render-job
jq -e '.spec.backoffLimit==0 and .spec.activeDeadlineSeconds==540
 and .spec.template.spec.serviceAccountName=="radar-app"
 and .spec.template.spec.automountServiceAccountToken==false
 and .spec.template.spec.securityContext.runAsUser==1001
 and .spec.template.spec.restartPolicy=="Never"
 and .spec.template.spec.containers[0].workingDir=="/workspace"
 and .spec.template.spec.containers[0].readinessProbe.exec.command==["/bin/false"]
 and (.spec.template.spec.containers[0].image|contains("@sha256:"))' "out-$n/job.json" >/dev/null
cp input.json valid.json
for field in context image reason binding.actorSub binding.releaseId backup.reference; do
  jq --arg field "$field" 'setpath($field|split(".");"<OWNER_INPUT>")' valid.json > input.json
  reject activate
done
cp valid.json input.json
reject activate
reject resume
reject close
n=$((n+1))
if make --no-print-directory -f deploy/base-preprod/operator.mk activate OUTPUT="$testdir/out-$n" ENV=preprod > /dev/null 2>&1; then exit 1; fi
canary=$testdir/injected
literal='$(shell touch '"$canary"') `touch '"$canary"'` $HOME ; "quote"'
jq --arg literal "$literal" '.binding.actorSub=$literal | .reason=$literal' valid.json > input.json
invoke render-job
[[ ! -e $canary ]]
jq -e --arg literal "$literal" '.spec.template.spec.containers[0].command[2]|fromjson|.binding.actorSub==$literal' "out-$n/job.json" >/dev/null
n=$((n+1))
if make --no-print-directory -f deploy/base-preprod/operator.mk validate 'INPUT=$(shell touch '"$canary"')' OUTPUT="$testdir/out-$n" ENV=preprod > /dev/null 2>&1; then exit 1; fi
[[ ! -e $canary && ! -e cluster-calls ]]
printf 'PASS operator refusals, literal Make/shell transport, no root/environment discovery, static Job contract (%s cases)\n' "$n"
