: > cluster-calls
invoke preflight
jq -e --slurpfile c input.json '.passed and .binding==$c[0].binding and .changeFreeze==$c[0].maintenance.changeFreeze and .reopenBy==$c[0].maintenance.reopenBy' "out-$n/preflight.json" >/dev/null
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) |^gh .*--method (PUT|POST|PATCH|DELETE)' cluster-calls;then
  echo 'ÉCHEC : préflight mutateur' >&2;exit 1
fi
printf 'PASS préflight : accord complet, référencé et valable jusqu’à réouverture\n'
