# refresh-retention.awk — failed-pod readability floor for CronJobs.
#
# Input: one or more rendered/source YAML streams holding CronJob docs.
# For every CronJob: ttlSecondsAfterFinished >= 21600 (6 h floor); a
# backoffLimit: 0 Job must carry podFailurePolicy FailJob on
# onExitCodes NotIn [0] (no replacement pod, failed pod stays readable).
# The watchdog runs every N minutes: its failedJobsHistoryLimit * period
# must also span 21600 s, otherwise the CronJob controller prunes the
# failed Jobs (and their pods/logs) long before the TTL.

function fail(msg) { print "refresh-retention: " msg > "/dev/stderr"; bad = 1 }
function field(doc, re,   s) { if (!match(doc, re)) return ""; s = substr(doc, RSTART, RLENGTH); gsub(/[^0-9]/, "", s); return s }

BEGIN { RS = "\n---\n" }

/kind: CronJob/ {
  seen++
  name = "?"
  if (match($0, /\n  name: [^\n]+/)) { name = substr($0, RSTART, RLENGTH); sub(/^\n  name: /, "", name); gsub(/["']/, "", name) }
  ttl = field($0, /ttlSecondsAfterFinished: [0-9]+/)
  if (ttl == "" || ttl + 0 < 21600)
    fail(name ": ttlSecondsAfterFinished " (ttl == "" ? "missing" : ttl) " is below the 21600 s (6 h) floor")
  backoff = field($0, /backoffLimit: [0-9]+/)
  if (backoff != "" && backoff + 0 == 0) {
    if ($0 !~ /podFailurePolicy:/ || $0 !~ /action: FailJob/ || $0 !~ /onExitCodes:/ || $0 !~ /operator: NotIn/ || $0 !~ /values: \[0\]/)
      fail(name ": backoffLimit: 0 without podFailurePolicy FailJob on onExitCodes NotIn [0]")
  }
  if (name == "radar-refresh-pending-watchdog") {
    period = 0
    if (match($0, /\n  schedule: [^\n]+/)) {
      s = substr($0, RSTART, RLENGTH); sub(/^\n  schedule: /, "", s); gsub(/["']/, "", s)
      n = split(s, f, / +/)
      if (n == 5 && f[1] ~ /^\*\/[0-9]+$/) period = substr(f[1], 3) * 60
    }
    failed = field($0, /failedJobsHistoryLimit: [0-9]+/)
    if (period <= 0) fail(name ": schedule must be `*/<minutes> * * * *`")
    else if (failed == "" || failed * period < 21600)
      fail(name ": failedJobsHistoryLimit " (failed == "" ? "missing" : failed) " x period " period " s is below the 21600 s (6 h) floor")
  }
}

END {
  if (seen == 0) fail("no CronJob found")
  if (!bad) printf "refresh-retention: ok — %d CronJob(s) at or above the 21600 s floor\n", seen
  exit bad
}
