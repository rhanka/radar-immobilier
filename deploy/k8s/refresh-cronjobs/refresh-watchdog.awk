# refresh-watchdog.awk — the pending-pod watchdog of a refresh render.
#
# Input: one `kubectl kustomize` render of a refresh overlay (preprod or prod).
#
# The guard 34-refresh-pending-watchdog.yaml only protects the refresh pass if
# four things hold together, and each one can drift alone:
#   1. the watchdog CronJob is rendered, active, runs its script with its own
#      ServiceAccount and an API token;
#   2. its selector matches a label the refresh pod template really carries,
#      and its Job prefix is the refresh CronJob name followed by `-`;
#   3. the refresh Job has `backoffLimit: 0`: the deleted pending pod is the
#      Job's single failure, so the Job turns Failed instead of creating a
#      replacement pod that could stall the same way;
#   4. the pending deadline, plus one watchdog period, stays far below the
#      refresh Job deadline: the watchdog bounds the Pending phase only, never
#      a running pass.
# The values themselves are not pinned (except the wiring names): the deadline
# and the period may move, as long as these relations hold.

function fail(msg) { print "refresh-watchdog: " msg > "/dev/stderr"; bad = 1 }

function envValue(doc, name,   s) {
  if (!match(doc, "name: " name "\n[ ]+value: [^\n]*")) return ""
  s = substr(doc, RSTART, RLENGTH)
  sub(/^[^\n]*\n[ ]+value: /, "", s)
  gsub(/["']/, "", s)
  return s
}

BEGIN { RS = "\n---\n" }

/kind: CronJob\n/ && /\n  name: radar-refresh-pending-watchdog\n/ {
  dogs++
  if ($0 !~ /\n  suspend: false\n/)
    fail("radar-refresh-pending-watchdog is not active (spec.suspend must be false)")
  if ($0 !~ /- node\n[ ]+- dist\/scripts\/refresh-pending-watchdog\.js\n/)
    fail("the watchdog must run `node dist/scripts/refresh-pending-watchdog.js`")
  if ($0 !~ /\n[ ]+serviceAccountName: radar-refresh-watchdog\n/)
    fail("the watchdog must run as ServiceAccount radar-refresh-watchdog")
  if ($0 !~ /\n[ ]+automountServiceAccountToken: true\n/)
    fail("the watchdog needs automountServiceAccountToken: true (it calls the Kubernetes API)")
  deadline = envValue($0, "REFRESH_PENDING_DEADLINE_SECONDS")
  # Same floor as readWatchdogConfig (api/src/scripts/refresh-pending-watchdog.ts):
  # below 60 s the script refuses to start, so the render must refuse it too.
  if (deadline !~ /^[0-9]+$/ || deadline + 0 < 60)
    fail("REFRESH_PENDING_DEADLINE_SECONDS missing, not a number of seconds, or below 60 (the script refuses it)")
  if (envValue($0, "REFRESH_WATCHDOG_JOB_PREFIX") != "radar-refresh-pv-")
    fail("REFRESH_WATCHDOG_JOB_PREFIX must be radar-refresh-pv- (the refresh CronJob name + '-')")
  if (envValue($0, "REFRESH_WATCHDOG_POD_SELECTOR") != "app.kubernetes.io/instance=radar-refresh-pv")
    fail("REFRESH_WATCHDOG_POD_SELECTOR must be app.kubernetes.io/instance=radar-refresh-pv")
  period = 0
  if (match($0, /\n  schedule: [^\n]+/)) {
    s = substr($0, RSTART, RLENGTH); sub(/^\n  schedule: /, "", s); gsub(/["']/, "", s)
    n = split(s, f, / +/)
    if (n == 5 && f[1] ~ /^\*\/[0-9]+$/ && f[2] == "*" && f[3] == "*" && f[4] == "*" && f[5] == "*")
      period = substr(f[1], 3) * 60
  }
  if (period <= 0) fail("the watchdog schedule must be `*/<minutes> * * * *`")
}

/kind: CronJob\n/ && /\n  name: radar-refresh-pv\n/ {
  pv++
  # The label must sit on the POD template (spec.jobTemplate.spec.template.metadata.labels,
  # keys at 12 spaces in the rendered YAML): a label on the CronJob or on the Job
  # template metadata does not reach the pods the watchdog lists.
  if ($0 !~ /\n      template:\n        metadata:\n(          [^\n]*\n|            [^\n]*\n)*          labels:\n(            [^\n]+\n)*            app\.kubernetes\.io\/instance: radar-refresh-pv\n/)
    fail("the refresh pod template lacks the label app.kubernetes.io/instance: radar-refresh-pv that the watchdog selects")
  if ($0 !~ /\n      backoffLimit: 0\n/)
    fail("the refresh Job must keep backoffLimit: 0 (a deleted pending pod fails the Job instead of being replaced)")
  if (match($0, /\n      activeDeadlineSeconds: [0-9]+\n/)) {
    s = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", s); ads = s + 0
  }
}

END {
  if (dogs != 1) fail("expected exactly one radar-refresh-pending-watchdog CronJob in the render, found " dogs + 0)
  if (pv != 1) fail("expected exactly one radar-refresh-pv CronJob in the render, found " pv + 0)
  if (!bad && ads > 0 && deadline + period >= ads / 2)
    fail("pending deadline " deadline " s + period " period " s is not well below the refresh Job deadline " ads " s")
  if (!bad)
    printf "refresh-watchdog: ok — a refresh pod Pending %d s is deleted within %d s (watchdog every %d s); refresh Job deadline %d s\n", \
      deadline, deadline + period, period, ads
  exit bad
}
