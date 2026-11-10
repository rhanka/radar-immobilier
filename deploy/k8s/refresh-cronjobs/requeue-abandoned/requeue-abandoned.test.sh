#!/usr/bin/env bash
# Hermetic render tests of the requeue-abandoned Job (refresh-018.mk): no
# cluster. Renders both overlays with a fake digest and checks the guards.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MK="$HERE/../refresh-018.mk"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

T="$(mktemp -d)"
parses() { # $1=render $2=tag: hermetic YAML parse via kustomize (kubectl create needs API discovery, absent in CI)
  local d="$T/parse-$2"; mkdir -p "$d"; cp "$1" "$d/render.yaml"
  printf 'resources:\n  - render.yaml\n' > "$d/kustomization.yaml"
  kubectl kustomize "$d" >/dev/null 2>&1
}
trap 'rm -rf "$T"' EXIT
DIGEST="ghcr.io/rhanka/radar-api@sha256:$(printf 'a%.0s' $(seq 64))"

render() { # $1=ENV $2=mode $3=out extra...
  local env="$1" mode="$2" out="$3"; shift 3
  make -s -f "$MK" render-requeue-abandoned REQUEUE_IMAGE_REF="$DIGEST" \
    REQUEUE_RENDER_OUT="$out" REQUEUE_MODE="$mode" "$@" ENV="$env" >"$T/out" 2>&1
}

if render preprod dry-run "$T/preprod.yaml" && grep -q '^  namespace: radar-immobilier-preprod$' "$T/preprod.yaml" \
  && grep -q 'args="--dry-run"' "$T/preprod.yaml" && grep -q 'flock -n /keyring/runtime/.refresh.lock' "$T/preprod.yaml" \
  && grep -q 'radar-docs-s3-credentials' "$T/preprod.yaml"; then
  ok "preprod dry-run render: namespace, mode, flock, preprod S3 secret"
else bad "preprod dry-run render ($(cat "$T/out"))"; fi

# Regression: a rendered file must PARSE as Kubernetes YAML (an env value of
# `-` or an unquoted date after sed substitution broke this before).
if [ -f "$T/preprod.yaml" ] && parses "$T/preprod.yaml" preprod; then
  ok "preprod render parses (kustomize, hermetic)"
else bad "preprod render does not parse"; fi

if render prod apply "$T/prod.yaml" REQUEUE_OPERATOR=conductor REQUEUE_SINCE=2026-10-29 \
  && grep -q '^  namespace: radar-immobilier$' "$T/prod.yaml" \
  && grep -q 'args="--since 2026-10-29 --operator conductor"' "$T/prod.yaml" \
  && grep -q 'radar-scrape-s3-credentials' "$T/prod.yaml" \
  && parses "$T/prod.yaml" prod; then
  ok "prod apply render: namespace, since, operator, prod S3 secret, parses"
else bad "prod apply render ($(cat "$T/out"))"; fi

if render prod restore "$T/restore.yaml" REQUEUE_OPERATOR=conductor REQUEUE_RESTORE_STAMP=2026-11-09T00-00-00-000Z REQUEUE_CITY=beta \
  && grep -q 'args="--restore 2026-11-09T00-00-00-000Z --city beta --operator conductor"' "$T/restore.yaml" \
  && grep -q 'flock -n /keyring/runtime/.refresh.lock' "$T/restore.yaml" \
  && parses "$T/restore.yaml" restore; then
  ok "prod restore render: stamp, city, operator, flock, parses"
else bad "prod restore render ($(cat "$T/out"))"; fi

