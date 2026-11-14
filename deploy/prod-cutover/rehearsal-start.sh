#!/usr/bin/env bash
set -euo pipefail
[[ ${ENV:-} == rehearsal && -n ${OWNER:-} ]]
preparation=(make --no-print-directory -f deploy/prod-cutover/preparation.mk)
"${preparation[@]}" copy-prepare OWNER="$OWNER" ENV=rehearsal
"${preparation[@]}" copy-images ENV=rehearsal
started=0
restored=0
cleanup() {
  local code=$?
  trap - EXIT
  if ((code != 0 && started == 1)); then
    if ((restored == 1)); then
      "${preparation[@]}" copy-services-stop ENV=rehearsal || true
      printf 'Copie restaurée conservée pour diagnostic. Recette non validée.\n' >&2
    else "${preparation[@]}" copy-down ENV=rehearsal || true; fi
  fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
started=1
"${preparation[@]}" copy-up ENV=rehearsal
"${preparation[@]}" copy-evidence ENV=rehearsal
"${preparation[@]}" copy-step STEP=restore-test ENV=rehearsal
restored=1
for step in migrate transition transition verify; do
  "${preparation[@]}" copy-step STEP="$step" ENV=rehearsal
done
"${preparation[@]}" copy-services-up ENV=rehearsal
"${preparation[@]}" copy-step STEP=smoke ENV=rehearsal
printf 'Copie prête pour la recette authentifiée : https://recette.localhost:15321\n'
printf 'Puis copy-services-stop, rollback deux fois et copy-down ENV=rehearsal. Aucun GO prod.\n'
