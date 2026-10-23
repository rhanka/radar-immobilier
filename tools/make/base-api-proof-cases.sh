#!/usr/bin/env bash
fail() { echo "ASSERTION FAILED: $*" >&2; exit 1; }
rejected() { if "$@"; then fail "accepted $*"; fi; }
guard_cases() {
  source "$TOOLS/base-api-guards.sh"
  case $CASE in
    environment)
      ENV=dev; rejected require_env
      rejected bash "$TOOLS/base-api-verify.sh" typecheck ENV=dev
      [[ ! -s $PROOF_DIR/commands ]] || fail 'container activity before ENV rejection';;
    archive)
      for path in api/src/.env.secret api/src/../../.env docs/spec/input/client.md \
        /etc/passwd api/src/credentials.json; do rejected allowed_path "$path"; done
      mkdir -p "$PROOF_DIR/tree/api/src"
      ln -s /never-open-forbidden "$PROOF_DIR/tree/api/src/link.ts"
      (cd "$PROOF_DIR/tree"; rejected allowed_path api/src/link.ts);;
    suite)
      SCOPE=; rejected require_scope
      rejected bash "$TOOLS/base-api-verify.sh" test-api SCOPE= ENV=test-proof
      [[ ! -s $PROOF_DIR/commands ]] || fail 'container activity before scope rejection'
      printf 'src/example.test.ts\t0\t0\t1\n' > "$PROOF_DIR/tests.tsv"
      SCOPE=src/example.test.ts; rejected assert_tests_ran "$PROOF_DIR/tests.tsv"
      : > "$PROOF_DIR/tests.tsv"; rejected assert_tests_ran "$PROOF_DIR/tests.tsv"
      printf 'src/example.test.ts\t1\t0\t0\n' > "$PROOF_DIR/tests.tsv"
      assert_tests_ran "$PROOF_DIR/tests.tsv";;
  esac
}
cleanup_cases() {
  source "$TOOLS/base-api-guards.sh"
  source "$TOOLS/base-api-resources.sh"
  ENV=test-proof; PROJECT=$PROOF_PROJECT; OWNER=$PROOF_OWNER
  compose=(docker compose --env-file /dev/null -p "$PROJECT" -f unused)
  touch "$PROOF_DIR/live"
  ENV=dev; rejected guarded_down
  ENV=test-proof; PROJECT=foreign; rejected guarded_down
  PROJECT=$PROOF_PROJECT
  export PROOF_CASE=foreign; rejected guarded_down
  export PROOF_CASE=shared; rejected guarded_down
  [[ $(grep -c ' down ' "$PROOF_DIR/commands" || true) == 0 ]] || fail 'foreign deletion attempted'
  # A crash retry must inspect ownership again before deleting.
  export PROOF_CASE=foreign; rejected guarded_down
  export PROOF_CASE=success; guarded_down
  [[ ! -f $PROOF_DIR/live ]] || fail 'retry left resources'
}
lifecycle_case() {
  export PROOF_CASE=$CASE
  local expected=0 code=0 path
  case $CASE in failure|failure-cleanup) expected=17;; INT|INT-cleanup) expected=130;; TERM|TERM-cleanup) expected=143;;
    cleanup-failure|residual|skipped) expected=1;; esac
  bash "$TOOLS/base-api-verify.sh" test-api \
    SCOPE=src/services/facets/scoped-db.test.ts ENV=test-proof > "$PROOF_DIR/output" 2>&1 || code=$?
  [[ $code == "$expected" ]] || fail "$CASE status $code expected $expected"
  path=$(sed -n 's/^Evidence: //p' "$PROOF_DIR/output")/status
  [[ -n $path && $(cat "$path") == "$expected" ]] || fail "$CASE status evidence"
  [[ -s ${path%/*}/compose.log && -s ${path%/*}/compose-state.log ]] || fail "$CASE logs absent"
  if [[ $CASE == *cleanup* || $CASE == residual ]]; then
    [[ -f $PROOF_DIR/live && -s ${path%/*}/residuals.log ]] || fail 'missing guarded retry'
    [[ ! -f ${path%/*}/result ]] || fail 'cleanup failure reported PASS'
    export PROOF_CASE=foreign
    rejected bash "$TOOLS/base-api-verify.sh" clean ENV=test-proof
    export PROOF_CASE=success
    bash "$TOOLS/base-api-verify.sh" clean ENV=test-proof
  fi
  [[ ! -f $PROOF_DIR/live ]] || fail "$CASE left resources"
  grep -q ' down -v --remove-orphans' "$PROOF_DIR/commands" || fail 'missing qualified down'
  if grep ' down ' "$PROOF_DIR/commands" | grep -v -- "-p $PROOF_PROJECT "; then fail 'unqualified project'; fi
  awk '/ logs /{seen=1} / down /{if (++downs>1 && !seen) exit 1}' "$PROOF_DIR/commands" || fail 'logs after cleanup'
}
