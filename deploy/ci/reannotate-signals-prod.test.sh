#!/usr/bin/env bash
# Hermetic tests for deploy/ci/reannotate-signals-prod.sh and its workflow/template.
# Uses a fake kubectl stub; never touches any cluster or ~/.kube/config.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$SCRIPT_DIR/reannotate-signals-prod.sh"
TMPL="$SCRIPT_DIR/reannotate-signals-prod.tmpl.yaml"
WF="$ROOT/.github/workflows/reannotate-signals-prod.yml"

PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

make_fake_kubectl() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/kubectl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="${FAKE_KUBECTL_STATE:?}"
if [[ "$*" == *"config view"* ]]; then
  echo "${FAKE_SERVER:-https://hlhedx.c1.bhs5.k8s.ovh.net:6443}"
  exit 0
fi
if [[ "$*" == *"auth can-i create jobs.batch"* ]]; then
  echo "${FAKE_CAN_CREATE:-yes}"
  exit 0
fi
if [[ "$*" == *"get cronjob radar-refresh-pv"* ]]; then
  echo "cronjob.batch/radar-refresh-pv"
  exit 0
fi
if [[ "$*" == *"create job "* && "$*" == *"--from=cronjob/radar-refresh-pv"* ]]; then
  cat "$STATE_DIR/base-job.json"
  exit 0
fi
if [[ "$*" == *"create -f "* ]]; then
  for arg in "$@"; do last="$arg"; done
  cp "$last" "$STATE_DIR/created-job.json"
  echo "job.batch/radar-reannotate-prod-test created"
  exit 0
fi
if [[ "$*" == *"get job "* ]]; then
  cat "$STATE_DIR/job-status.json"
  exit 0
fi
if [[ "$*" == *"logs job/"* ]]; then
  cat "$STATE_DIR/job.log"
  exit 0
fi
echo "unexpected kubectl call: $*" >&2
exit 99
EOF
  chmod +x "$dir/kubectl"
}

write_base_job() {
  local out="$1" mode="${2:-two-step}" fb_provider="${3:-muse}" fb_model="${4:-muse-wonder-1.0}" classify_model="${5:-gpt-6.2-astra}"
  cat > "$out" <<EOF
{
  "apiVersion": "batch/v1",
  "kind": "Job",
  "metadata": { "name": "radar-reannotate-prod-test", "namespace": "radar-immobilier" },
  "spec": {
    "backoffLimit": 0,
    "template": {
      "metadata": { "labels": { "app.kubernetes.io/instance": "radar-refresh-pv" } },
      "spec": {
        "restartPolicy": "Never",
        "containers": [
          {
            "name": "refresh-pv",
            "image": "ghcr.io/rhanka/radar-api@sha256:0000000000000000000000000000000000000000000000000000000000000000",
            "command": ["/usr/bin/flock", "-n", "/keyring/runtime/.refresh.lock", "node", "dist/scripts/refresh-pv.js", "--all"],
            "env": [
              { "name": "REFRESH_SINGLE_PASS", "value": "0" },
              { "name": "REFRESH_CLASSIFY_MODE", "value": "${mode}" },
              { "name": "REFRESH_CLASSIFY_PROVIDER", "value": "openai" },
              { "name": "REFRESH_CLASSIFY_MODEL", "value": "${classify_model}" },
              { "name": "REFRESH_CLASSIFY_REASONING_EFFORT", "value": "low" },
              { "name": "REFRESH_CLASSIFY_FALLBACK_PROVIDER", "value": "${fb_provider}" },
              { "name": "REFRESH_CLASSIFY_FALLBACK_MODEL", "value": "${fb_model}" },
              { "name": "REFRESH_CLASSIFY_FALLBACK_REASONING_EFFORT", "value": "low" }
            ]
          }
        ]
      }
    }
  }
}
EOF
}

make_fake_kubectl "$TMP/bin"

# 1. Dry-run happy path: derives Job from radar-refresh-pv, injects REANNOTATION_SINCE_DAYS=30
# and PIPELINE_RUN_ID, prints per-city summary and traceability fields.
S1="$TMP/s1"; mkdir -p "$S1"
write_base_job "$S1/base-job.json"
echo '{"status":{"conditions":[{"type":"Complete","status":"True"}]}}' > "$S1/job-status.json"
cat > "$S1/job.log" <<'EOF'
{"kind":"signal-reannotation","mode":"dry-run","pipelineRunId":"prod-reannotate-30d-run1","promptId":"v2","promptSha256":"34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50","sinceDays":30,"since":"2026-10-20T00:00:00.000Z","candidates":5,"candidatesByCity":{"brossard":2,"salaberry-de-valleyfield":3},"processed":5,"classified":4,"written":0,"skippedManual":1,"skippedUnchanged":0,"refused":1,"failed":0,"classes":{"pertinent":2,"a_surveiller":1,"ecarte":1},"failures":[]}
EOF