# --- rendered guard: no false "unrendered" after sed substitution --------
# Extract the Job shell from args= through the guard esac and run it with sh
# up to the guard only: rendered args must pass, raw manifest must refuse.
extract_guard() { # $1=yaml $2=out
  awk '/^[[:space:]]*args=/ {f=1} f {sub(/^[[:space:]]+/, ""); print} f && /esac/ {exit}' "$1" > "$2"
  test -s "$2" && grep -q 'marker=' "$2" && grep -q 'unrendered requeue arguments' "$2"
}
if [ -f "$T/preprod.yaml" ] && extract_guard "$T/preprod.yaml" "$T/guard-rendered.sh" \
  && sh "$T/guard-rendered.sh" >"$T/out" 2>&1; then
  ok "rendered dry-run guard: sh passes (no false unrendered)"
else bad "rendered dry-run guard failed ($(cat "$T/out" 2>/dev/null))"; fi

if [ -f "$T/prod.yaml" ] && extract_guard "$T/prod.yaml" "$T/guard-prod.sh" \
  && sh "$T/guard-prod.sh" >"$T/out" 2>&1; then
  ok "rendered apply guard: sh passes (no false unrendered)"
else bad "rendered apply guard failed ($(cat "$T/out" 2>/dev/null))"; fi

if extract_guard "$HERE/job.yaml" "$T/guard-raw.sh" && sh "$T/guard-raw.sh" >"$T/out" 2>&1; then
  bad "unrendered guard accepted the raw manifest"
else grep -q "unrendered requeue arguments" "$T/out" && ok "unrendered guard: raw manifest refused" || bad "unrendered guard: wrong refusal ($(cat "$T/out"))"; fi

if render prod apply "$T/noop.yaml" 2>/dev/null; then bad "apply without operator accepted"
else grep -q "REQUEUE_OPERATOR is required" "$T/out" && ok "apply without operator refused" || bad "apply without operator: wrong refusal"; fi

if render ci dry-run "$T/ci.yaml"; then bad "ENV=ci accepted"
else grep -q "ENV=preprod or ENV=prod is required" "$T/out" && ok "ENV other than preprod/prod refused" || bad "ENV guard: wrong refusal"; fi

if make -s -f "$MK" render-requeue-abandoned REQUEUE_IMAGE_REF="ghcr.io/rhanka/radar-api:latest" \
  REQUEUE_RENDER_OUT="$T/tag.yaml" REQUEUE_MODE=dry-run ENV=preprod >"$T/out" 2>&1; then bad "non-digest image accepted"
else grep -q "immutable digest" "$T/out" && ok "non-digest image refused" || bad "image guard: wrong refusal"; fi

# --- guard-requeue: prod and preprod share the same API server ------------
# Hermetic kubectl stub: both environments report the SAME cluster server
# (EXPECTED_SERVER in refresh-018.mk); only the context namespace, the caller
# identity and the -n-scoped radar-app probe tell them apart.
mkdir -p "$T/bin"
cat > "$T/bin/kubectl" <<'EOF'
#!/usr/bin/env bash
for a in "$@"; do
  if [ "$a" = "config" ]; then
    case "$*" in
      *cluster.server*) printf '%s' "${STUB_SERVER:-}"; exit 0 ;;
      *context.namespace*) printf '%s' "${STUB_CTX_NS:-}"; exit 0 ;;
    esac
  fi
  [ "$a" = "whoami" ] && { printf '%s' "${STUB_WHOAMI:-}"; exit 0; }
