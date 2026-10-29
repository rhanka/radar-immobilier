#!/bin/sh
finish() {
  result=$?
  if [ "$result" -eq 0 ]; then printf '%s' '{"ok":true}'; else printf '%s' '{"ok":false}'; fi > /dev/termination-log
}
trap finish EXIT
printf '%s' '{"ok":false}' > /dev/termination-log
"$@" >/dev/null 2>&1