if FAKE_KUBECTL_STATE="$S1" KUBECTL="$TMP/bin/kubectl" GITHUB_STEP_SUMMARY="$S1/summary.md" \
    PIPELINE_RUN_ID="prod-reannotate-30d-run1" REANNOTATION_MODE="dry-run" REANNOTATION_SINCE_DAYS="30" \
    REANNOTATION_POLL_SECONDS="0" bash "$SCRIPT" >"$S1/out.txt" 2>&1 \
  && jq -e '
      .spec.ttlSecondsAfterFinished == 86400
      and .spec.template.metadata.labels["app.kubernetes.io/instance"] == "radar-reannotate-signals"
      and (.spec.template.spec.containers[0].command == ["/usr/bin/flock","-n","/keyring/runtime/.refresh.lock","node","dist/scripts/reannotate-signals.js","--dry-run"])
      and ((.spec.template.spec.containers[0].env | map(select(.name == "REANNOTATION_SINCE_DAYS")) | .[0].value) == "30")
      and ((.spec.template.spec.containers[0].env | map(select(.name == "PIPELINE_RUN_ID")) | .[0].value) == "prod-reannotate-30d-run1")
    ' "$S1/created-job.json" >/dev/null \
  && grep -Fq 'prod-reannotate-30d-run1' "$S1/summary.md" \
  && grep -Fq '34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50' "$S1/summary.md" \
  && grep -Fq '| `brossard` | 2 |' "$S1/summary.md" \
  && grep -Fq '| `salaberry-de-valleyfield` | 3 |' "$S1/summary.md" \
  && grep -Fq '| Refusés (priorité humaine) | 1 |' "$S1/summary.md"; then
  ok "dry-run derives Job from radar-refresh-pv and renders per-city + traceability summary"
else
  bad "dry-run happy path ($(cat "$S1/out.txt"))"
fi

# 2. Apply mode passes --apply.
S2="$TMP/s2"; mkdir -p "$S2"
write_base_job "$S2/base-job.json"
echo '{"status":{"conditions":[{"type":"Complete","status":"True"}]}}' > "$S2/job-status.json"
cat > "$S2/job.log" <<'EOF'
{"kind":"signal-reannotation","mode":"apply","pipelineRunId":"prod-reannotate-30d-run2","promptId":"v2","promptSha256":"34df2dd7da379699ed8cefcc1dac07010f5618519fbdd7eb9c33d3d77e0ddc50","sinceDays":30,"since":"2026-10-20T00:00:00.000Z","candidates":2,"candidatesByCity":{"longueuil":2},"processed":2,"classified":2,"written":2,"skippedManual":0,"skippedUnchanged":0,"refused":0,"failed":0,"classes":{"pertinent":1,"a_surveiller":1,"ecarte":0},"failures":[]}
EOF
if FAKE_KUBECTL_STATE="$S2" KUBECTL="$TMP/bin/kubectl" GITHUB_STEP_SUMMARY="$S2/summary.md" \
    PIPELINE_RUN_ID="prod-reannotate-30d-run2" REANNOTATION_MODE="apply" REANNOTATION_SINCE_DAYS="30" \
    REANNOTATION_POLL_SECONDS="0" bash "$SCRIPT" >"$S2/out.txt" 2>&1 \
  && jq -e '.spec.template.spec.containers[0].command[-1] == "--apply"' "$S2/created-job.json" >/dev/null; then
  ok "apply mode passes --apply and succeeds cleanly"
else
  bad "apply mode ($(cat "$S2/out.txt"))"
fi

# 3. Refuses CronJob with REFRESH_CLASSIFY_MODE=off before creating any Job.
S3="$TMP/s3"; mkdir -p "$S3"
write_base_job "$S3/base-job.json" "off" "muse" "muse-wonder-1.0"
if FAKE_KUBECTL_STATE="$S3" KUBECTL="$TMP/bin/kubectl" REANNOTATION_MODE="dry-run" bash "$SCRIPT" >"$S3/out.txt" 2>&1; then
  bad "off classify mode on CronJob was accepted"
