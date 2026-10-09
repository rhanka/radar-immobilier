# refresh-stagger.awk — prod and preprod refresh passes never start together.
#
# Input: the preprod render, then the prod render (`awk -f refresh-stagger.awk
# preprod.yaml prod.yaml`). Optional `-v min_minutes=<n>` (default 15).
#
# Incident 2026-10-09: both `radar-refresh-pv` CronJobs ran `17 5,11,17,23 * * *`
# on the same node. Both pods asked for their RWO keyring volume in the same
# minute; the CSI attach timed out, then reported "already attached" and never
# reconciled. Both passes stayed Pending for 4 h 30.
#
# The overlays now share the HOURS (refresh-contract.awk projects them) and
# differ only by the start MINUTE (intended divergence n°4). This guard checks:
#   1. both schedules use the form `<minute> <hour list> * * *`, with the same
#      hour list and day fields;
#   2. the closest pair of real daily starts (prod vs preprod, wrapping at
#      midnight) is at least `min_minutes` apart;
#   3. the pending-pod watchdog of the preprod render removes a stalled pod
#      (deadline + one period) before the other environment starts.
# Nothing is pinned: any pair of minutes that keeps these relations passes.

function fail(msg) { print "refresh-stagger: " msg > "/dev/stderr"; bad = 1 }

function field(doc, re, prefix,   s) {
  if (!match(doc, re)) return ""
  s = substr(doc, RSTART, RLENGTH)
  sub(prefix, "", s)
  gsub(/["']/, "", s)
  return s
}

BEGIN { RS = "\n---\n"; if (min_minutes == "") min_minutes = 15 }

FNR == 1 { file++ }

/kind: CronJob\n/ && /\n  name: radar-refresh-pv\n/ {
  sched[file] = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ")
}

file == 1 && /kind: CronJob\n/ && /\n  name: radar-refresh-pending-watchdog\n/ {
  deadline = field($0, "name: REFRESH_PENDING_DEADLINE_SECONDS\n[ ]+value: [^\n]+", "^[^\n]*\n[ ]+value: ") + 0
  every = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ")
  if (every ~ /^\*\/[0-9]+ /) { split(every, w, / +/); period = substr(w[1], 3) * 60 }
}

function validSchedule(s, f,   n, h, k, i) {
  n = split(s, f, / +/)
  if (n != 5 || f[1] !~ /^[0-9]+$/ || f[1] + 0 > 59) return 0
  if (f[3] != "*" || f[4] != "*" || f[5] != "*") return 0
  if (f[2] !~ /^[0-9]+(,[0-9]+)*$/) return 0
  k = split(f[2], h, ",")
  for (i = 1; i <= k; i++) if (h[i] + 0 > 23) return 0
  return 1
}

END {
  if (file != 2) { fail("expected two renders (preprod, prod), got " file + 0); exit 1 }
  if (!validSchedule(sched[1], a) || !validSchedule(sched[2], b)) {
    fail("radar-refresh-pv schedules must use `<minute 0-59> <hour list 0-23> * * *` (preprod « " sched[1] " », prod « " sched[2] " »)")
    exit 1
  }
  if (a[2] != b[2])
    fail("preprod « " sched[1] " » and prod « " sched[2] " » must share the same hours")
  # Closest pair of REAL daily starts, across environments, around midnight
  # (1440 min): only the hours actually scheduled count.
  k = split(b[2], hours, ",")
  gap = 1440
  for (i = 1; i <= k; i++)
    for (j = 1; j <= k; j++) {
      d = (hours[i] * 60 + b[1]) - (hours[j] * 60 + a[1]); if (d < 0) d = -d
      if (1440 - d < d) d = 1440 - d
      if (d < gap) gap = d
    }
  if (gap < min_minutes)
    fail("the closest prod and preprod starts are " gap " min apart, below " min_minutes \
         " min: both keyring volumes would be attached together again (incident 2026-10-09)")
  if (deadline <= 0 || period <= 0)
    fail("pending watchdog deadline/period not found in the preprod render")
  else if (deadline + period > gap * 60)
    fail("the pending watchdog removes a stalled pod after up to " deadline + period " s, not before the other environment starts (" gap * 60 " s later)")
  if (!bad)
    printf "refresh-stagger: ok — prod minute %d, preprod minute %d, hours %s: closest starts %d min apart; a stalled pod is removed within %d s\n", \
      b[1], a[1], b[2], gap, deadline + period
  exit bad
}
