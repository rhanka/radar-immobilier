#!/usr/bin/env bash
# La fermeture initiale ne doit jamais remplacer le snapshot après réouverture.
cp ingress-fixture.json before-reclose.json
: > cluster-calls
if invoke close EXPECTED="$testdir/expected.json";then
  echo 'ÉCHEC : close réexécuté après réouverture' >&2;exit 1
fi
if rg -- '--request-timeout=20s (create|patch|scale|set|delete|rollout) ' cluster-calls;then
  echo 'ÉCHEC : close après réouverture a tenté une mutation' >&2;exit 1
fi
cmp before-reclose.json ingress-fixture.json
printf 'PASS close après réouverture refusé sans mutation\n'
