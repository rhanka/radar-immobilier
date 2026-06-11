#!/usr/bin/env bash
# Authoritative pre-merge gate — BLOCKING.
#
# Reversible workaround for GitHub branch protection, which is unavailable on
# this private free-plan repo (API returns 403 "Upgrade to Pro or make public").
# Because GitHub cannot enforce a required check server-side here, this script
# IS the authority: run it before every `gh pr merge` (use scripts/merge.sh,
# which chains gate → merge), and merge ONLY on exit 0.
#
#   usage: bash scripts/gate.sh <pr-number>
#   exit 0 = PASS (merge authorized) · exit 1 = BLOCK (do NOT merge)
#
# Advisories are treated as BLOCKING (per the authoritative-gate decision).
set -uo pipefail
PR="${1:?usage: gate.sh <pr-number>}"
REPO="${GATE_REPO:-rhanka/radar-immobilier}"
fail=0
B() { echo "  ✗ BLOCK: $1"; fail=1; }
P() { echo "  ✓ $1"; }
echo "[gate] PR #$PR ($REPO) — authoritative pre-merge gate"

json=$(gh pr view "$PR" --repo "$REPO" --json statusCheckRollup,mergeable 2>/dev/null)
if [ -z "$json" ]; then B "cannot read PR #$PR"; echo "[gate] FAIL"; exit 1; fi

# 1. CI is authority — Quality gates + Enforce repo policy must be SUCCESS.
for check in "Quality gates" "Enforce repo policy"; do
  c=$(echo "$json" | python3 -c "import sys,json;r=json.load(sys.stdin).get('statusCheckRollup') or [];print(next((x.get('conclusion') for x in r if x.get('name')=='$check'),'MISSING'))")
  [ "$c" = "SUCCESS" ] && P "CI '$check' SUCCESS" || B "CI '$check' != SUCCESS ($c)"
done

# 2. No conflicts.
mrg=$(echo "$json" | python3 -c "import sys,json;print(json.load(sys.stdin).get('mergeable'))")
[ "$mrg" = "MERGEABLE" ] && P "mergeable (no conflict)" || B "not MERGEABLE ($mrg)"

# 3. Loi 25 + secret scan on ADDED lines (anti-PII / anti-leak).
#    Excludes fixtures/docs/test (public municipal phone numbers, sample amounts
#    in French format like "250 000 000" are NOT PII) and honors an inline
#    `gate:allow-pii` pragma for vetted exceptions. Fail-closed otherwise.
pii=$(gh pr diff "$PR" --repo "$REPO" 2>/dev/null | python3 - <<'PY'
import sys, re
EXCL = re.compile(r'(^|/)(fixtures?|docs|__fixtures__)/|\.fixture\.|\.spec\.|\.test\.')
PII = re.compile(r'\b[0-9]{3}[ -][0-9]{3}[ -][0-9]{3}\b|\b\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}\b|-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY|AKIA[0-9A-Z]{16}|SCW[A-Z0-9]{17,}')
cur, skip, hits = "", False, []
for line in sys.stdin:
    if line.startswith('+++ '):
        cur = line[5:].strip(); cur = cur[2:] if cur.startswith('b/') else cur
        skip = bool(EXCL.search(cur)); continue
    if line.startswith('+') and not line.startswith('+++') and not skip:
        if 'gate:allow-pii' in line: continue
        if PII.search(line): hits.append(f"{cur}: {line[1:].strip()[:80]}")
print('\n'.join(hits[:5]))
PY
)
[ -z "$pii" ] && P "no obvious PII/secret in added lines" || { B "possible PII/secret in diff (review!):"; printf '%s\n' "$pii" | sed 's/^/      /'; }

if [ "$fail" -eq 0 ]; then
  echo "[gate] PASS — merge authorized for PR #$PR"
else
  echo "[gate] FAIL — merge BLOCKED for PR #$PR"
fi
exit "$fail"
