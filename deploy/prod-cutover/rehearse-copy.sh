#!/usr/bin/env bash
set -euo pipefail
# Invoked later by i-cond. Preparation never invokes this script.
private="$HOME/.local/share/radar-prod-copy"
export PATH="$private/bin:$PATH"
export PGHOST=127.0.0.1 PGPORT=25433 PGUSER=radar PGDATABASE=radar_cutover_owner_20261113
export PGPASSWORD
PGPASSWORD=$(cat "$private/local-password")
export ARCHIVE="$private/prod-20261113.dump"
export RESTORE_SHA256=6e6648d360cf354ab80cbac8822d08de8d69f1568c6203bf151b4c230f4745df
export PLAN="$private/plan.json" ROSTER="$private/roster.json"
export RELEASE="$PWD/deploy/prod-cutover/release.json"
export OUTPUT="$private/rehearsal-owner-20261113"
export APPROVAL="$private/approval.json" EVIDENCE="$OUTPUT/local-evidence.json"
export NODE_EXTRA_CA_CERTS="$private/ca.crt" SMOKE_URL=https://recette.localhost:15321
if [[ ${1:-} == local-* ]]; then
  exec node deploy/prod-cutover/rehearsal.cjs "${1#local-}"
fi
[[ -f $APPROVAL && -f $EVIDENCE ]]
if [[ ${1:-} == smoke ]]; then exec node deploy/prod-cutover/rehearsal.cjs smoke; fi
exec make -f deploy/prod-cutover/prod-cutover.mk "${1:?operation required}" ENV=rehearsal
