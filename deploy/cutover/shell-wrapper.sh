#!/bin/sh
finish() {
  result=$?
  metrics=''
  # Measurements are integers under bounded keys only (written by atomic-restore.sh).
  if [ -f /tmp/cutover-metrics ]; then
    metrics=$(sed -n 's/^\([A-Za-z0-9_]\{1,32\}\)=\([0-9]\{1,15\}\)$/,"\1":\2/p' /tmp/cutover-metrics | head -24 | tr -d '\n')
  fi
  if [ "$result" -eq 0 ]; then printf '{"ok":true%s}' "$metrics"; else printf '%s' '{"ok":false}'; fi > /dev/termination-log
}
trap finish EXIT
printf '%s' '{"ok":false}' > /dev/termination-log
"$@" >/dev/null 2>&1
