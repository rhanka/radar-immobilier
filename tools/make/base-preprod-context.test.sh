fi
if ! rg -q 'operator.mk verify-closed' "$result";then
  cat "$result" >&2
  echo 'ÉCHEC : rollback sans entrée initialisée native' >&2;exit 1
fi
if rg -q 'unbound variable|APPEL RÉEL INTERDIT' "$result";then cat "$result" >&2;exit 1;fi
printf 'PASS rollback : contexte absent refusé avant gh\n'
