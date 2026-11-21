#!/usr/bin/env bash
# Hermetic tests for deploy/ci/chaperon-reprise-prod.sh and its workflow/template.
# Uses a fake kubectl stub and synthetic CSV; never touches any cluster or real sheet.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SCRIPT="$SCRIPT_DIR/chaperon-reprise-prod.sh"
TMPL="$SCRIPT_DIR/chaperon-reprise-prod.tmpl.yaml"
WF="$ROOT/.github/workflows/chaperon-reprise-prod.yml"

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
if [[ "$*" == *"get deployment radar-api -o name"* ]]; then
  echo "deployment.apps/radar-api"
  exit 0
fi
if [[ "$*" == *"get deployment radar-api -o json"* ]]; then
  cat "$STATE_DIR/deploy.json"
  exit 0
fi
if [[ "$*" == *"create -f "* ]]; then
  for arg in "$@"; do last="$arg"; done
  cp "$last" "$STATE_DIR/created-job.json"
  echo "job.batch/radar-chaperon-reprise-prod-test created"
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
if [[ "$*" == *"delete job "* ]]; then
  touch "$STATE_DIR/job-deleted"
  exit 0
fi
echo "unexpected kubectl call: $*" >&2
exit 99
EOF
  chmod +x "$dir/kubectl"
}

write_deploy_json() {
  cat > "$1" <<'EOF'
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": { "name": "radar-api", "namespace": "radar-immobilier" },
  "spec": {
    "template": {
      "spec": {
        "serviceAccountName": "radar-app",
        "containers": [
          {
            "name": "radar-api",
            "image": "ghcr.io/rhanka/radar-api@sha256:1111111111111111111111111111111111111111111111111111111111111111",
            "envFrom": [{ "configMapRef": { "name": "radar-api" } }],
            "env": [
              { "name": "POSTGRES_USER", "valueFrom": { "secretKeyRef": { "name": "radar-db-credentials", "key": "POSTGRES_USER" } } }
            ]
          }
        ]
      }
    }
  }
}
EOF
}

write_synthetic_csv() {
  cat > "$1" <<'EOF'
#,"Ville","Sens (Steve)","Classement (Steve)","Code motif (Steve)","ID signal","Lien PV","Citation"
1,"Ville-Test","Assouplissement","Pertinent","P-DENSITE","signal-ville-test-1","https://x/api/documents/raw?rawRef=raw%2Fa.pdf#page=1","[p. 1] « Avis de motion du règlement 100 »"
2,"Ville-Test","Neutre","Non pertinent","N-FORME","signal-ville-test-2","","[p. 2] « Procès-verbal adoption »"
EOF
}

make_fake_kubectl "$TMP/bin"
write_synthetic_csv "$TMP/synthetic.csv"

# 1. Dry-run happy path: creates Job from Deployment/radar-api with --dry-run --allow-prod, deletes Job on exit, renders summary.
S1="$TMP/s1"; mkdir -p "$S1"
write_deploy_json "$S1/deploy.json"
echo '{"status":{"conditions":[{"type":"Complete","status":"True"}]}}' > "$S1/job-status.json"
cat > "$S1/job.log" <<'EOF'
{"kind":"chaperon-reprise","mode":"dry-run","manifestSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mapping":"chaperon-refc-facets/v1","dryRun":{"mode":"dry-run","insertOnly":true,"workspace":{"id":"52d1a4d1-a8f2-49b0-b7c1-36fa86db57e0","slug":"agence-chaperon-immobilier"},"match":{"targets":2,"resolvedTargets":2,"exact":2,"byKey":0,"ambiguous":[],"notFound":[],"resolvedConflicts":[]},"accounts":[{"accountId":"11111111-1111-4111-8111-111111111111","plan":{"insert":2,"noop":0,"skipExisting":0}}],"writable":true}}
EOF

