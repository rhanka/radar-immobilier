#!/usr/bin/env bash
# Enchaînement natif, uniquement dans le workspace privé aux binaires de fixture.
rehearsal=$root/tmp/vehicle-evidence/rehearsal-native
mkdir -p "$rehearsal"
: > "$rehearsal/sequence.txt"
mark(){ printf '%s\n' "$1" >> "$rehearsal/sequence.txt"; }
jq '.ownerOverride={reference:"fixture-owner-override",authenticatedQualification:"immediately-after-reopen"}' input.json > rehearsal-input.json
cp rehearsal-input.json input.json
invoke preflight; mark preflight
invoke freeze-cd; mark freeze-cd
cp ingress-original.json ingress-fixture.json
invoke close EXPECTED="$testdir/expected.json"; mark close
closure_snapshot=$testdir/out-$n/ingress-snapshot.json
closure_sha=$(sha256sum "$closure_snapshot"|cut -d' ' -f1)
jq -nc --slurpfile c input.json --arg at "$(date -u +%FT%TZ)" '{action:"activate",binding:$c[0].binding,image:$c[0].image,
 releaseSha:($c[0].binding.releaseId|split(":")[0]),observedAt:$at,result:{workspaceId:$c[0].binding.workspaceId,
 sealedUnresolved:0,pendingReceipts:0,status:"open-success",epoch:"scoped",maintenanceBarrier:false}}' > synthetic-receipt.json
receipt_sha=$(sha256sum synthetic-receipt.json|cut -d' ' -f1)
jq -n --slurpfile c input.json --arg sha "$receipt_sha" '{status:"complete",binding:$c[0].binding,image:$c[0].image,
 releaseSha:($c[0].binding.releaseId|split(":")[0]),sha256:$sha}' > synthetic-termination.json
invoke activate EXPECTED="$testdir/expected.json" PROOFS="$testdir/proofs.json"; mark activate
activation=$testdir/out-$n/receipt.json
jq --arg at "$(date -u +%FT%TZ)" '.startedAt=$at' api-fixture.json > rehearsal-api.json
cp rehearsal-api.json api-fixture.json
invoke start-api PROOFS="$activation"; mark start-api
instance=$testdir/out-$n/api-instance.json
jq -n --slurpfile instance "$instance" --arg at "$(date -u +%FT%TZ)" '{observedAt:$at,instance:$instance[0],passed:true,kind:"fixture-only-server-readback",writerEpoch:"scoped",maintenanceBarrier:false,lotsOpen:false}' > q1.json
mark q1
jq -n --slurpfile c input.json --slurpfile q q1.json --arg sha "$(sha256sum q1.json|cut -d' ' -f1)" '{binding:$c[0].binding,image:$c[0].image,ownerOverride:$c[0].ownerOverride,authenticatedAcceptanceDeferred:true,
 q1:{reference:"fixture-q1",sha256:$sha,observedAt:$q[0].observedAt,passed:true,instance:$q[0].instance},
 personal:{writerEpoch:"scoped",maintenanceBarrier:false},lotsOpen:false,mcpSuccessorDeployed:true}' > acceptance-q1.json
# Le redémarrage RFC3339 est à la seconde ; la fixture respecte l'ordre strict natif.
sleep 1
restart_at=$(date -u +%FT%TZ)
local_restart=$(TZ=America/Toronto date -d "$restart_at" +%FT%T%:z)
jq --arg at "$restart_at" --arg local "$local_restart" '.generation="3" | .podUid="synthetic-after-pod"
 | .containerId="containerd://synthetic-after" | .templateHash="synthetic-after" | .startedAt=$at | .restartedAt=$local' api-fixture.json > api-after-fixture.json
invoke restart-api PROOFS="$testdir/acceptance-q1.json"; mark restart-api
restart=$testdir/out-$n/restart.json
jq -n --slurpfile r "$restart" --arg at "$(date -u +%FT%TZ)" '{observedAt:$at,instance:$r[0].instance,
 passed:true,kind:"fixture-only-server-readback",writerEpoch:"scoped",maintenanceBarrier:false,lotsOpen:false}' > q2.json
mark q2
jq --slurpfile q q2.json --slurpfile r "$restart" --arg sha "$(sha256sum q2.json|cut -d' ' -f1)" '.+{restart:$r[0],q2:{reference:"fixture-q2",sha256:$sha,observedAt:$q[0].observedAt,passed:true,afterRestart:true,instance:$q[0].instance}}' acceptance-q1.json > acceptance.json
mark proof
{ sed '$d' tools/make/base-preprod-input.jq; cat tools/make/base-preprod-acceptance.jq; } > exact-native-filter.jq
jq -e --slurpfile input input.json -f exact-native-filter.jq acceptance.json > native-filter-result.json
mark native-filter
invoke reopen-api PROOFS="$testdir/acceptance.json"; mark reopen-api
for path in input.json q1.json q2.json acceptance.json exact-native-filter.jq native-filter-result.json ingress-fixture.json cluster-calls;do cp "$path" "$rehearsal/";done
jq -n --slurpfile c input.json --slurpfile ingress ingress-fixture.json '{kind:"fixture-only",status:"native-reopened-awaiting-auth",lateReopenBy:(now|floor-1|todateiso8601),binding:$c[0].binding,
 image:$c[0].image,exposedPrefixes:[$ingress[0].items[].spec.rules[]?.http.paths[]?|select(.backend.service.name=="radar-api")|.path]}' > "$rehearsal/summary.json"
# Les lectures CDP sont simulées dans Node sans réseau, avant la récupération native.
(
  cd "$root"
  PATH="$fixture_host_path" bash tools/make/base-preprod-probe.test.sh rehearsal
) > "$root/tmp/vehicle-evidence/rehearsal-authenticated.json" 2> "$root/tmp/vehicle-evidence/rehearsal-transport.log"
jq -e '.q1.passed and .q2.passed and (.lateQ1.passed|not) and .lateQ1.ownedTargetClosed' "$root/tmp/vehicle-evidence/rehearsal-authenticated.json" >/dev/null
mark q1-authenticated; mark q2-authenticated; mark q1-late-failure
source tools/make/base-preprod-reclose.test.sh
cp cluster-calls "$rehearsal/cluster-calls"
cp "$reclosed_snapshot" "$rehearsal/reclosed-snapshot.json"
cp ingress-fixture.json "$rehearsal/restored-ingresses.json"
jq '.status="native-restored" | .recovery={reclosed:true,verifiedClosed:true,restored:true}' "$rehearsal/summary.json" > "$rehearsal/final-summary.json"
mv "$rehearsal/final-summary.json" "$rehearsal/summary.json"
printf 'PASS répétition native : activation → Q1 → redémarrage → Q2 → filtre → réouverture\n'