done
ns="" prev=""
for a in "$@"; do [ "$prev" = "-n" ] && ns="$a"; prev="$a"; done
if [ "$ns" = "${STUB_SA_NS:-}" ]; then echo "serviceaccount/radar-app"; exit 0; fi
echo "stub: no radar-app in namespace $ns" >&2; exit 1
EOF
chmod +x "$T/bin/kubectl"
: > "$T/kubeconfig"
SERVER="https://hlhedx.c1.bhs5.k8s.ovh.net"
guard() { # $1=ENV, remaining args are VAR=value assignments for env/make
  local env="$1"; shift
  env PATH="$T/bin:$PATH" STUB_SERVER="$SERVER" "$@" \
    make -s -f "$MK" guard-requeue KUBECONFIG="$T/kubeconfig" ENV="$env" >"$T/out" 2>&1
}

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER="$SERVER" STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  ok "prod guard: same API server as preprod accepted when namespace and identity are prod"
else bad "prod guard refused the shared cluster ($(cat "$T/out"))"; fi

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER="$SERVER" STUB_CTX_NS= \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  ok "prod guard: unset context namespace accepted (all calls pass -n explicitly)"
else bad "prod guard refused an unset context namespace ($(cat "$T/out"))"; fi

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER="$SERVER" STUB_CTX_NS=radar-immobilier-preprod \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  bad "prod guard accepted a preprod context namespace"
else grep -q "refusing kubeconfig context namespace radar-immobilier-preprod for ENV=prod" "$T/out" \
  && ok "prod guard: preprod context namespace refused" || bad "prod guard context refusal: wrong message ($(cat "$T/out"))"; fi

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER="$SERVER" STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier-preprod:radar-ci-bascule-preprod STUB_SA_NS=radar-immobilier; then
  bad "prod guard accepted a preprod identity"
else grep -q "refusing the radar-immobilier-preprod identity for ENV=prod" "$T/out" \
  && ok "prod guard: preprod identity refused" || bad "prod guard identity refusal: wrong message ($(cat "$T/out"))"; fi

if guard prod REQUEUE_EXPECTED_SERVER="$SERVER" STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  bad "prod guard accepted a missing PROD_CONFIRM"
else grep -q "PROD_CONFIRM=1 is required" "$T/out" && ok "prod guard: PROD_CONFIRM still required" || bad "prod guard PROD_CONFIRM refusal: wrong message"; fi

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER= STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  bad "prod guard accepted a missing REQUEUE_EXPECTED_SERVER"
else grep -q "REQUEUE_EXPECTED_SERVER is required" "$T/out" && ok "prod guard: REQUEUE_EXPECTED_SERVER still required" || bad "prod guard server-var refusal: wrong message"; fi

if guard prod PROD_CONFIRM=1 REQUEUE_EXPECTED_SERVER=https://other.example.net STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier; then
  bad "prod guard accepted an unexpected API server"
else grep -q "refusing unexpected prod API server" "$T/out" && ok "prod guard: unexpected API server refused" || bad "prod guard server refusal: wrong message"; fi

if guard preprod STUB_CTX_NS=radar-immobilier-preprod \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier-preprod:radar-ci-bascule-preprod STUB_SA_NS=radar-immobilier-preprod; then
  ok "preprod guard: shared API server accepted when namespace and identity are preprod"
else bad "preprod guard refused the shared cluster ($(cat "$T/out"))"; fi

if guard preprod STUB_CTX_NS=radar-immobilier \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier-preprod:radar-ci-bascule-preprod STUB_SA_NS=radar-immobilier-preprod; then
  bad "preprod guard accepted a prod context namespace"
else grep -q "refusing kubeconfig context namespace radar-immobilier for ENV=preprod" "$T/out" \
  && ok "preprod guard: prod context namespace refused" || bad "preprod guard context refusal: wrong message ($(cat "$T/out"))"; fi

if guard preprod STUB_CTX_NS=radar-immobilier-preprod \
  STUB_WHOAMI=system:serviceaccount:radar-immobilier:radar-operator STUB_SA_NS=radar-immobilier-preprod; then
  bad "preprod guard accepted a prod identity"
else grep -q "refusing the radar-immobilier identity for ENV=preprod" "$T/out" \
  && ok "preprod guard: prod identity refused" || bad "preprod guard identity refusal: wrong message ($(cat "$T/out"))"; fi

test -s "$HERE/requeue-abandoned.bundle.mjs" && grep -q "GENERATED by bundle.mjs" "$HERE/requeue-abandoned.bundle.mjs" \
  && ok "committed bundle present and marked generated" || bad "bundle missing"

echo "requeue-abandoned.test.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