if FAKE_KUBECTL_STATE="$S1" KUBECTL="$TMP/bin/kubectl" GITHUB_STEP_SUMMARY="$S1/summary.md" \
    CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" REPRISE_MODE="dry-run" REPRISE_POLL_SECONDS="0" \
    bash "$SCRIPT" >"$S1/out.txt" 2>&1 \
  && [[ -f "$S1/job-deleted" ]] \
  && jq -e '
      .spec.backoffLimit == 0
      and .spec.template.spec.automountServiceAccountToken == false
      and .spec.template.metadata.labels["app.kubernetes.io/instance"] == "radar-chaperon-reprise"
      and (.spec.template.spec.containers[0].command == ["node","dist/scripts/chaperon-reprise-apply.js","--dry-run","--allow-prod"])
      and ((.spec.template.spec.containers[0].env | map(select(.name == "CHAPERON_REPRISE_PLAN_B64")) | length) == 1)
    ' "$S1/created-job.json" >/dev/null \
  && grep -Fq 'agence-chaperon-immobilier' "$S1/summary.md" \
  && grep -Fq '11111111-1111-4111-8111-111111111111' "$S1/summary.md"; then
  ok "dry-run derives Job from radar-api, passes --dry-run --allow-prod, cleans up Job and writes summary"
else
  bad "dry-run happy path ($(cat "$S1/out.txt"))"
fi

# 2. Apply mode requires exact confirm slug and passes --apply --confirm agence-chaperon-immobilier --allow-prod.
S2="$TMP/s2"; mkdir -p "$S2"
write_deploy_json "$S2/deploy.json"
echo '{"status":{"conditions":[{"type":"Complete","status":"True"}]}}' > "$S2/job-status.json"
cat > "$S2/job.log" <<'EOF'
{"kind":"chaperon-reprise","mode":"apply","manifestSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mapping":"chaperon-refc-facets/v1","dryRun":{"mode":"dry-run","insertOnly":true,"workspace":{"id":"52d1a4d1-a8f2-49b0-b7c1-36fa86db57e0","slug":"agence-chaperon-immobilier"},"match":{"targets":2,"resolvedTargets":2,"exact":2,"byKey":0,"ambiguous":[],"notFound":[],"resolvedConflicts":[]},"accounts":[{"accountId":"11111111-1111-4111-8111-111111111111","plan":{"insert":2,"noop":0,"skipExisting":0}}],"writable":true},"apply":{"accounts":[{"accountId":"11111111-1111-4111-8111-111111111111","applied":{"inserted":2,"noop":0,"skipped":0},"readback":{"cities":1,"pertinent":1,"a_surveiller":0,"archive":1,"mismatchedRows":[]}}]}}
EOF

if FAKE_KUBECTL_STATE="$S2" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="apply" REPRISE_CONFIRM="" bash "$SCRIPT" >"$S2/bad.txt" 2>&1; then
  bad "apply without confirm was accepted"
elif [[ ! -f "$S2/created-job.json" ]] && grep -Fq "REPRISE_CONFIRM=agence-chaperon-immobilier" "$S2/bad.txt"; then
  ok "apply without confirm is refused before Job creation"
else
  bad "apply without confirm refusal ($(cat "$S2/bad.txt"))"
fi

if FAKE_KUBECTL_STATE="$S2" KUBECTL="$TMP/bin/kubectl" GITHUB_STEP_SUMMARY="$S2/summary.md" \
    CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" REPRISE_MODE="apply" REPRISE_CONFIRM="agence-chaperon-immobilier" \
    REPRISE_POLL_SECONDS="0" bash "$SCRIPT" >"$S2/out.txt" 2>&1 \
  && jq -e '
      .spec.template.spec.containers[0].command == ["node","dist/scripts/chaperon-reprise-apply.js","--apply","--confirm","agence-chaperon-immobilier","--allow-prod"]
    ' "$S2/created-job.json" >/dev/null; then
  ok "apply with exact confirm slug passes --apply --confirm --allow-prod"
else
  bad "apply happy path ($(cat "$S2/out.txt"))"
fi

