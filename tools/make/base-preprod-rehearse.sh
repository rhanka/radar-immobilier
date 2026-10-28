#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == test-* ]]
mkdir -p tmp/vehicle-evidence
BASE_PREPROD_REHEARSAL=1 bash tools/make/base-preprod-operator.test.sh > tmp/vehicle-evidence/rehearsal-native.log 2>&1
bash tools/make/base-preprod-probe.test.sh rehearsal > tmp/vehicle-evidence/rehearsal-complete.json 2> tmp/vehicle-evidence/rehearsal-transport.log
jq -e '.kind=="fixture-only" and .passed and .nativeFilter and .q1.passed and .q2.passed
 and .q1.ownedTargetClosed and .q2.ownedTargetClosed' tmp/vehicle-evidence/rehearsal-complete.json >/dev/null
jq '{passed,sequence,nativeFilter,q1:.q1.passed,q2:.q2.passed}' tmp/vehicle-evidence/rehearsal-complete.json
