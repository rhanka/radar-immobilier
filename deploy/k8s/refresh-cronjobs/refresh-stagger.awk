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
#   2. the two minutes are at least `min_minutes` apart, measured around the
#      hour (minute 50 is 10 minutes before minute 0 of the next hour);
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

END {
  if (file != 2) { fail("expected two renders (preprod, prod), got " file + 0); exit 1 }
  na = split(sched[1], a, / +/); nb = split(sched[2], b, / +/)
  if (na != 5 || nb != 5 || a[1] !~ /^[0-9]+$/ || b[1] !~ /^[0-9]+$/) {
    fail("radar-refresh-pv schedules must use `<minute> <hour list> * * *` (preprod « " sched[1] " », prod « " sched[2] " »)")
    exit 1
  }
  if (a[2] != b[2] || a[3] != b[3] || a[4] != b[4] || a[5] != b[5])
    fail("preprod « " sched[1] " » and prod « " sched[2] " » must share the same hours and day fields")
  gap = a[1] - b[1]; if (gap < 0) gap = -gap; if (60 - gap < gap) gap = 60 - gap
  if (gap < min_minutes)
    fail("preprod minute " a[1] " and prod minute " b[1] " are " gap " min apart, below " min_minutes \
         " min: both keyring volumes would be attached together again (incident 2026-10-09)")
  if (deadline <= 0 || period <= 0)
    fail("pending watchdog deadline/period not found in the preprod render")
  else if (deadline + period > gap * 60)
    fail("the pending watchdog removes a stalled pod after up to " deadline + period " s, not before the other environment starts (" gap * 60 " s later)")
  if (!bad)
    printf "refresh-stagger: ok — prod minute %d, preprod minute %d (%d min apart, hours %s); a stalled pod is removed within %d s\n", \
      b[1], a[1], gap, b[2], deadline + period
  exit bad
}