# 3. Wrong apiserver host and invalid mode refused before Job creation.
S3="$TMP/s3"; mkdir -p "$S3"
write_deploy_json "$S3/deploy.json"
if FAKE_KUBECTL_STATE="$S3" FAKE_SERVER="https://wrong.example:6443" KUBECTL="$TMP/bin/kubectl" \
    CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" REPRISE_MODE="dry-run" bash "$SCRIPT" >"$S3/out.txt" 2>&1; then
  bad "wrong apiserver host accepted"
elif [[ ! -f "$S3/created-job.json" ]] && grep -Fq "Wrong cluster" "$S3/out.txt"; then
  ok "wrong apiserver host fails pre-flight before Job creation"
else
  bad "wrong host refusal ($(cat "$S3/out.txt"))"
fi

if FAKE_KUBECTL_STATE="$S3" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="wipe" bash "$SCRIPT" >"$S3/mode.txt" 2>&1; then
  bad "invalid mode accepted"
else
  ok "invalid REPRISE_MODE refused"
fi

# 4. Failed Job exits non-zero cleanly and still cleans up the Job.
S4="$TMP/s4"; mkdir -p "$S4"
write_deploy_json "$S4/deploy.json"
echo '{"status":{"conditions":[{"type":"Failed","status":"True"}]}}' > "$S4/job-status.json"
echo 'chaperon-reprise-apply: refused: unresolved or conflicting targets' > "$S4/job.log"
if FAKE_KUBECTL_STATE="$S4" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="apply" REPRISE_CONFIRM="agence-chaperon-immobilier" REPRISE_POLL_SECONDS="0" \
    bash "$SCRIPT" >"$S4/out.txt" 2>&1; then
  bad "failed Job unexpectedly succeeded"
elif [[ -f "$S4/job-deleted" ]] && grep -Fq "Missing reprise report" "$S4/out.txt"; then
  ok "failed Job exits non-zero cleanly and deletes the ephemeral Job"
else
  bad "failed Job handling ($(cat "$S4/out.txt"))"
fi

# 5. Workflow and template contract checks: workflow_dispatch only, production env, v* tag guard, main ancestry, lock + always() release-lock.
if grep -Fq 'workflow_dispatch:' "$WF" \
  && ! grep -Eq '^[[:space:]]+(push|pull_request|schedule):' "$WF" \
  && grep -Fq 'environment: production' "$WF" \
  && grep -Fq 'default: dry-run' "$WF" \
  && grep -Fq "if: startsWith(github.ref, 'refs/tags/v')" "$WF" \
  && grep -Fq 'bash deploy/ci/require-main-ancestry.sh' "$WF" \
  && ! grep -Fq "refs/heads/main" "$WF" \
  && grep -Fq 'deploy/ci/chaperon-reprise-prod.tmpl.yaml' "$WF" \
  && grep -Fq 'dist/scripts/chaperon-reprise-apply.js' "$TMPL" \
  && node -e '
    const fs = require("fs");
    const wf = fs.readFileSync(process.argv[1], "utf8");
    const lockIdx = wf.indexOf("action: lock");
    const runIdx = wf.indexOf("bash deploy/ci/chaperon-reprise-prod.sh");
    const releaseIdx = wf.indexOf("action: release-lock");
    if (!(lockIdx >= 0 && runIdx > lockIdx && releaseIdx > runIdx)) process.exit(1);
    const tail = wf.slice(runIdx);
    if (!/if:\s*always\(\)\s*&&\s*env\.CUTOVER_LOCK_RUN\s*!=\s*\x27\x27/.test(tail)) process.exit(2);
  ' "$WF"; then
  ok "workflow contract: manual-only, production, v* tag guard, ancestry check, lock + always() release-lock"
else
  bad "workflow contract check failed"
fi

