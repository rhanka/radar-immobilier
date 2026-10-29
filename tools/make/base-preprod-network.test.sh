jq '.items[0].metadata.annotations["traefik.ingress.kubernetes.io/router.middlewares"]="auth@file"' middleware-baseline.json > ingress-fixture.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Traefik middleware annotations are forbidden' "result-$n.log"
cp middleware-baseline.json ingress-fixture.json
jq '.items[0].spec.rules[0].http.paths[0].backend.service.name="radar-api"' middleware-baseline.json > ingress-fixture.json
if invoke start-api PROOFS="$testdir/activation-receipt.json"; then exit 1; fi
rg -qF 'Ingress lacks refusal backend' "result-$n.log"
cp middleware-baseline.json ingress-fixture.json
jq '.binding.releaseId="1234567:short"' waiver-input.json > input.json
: > cluster-calls
if invoke validate; then echo 'Waiver bypassed full release SHA' >&2; exit 1; fi
[[ ! -s cluster-calls ]]
cp waiver-original-input.json input.json
echo 'PASS preprod-only waiver receipts, rejection outside preprod, unchanged absence and retained guards'
