#!/usr/bin/env bash
set -euo pipefail
if [[ ${1:-} == scope ]]; then
  cat <<'SCOPES'
tests/integration/base-api-lot-authority.spec.ts
tests/integration/base-api-lot-replay-guards.spec.ts
tests/integration/base-api-lot-closed-replays.spec.ts
tests/integration/base-api-lot-concurrency.spec.ts
tests/integration/base-api-lot-batches.spec.ts
tests/integration/base-api-cutover-readback.spec.ts
tests/integration/base-api-cutover-acceptance.spec.ts
tests/integration/base-api-legacy.spec.ts
tests/integration/base-api-independence.spec.ts
SCOPES
  exit
fi
exec node ../tools/make/base-api-b4-mutation.mjs "$1" b5