# 6. Prod container name ("api", not "radar-api") and list/array deploy.json shapes do not crash jq.
S6A="$TMP/s6a"; mkdir -p "$S6A"
cat > "$S6A/deploy.json" <<'EOF'
{
  "apiVersion": "apps/v1",
  "kind": "Deployment",
  "metadata": { "name": "radar-api", "namespace": "radar-immobilier" },
  "spec": {
    "template": {
      "spec": {
        "serviceAccountName": "radar-app",
        "containers": [
          {
            "name": "sidecar",
            "image": "ghcr.io/rhanka/sidecar:latest"
          },
          {
            "name": "api",
            "image": "ghcr.io/rhanka/radar-api@sha256:2222222222222222222222222222222222222222222222222222222222222222",
            "envFrom": [{ "configMapRef": { "name": "radar-api" } }],
            "env": [
              { "name": "POSTGRES_USER", "valueFrom": { "secretKeyRef": { "name": "radar-db-credentials", "key": "POSTGRES_USER" } } }
            ]
          }
        ]
      }
    }
  }
}
EOF
cp "$S1/job-status.json" "$S6A/job-status.json"
cp "$S1/job.log" "$S6A/job.log"

if FAKE_KUBECTL_STATE="$S6A" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="dry-run" REPRISE_POLL_SECONDS="0" bash "$SCRIPT" >"$S6A/out.txt" 2>&1 \
  && jq -e '
      .spec.template.spec.containers[0].image == "ghcr.io/rhanka/radar-api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      and .spec.template.spec.serviceAccountName == "radar-app"
    ' "$S6A/created-job.json" >/dev/null; then
  ok "Deployment with prod container name 'api' selects api container without jq array-index crash"
else
  bad "prod container name 'api' ($(cat "$S6A/out.txt"))"
fi

S6B="$TMP/s6b"; mkdir -p "$S6B"
jq -s '[{apiVersion:"apps/v1",kind:"Deployment",metadata:{name:"other"},spec:{template:{spec:{containers:[{name:"other",image:"ghcr.io/rhanka/other:latest"}]}}}}, .[0]]' "$S6A/deploy.json" > "$S6B/deploy.json"
cp "$S1/job-status.json" "$S6B/job-status.json"
cp "$S1/job.log" "$S6B/job.log"

if FAKE_KUBECTL_STATE="$S6B" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="dry-run" REPRISE_POLL_SECONDS="0" bash "$SCRIPT" >"$S6B/out.txt" 2>&1 \
  && jq -e '
      .spec.template.spec.containers[0].image == "ghcr.io/rhanka/radar-api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      and .spec.template.spec.serviceAccountName == "radar-app"
    ' "$S6B/created-job.json" >/dev/null; then
  ok "deploy.json as JSON array selects Deployment/radar-api cleanly"
else
  bad "deploy.json as JSON array ($(cat "$S6B/out.txt"))"
fi

S6C="$TMP/s6c"; mkdir -p "$S6C"
jq '{apiVersion:"v1",kind:"List",items:.}' "$S6B/deploy.json" > "$S6C/deploy.json"
cp "$S1/job-status.json" "$S6C/job-status.json"
cp "$S1/job.log" "$S6C/job.log"

if FAKE_KUBECTL_STATE="$S6C" KUBECTL="$TMP/bin/kubectl" CHAPERON_REPRISE_CSV_PATH="$TMP/synthetic.csv" \
    REPRISE_MODE="dry-run" REPRISE_POLL_SECONDS="0" bash "$SCRIPT" >"$S6C/out.txt" 2>&1 \
  && jq -e '
      .spec.template.spec.containers[0].image == "ghcr.io/rhanka/radar-api@sha256:2222222222222222222222222222222222222222222222222222222222222222"
      and .spec.template.spec.serviceAccountName == "radar-app"
    ' "$S6C/created-job.json" >/dev/null; then
  ok "deploy.json as Kubernetes List (.items) selects Deployment/radar-api cleanly"
else
  bad "deploy.json as Kubernetes List ($(cat "$S6C/out.txt"))"
fi

echo "chaperon-reprise-prod.test.sh: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
