#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-* ]]
mkdir -p tmp/vehicle-evidence
BASE_PREPROD_REHEARSAL=1 bash tools/make/base-preprod-operator.test.sh > tmp/vehicle-evidence/rehearsal-native.log 2>&1
jq --slurpfile native tmp/vehicle-evidence/rehearsal-native/summary.json --rawfile sequence tmp/vehicle-evidence/rehearsal-native/sequence.txt '.+{sequence:($sequence|rtrimstr("\n")|split("\n")),recovery:$native[0].recovery}' tmp/vehicle-evidence/rehearsal-authenticated.json >tmp/vehicle-evidence/rehearsal-complete.json
jq -e '.kind=="fixture-only" and .passed and .nativeFilter and .q1.passed and .q2.passed
 and (.lateQ1.passed|not) and .lateQ1.ownedTargetClosed
 and .recovery.reclosed and .recovery.verifiedClosed and .recovery.restored
 and .sequence[-3:]==["reclose-api","verify-closed","restore-ingresses"]' tmp/vehicle-evidence/rehearsal-complete.json >/dev/null
jq '{passed,sequence,nativeFilter,q1:.q1.passed,q2:.q2.passed,lateQ1:.lateQ1.passed,recovery}' tmp/vehicle-evidence/rehearsal-complete.json