elif [[ ! -f "$S3/created-job.json" ]] && grep -Fq "CronJob contract mismatch" "$S3/out.txt"; then
  ok "refuses CronJob with REFRESH_CLASSIFY_MODE=off before creating Job"
else
  bad "off mode refusal ($(cat "$S3/out.txt"))"
fi

# 4. Refuses CronJob with gemini fallback or stale gpt-6-astra before creating any Job.
S4="$TMP/s4"; mkdir -p "$S4"
write_base_job "$S4/base-job.json" "two-step" "gemini" "gemini-3.8-flash"
if FAKE_KUBECTL_STATE="$S4" KUBECTL="$TMP/bin/kubectl" REANNOTATION_MODE="dry-run" bash "$SCRIPT" >"$S4/out.txt" 2>&1; then
  bad "gemini fallback on CronJob was accepted"
elif [[ ! -f "$S4/created-job.json" ]] && grep -Fq "CronJob contract mismatch" "$S4/out.txt"; then
  ok "refuses CronJob with gemini fallback before creating Job"
else
  bad "gemini fallback refusal ($(cat "$S4/out.txt"))"
fi

S4b="$TMP/s4b"; mkdir -p "$S4b"
write_base_job "$S4b/base-job.json" "two-step" "muse" "muse-wonder-1.0" "gpt-6-astra"
if FAKE_KUBECTL_STATE="$S4b" KUBECTL="$TMP/bin/kubectl" REANNOTATION_MODE="dry-run" bash "$SCRIPT" >"$S4b/out.txt" 2>&1; then
  bad "stale gpt-6-astra on CronJob was accepted"
elif [[ ! -f "$S4b/created-job.json" ]] && grep -Fq "CronJob contract mismatch" "$S4b/out.txt"; then
  ok "refuses CronJob with stale gpt-6-astra before creating Job"
else
  bad "stale gpt-6-astra refusal ($(cat "$S4b/out.txt"))"
fi

# 5. Refuses wrong apiserver host before creating any Job.
S5="$TMP/s5"; mkdir -p "$S5"
write_base_job "$S5/base-job.json"
if FAKE_KUBECTL_STATE="$S5" FAKE_SERVER="https://wrong.example:6443" KUBECTL="$TMP/bin/kubectl" bash "$SCRIPT" >"$S5/out.txt" 2>&1; then
  bad "wrong apiserver host accepted"
elif [[ ! -f "$S5/created-job.json" ]] && grep -Fq "Wrong cluster" "$S5/out.txt"; then
  ok "wrong apiserver host fails pre-flight before Job creation"
else
  bad "wrong host refusal ($(cat "$S5/out.txt"))"
fi

# 6. Refuses invalid REANNOTATION_SINCE_DAYS and invalid mode.
S6="$TMP/s6"; mkdir -p "$S6"
if FAKE_KUBECTL_STATE="$S6" KUBECTL="$TMP/bin/kubectl" REANNOTATION_SINCE_DAYS="0" bash "$SCRIPT" >"$S6/out.txt" 2>&1; then
  bad "sinceDays=0 accepted"
else
  ok "invalid REANNOTATION_SINCE_DAYS=0 refused"
fi
if FAKE_KUBECTL_STATE="$S6" KUBECTL="$TMP/bin/kubectl" REANNOTATION_MODE="purge" bash "$SCRIPT" >"$S6/out.txt" 2>&1; then
  bad "invalid mode accepted"
else
  ok "invalid REANNOTATION_MODE refused"
fi

# 7. Workflow contract checks: workflow_dispatch only, environment: production, dry-run default, main guard.
if grep -Fq 'workflow_dispatch:' "$WF" \
  && ! grep -Eq '^[[:space:]]+(push|pull_request|schedule):' "$WF" \
  && grep -Fq 'environment: production' "$WF" \
  && grep -Fq 'default: dry-run' "$WF" \
  && grep -Fq "if: github.ref == 'refs/heads/main'" "$WF" \
  && grep -Fq 'deploy/ci/reannotate-signals-prod.tmpl.yaml' "$WF" \
  && grep -Fq 'dist/scripts/reannotate-signals.js' "$TMPL"; then
  ok "workflow contract: manual-only, environment: production, dry-run default, main-only, template linked"
else
  bad "workflow contract check failed"
fi

echo "reannotate-signals-prod.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
