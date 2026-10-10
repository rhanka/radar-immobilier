# bascule-window.awk — the daily prod -> preprod restore slot stays clear of the
# backup it restores and of every refresh start.
#
# Input: the preprod render, the prod render, then the daily backup manifest
# RENDERED by kubectl kustomize (canonical `---` separators, so a record is one
# object) — `awk -v restore="<cron>" -f bascule-window.awk preprod.yaml
# prod.yaml backup.yaml`, as refresh-018.mk verify-renders does. `restore` is the single active
# cron of .github/workflows/bascule-preprod.yml (extracted by bascule-crons.awk;
# GitHub schedules are UTC). Optional `-v backup_gap=<min>` (default 60) and
# `-v refresh_gap=<min>` (default 60).
#
# The scheduled bascule is MODE=restore from the latest complete backup with a
# 24 h freshness guard (deploy/ci/bascule-preprod/backup-restore.cjs). Checks:
#   1. the restore cron is `<minute> <hour> * * *`, daily, on the hour (owner
#      decision: every schedule on the hour);
#   2. radar-refresh-pv (both renders) and radar-backup-daily run in Etc/UTC
#      with `<minute> <hour list> * * *` schedules;
#   3. the restore starts at least `backup_gap` minutes after the backup start,
#      the same UTC day (backups observed 7-45 min), so the normal outcome is
#      the backup of the day;
#   4. the restore starts on no refresh start (prod or preprod; single node)
#      and at least `refresh_gap` minutes before the next one (restores
#      observed 18-50 min).
# Only CONFIGURED start times are compared: GitHub launch delay and actual run
# durations are not measured here.

function fail(msg) { print "bascule-window: " msg > "/dev/stderr"; bad = 1 }

function field(doc, re, prefix,   s) {
  if (!match(doc, re)) return ""
  s = substr(doc, RSTART, RLENGTH)
  sub(prefix, "", s)
  gsub(/["']/, "", s)
  sub(/[ \t]+#.*$/, "", s)
  sub(/[ \t]+$/, "", s)
  return s
}

# 1 if `s` is `<minute 0-59> <hour list 0-23> * * *`; fills f[] (split fields).
function daily(s, f,   n, h, k, i) {
  n = split(s, f, / +/)
  if (n != 5 || f[1] !~ /^[0-9]+$/ || f[1] + 0 > 59) return 0
  if (f[3] != "*" || f[4] != "*" || f[5] != "*") return 0
  if (f[2] !~ /^[0-9]+(,[0-9]+)*$/) return 0
  k = split(f[2], h, ",")
  for (i = 1; i <= k; i++) if (h[i] + 0 > 23) return 0
  return 1
}

BEGIN {
  RS = "\n---\n"
  if (backup_gap == "") backup_gap = 60
  if (refresh_gap == "") refresh_gap = 60
}

FNR == 1 { file++ }

file <= 2 && /kind: CronJob\n/ && /\n  name: radar-refresh-pv\n/ {
  nrefresh[file]++
  sched[file] = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ")
  tz[file] = field($0, "\n  timeZone: [^\n]+", "^\n  timeZone: ")
}

file == 3 && /kind: CronJob\n/ && /\n  name: radar-backup-daily\n/ {
  nbackup++
  bsched = field($0, "\n  schedule: [^\n]+", "^\n  schedule: ")
  btz = field($0, "\n  timeZone: [^\n]+", "^\n  timeZone: ")
}

END {
  if (file != 3) { fail("expected three inputs (preprod render, prod render, backup manifest), got " file + 0); exit 1 }
  if (nrefresh[1] != 1 || nrefresh[2] != 1) { fail("expected one radar-refresh-pv CronJob per render (preprod " nrefresh[1] + 0 ", prod " nrefresh[2] + 0 ")"); exit 1 }
  if (nbackup != 1) { fail("expected one radar-backup-daily CronJob in the backup manifest, got " nbackup + 0); exit 1 }
  if (!daily(restore, r) || index(r[2], ",")) {
    fail("the bascule-preprod restore cron must be `<minute> <hour> * * *` (daily, one hour), got « " restore " »"); exit 1
  }
  if (r[1] + 0 != 0) fail("the bascule-preprod restore must start on the hour (minute 0), got « " restore " »")
  for (i = 1; i <= 2; i++) {
    if (tz[i] != "Etc/UTC") fail("radar-refresh-pv must run in Etc/UTC (" (i == 1 ? "preprod" : "prod") " render: « " tz[i] " »)")
    if (!daily(sched[i], s)) { fail("radar-refresh-pv schedule unreadable (" (i == 1 ? "preprod" : "prod") " render: « " sched[i] " »)"); exit 1 }
  }
  if (btz != "Etc/UTC") fail("radar-backup-daily must run in Etc/UTC, got « " btz " »")
  if (!daily(bsched, b) || index(b[2], ",")) { fail("radar-backup-daily schedule must be `<minute> <hour> * * *`, got « " bsched " »"); exit 1 }

  rMin = r[2] * 60 + r[1]
  bMin = b[2] * 60 + b[1]
  if (rMin - bMin < backup_gap)
    fail("the restore (" restore ") starts " rMin - bMin " min after the backup start (" bsched "), below " backup_gap \
         " min the same UTC day: `latest` would normally be the previous backup, refused by the 24 h guard")

  next_gap = 1440; same = ""
  for (i = 1; i <= 2; i++) {
    daily(sched[i], s); k = split(s[2], h, ",")
    for (j = 1; j <= k; j++) {
      st = h[j] * 60 + s[1]
      if (st == rMin) same = same " " (i == 1 ? "preprod" : "prod") "@" h[j] ":" sprintf("%02d", s[1])
      d = (st - rMin + 1440) % 1440
      if (d > 0 && d < next_gap) next_gap = d
    }
  }
  if (same != "") fail("the restore (" restore ") starts together with a refresh:" same " (single node)")
  if (next_gap < refresh_gap)
    fail("the next refresh starts " next_gap " min after the restore (" restore "), below " refresh_gap " min (restores observed 18-50 min)")
  if (!bad)
    printf "bascule-window: ok — restore \"%s\" UTC: %d min after the backup start \"%s\", next refresh start %d min later\n", \
      restore, rMin - bMin, bsched, next_gap
  exit bad
}
