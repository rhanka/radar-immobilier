#!/usr/bin/env bash
: > cluster-calls
if invoke public-probe PUBLIC_PHASE=invalid;then echo 'ÉCHEC : phase publique invalide acceptée' >&2;exit 1;fi
rg -qF 'PUBLIC_PHASE=preflight|q1|q2' "result-$n.log"
[[ ! -s cluster-calls ]]
