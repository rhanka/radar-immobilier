Merge-prep PR #1061: origin/main merged into fix/containers-run-as-host-user (merge commit 65d6c78b, no rebase, no force-push); not merged.
Conflicting files: LANE-REPORT.md only (add/add, two lane reports reused the same path).
Resolution: both reports kept (PR #1061 report first, main feat/ui-reload-icons report appended); host UID/GID user: on all bind-mount writers preserved, no main-added compose/Dockerfile/Makefile writer escapes the rule (obscura 1001:1001 named-volume unchanged).
Local (Make-only, ENV last): make install/lint/typecheck ENV=test-merge1061 PASS, compose config renders user 1000:1000; teardown make clean ENV=test-merge1061 (down -v) done.
CI: see final line after push — updated below.
