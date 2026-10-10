# bascule-crons.awk — print every ACTIVE `on.schedule` cron of a GitHub workflow,
# one per line, quotes stripped (single, double or none).
#
# Usage: awk -f bascule-crons.awk .github/workflows/bascule-preprod.yml
#
# Comment and blank lines are ignored. Any other line inside `on.schedule` that
# is not a `- cron: <value>` entry is reported (exit 1): a schedule this parser
# cannot read must fail, never be silently skipped.

function fail(msg) { print "bascule-crons: " msg > "/dev/stderr"; bad = 1 }

/^[^ #][^:]*:/ { inon = ($0 ~ /^"?on"?:[ \t]*(#.*)?$/); insched = 0; next }
!inon { next }
/^[ \t]*(#.*)?$/ { next }
/^  [A-Za-z_"-]/ { insched = ($0 ~ /^  schedule:[ \t]*(#.*)?$/); next }
!insched { next }
{
  line = $0
  if (line !~ /^[ \t]+-[ \t]*cron:[ \t]*/) { fail("unreadable on.schedule line: " line); next }
  sub(/^[ \t]+-[ \t]*cron:[ \t]*/, "", line)
  if (line ~ /^'/) { sub(/^'/, "", line); sub(/'.*$/, "", line) }
  else if (line ~ /^"/) { sub(/^"/, "", line); sub(/".*$/, "", line) }
  else { sub(/[ \t]+#.*$/, "", line); sub(/[ \t]+$/, "", line) }
  print line
}

END { exit bad }
