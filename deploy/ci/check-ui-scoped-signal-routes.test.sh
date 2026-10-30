#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
ok() { echo "ok: $1"; }
run() { bash "$HERE/check-ui-scoped-signal-routes.sh" "$T/src" >"$T/out" 2>&1; }
mkdir -p "$T/src/lib"
printf 'const url = `/api/v1/workspaces/${ws}/signal-facets/coherent-city`;\n' > "$T/src/lib/client.ts"
run && grep -qx 'scoped signal routes guard: ok' "$T/out" && ok 'accepts scoped routes'
printf 'fetch("/api/graph-signals/by-city");\n' > "$T/src/lib/legacy.ts"
if run; then echo 'FAIL: accepted a legacy aggregate read' >&2; exit 1; fi
grep -Fq 'legacy.ts' "$T/out" && ok 'rejects /api/graph-signals/'
rm "$T/src/lib/legacy.ts"
printf '<script>fetch("/api/v1/signal-facets/select")</script>\n' > "$T/src/lib/View.svelte"
if run; then echo 'FAIL: accepted an unscoped facet command' >&2; exit 1; fi
grep -Fq 'View.svelte' "$T/out" && ok 'rejects unscoped /api/v1/signal-facets/ in Svelte'
rm "$T/src/lib/View.svelte"
printf 'expect(url).not.toContain("/api/graph-signals/");\n' > "$T/src/lib/client.test.ts"
run && ok 'exempts unit tests asserting the refusal'
bash "$HERE/check-ui-scoped-signal-routes.sh" && ok 'current ui/src is clean'
