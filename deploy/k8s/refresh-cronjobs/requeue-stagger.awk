# requeue-stagger.awk — the daily requeue never starts with a refresh pass.
#
# Input: preprod refresh render, prod refresh render, preprod requeue
# render, prod requeue render (`awk -v min_minutes=15 -f
# requeue-stagger.awk preprod.yaml prod.yaml preprod-requeue.yaml
# prod-requeue.yaml`).
#
# Incident 2026-10-09: prod and preprod refresh pods started the same
# minute on the same node and both asked for their RWO keyring volume;
# both stayed Pending 4 h 30. The requeue CronJob mounts the same keyring
# PVC (for the shared flock), so its starts obey the same rule: every
# requeue start must be at least `min_minutes` from every refresh start
# (both environments) and from the other environment's requeue start.
# Nothing is pinned: any daily slots keeping these gaps pass.

function fail(msg) { print "requeue-stagger: " msg > "/dev/stderr"; bad = 1 }

function field(doc, re, prefix,   s) {
  if (!match(doc, re)) return ""
  s = substr(doc, RSTART, RLENGTH)
  sub(prefix, "", s)
  gsub(/["']/, "", s)
  return s
}

BEGIN { RS = "\n---\n"; if (min_minutes == "") min_minutes = 15 }

FNR == 1 { file++ }

/kind: CronJob\n/ && /\n  name: radar-refresh-pv\n/ { pv[file] = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ") }
/kind: CronJob\n/ && /\n  name: radar-refresh-requeue-abandoned\n/ { rq[file - 2] = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ") }

function starts(s, out,   f, h, k, i, n) {
  n = split(s, f, / +/)
  if (n != 5 || f[1] !~ /^[0-9]+$/ || f[3] != "*" || f[4] != "*" || f[5] != "*") return 0
  k = split(f[2], h, ",")
  for (i = 1; i <= k; i++) out[i] = h[i] * 60 + f[1]
  return k
}

function gap(a, na, b, nb,   i, j, d, g) {
  g = 1440
  for (i = 1; i <= na; i++) for (j = 1; j <= nb; j++) {
    d = a[i] - b[j]; if (d < 0) d = -d
    if (1440 - d < d) d = 1440 - d
    if (d < g) g = d
  }
  return g
}

END {
  if (file != 4) { fail("expected four renders (refresh preprod/prod, requeue preprod/prod), got " file + 0); exit 1 }
  np1 = starts(pv[1], p1); np2 = starts(pv[2], p2)
  nr1 = starts(rq[1], r1); nr2 = starts(rq[2], r2)
  if (!np1 || !np2 || !nr1 || !nr2) {
    fail("schedules must use `<minute> <hour list> * * *` (preprod pv « " pv[1] " », prod pv « " pv[2] " », preprod requeue « " rq[1] " », prod requeue « " rq[2] " »)")
    exit 1
  }
  g = gap(r1, nr1, r2, nr2)
  if (g < min_minutes) fail("the two requeue starts are " g " min apart, below " min_minutes " min (incident 2026-10-09)")
  g = gap(r1, nr1, p1, np1); if (g < min_minutes) fail("preprod requeue is " g " min from a preprod refresh start, below " min_minutes " min")
  g = gap(r1, nr1, p2, np2); if (g < min_minutes) fail("preprod requeue is " g " min from a prod refresh start, below " min_minutes " min")
  g = gap(r2, nr2, p1, np1); if (g < min_minutes) fail("prod requeue is " g " min from a preprod refresh start, below " min_minutes " min")
  g = gap(r2, nr2, p2, np2); if (g < min_minutes) fail("prod requeue is " g " min from a prod refresh start, below " min_minutes " min")
  if (!bad) printf "requeue-stagger: ok — preprod requeue \"%s\", prod requeue \"%s\": every requeue start >= %d min from every refresh and requeue start\n", rq[1], rq[2], min_minutes
  exit bad
}
