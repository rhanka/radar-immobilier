#!/usr/bin/env bash
# P0-C preprod switchover adapter (P0C_APPLY_HOOK).
#
# Called by packages/immo-mcp/scripts/p0c-switch.ts as:
#   <hook> <inputs|results> <prepare|open|close>
#
# Contract (docs/runbooks/mcp-artifacts-p0c.md): prepare stages the configured
# revision and waits for the rollout; open verifies the served profile; close
# restores the last known good env after ANY failure. Close never reverts
# host_policy to r2, never deletes receipts or data, never touches
# PREPROD_CD_ENABLED / BASCULE_SCHEDULE_ENABLED or the bascule workflows.
#
# Env var names are exactly those read by the code:
#   packages/artifacts-host/src/p0b-profile.ts (artifactProfileDescriptor):
#     ARTIFACTS_PROFILE_REVISION (default immo-artifacts.p0b.v1 on provider
#     0.2.6), ARTIFACTS_INPUTS_QUALIFIED + ARTIFACTS_RESULTS_QUALIFIED (both
#     required to be "true" only for revision immo-artifacts.v2, otherwise
#     ignored). Both radar-api and radar-immo-mcp read them through the same
#     module (packages/immo-mcp/src/registry/artifact-profile.ts re-exports
#     ARTIFACT_PROFILE_DESCRIPTOR), and both capture the profile at
#     process/binding construction — so a rollout (new pods) is required.
#
# Cluster access: every kubectl invocation MUST use exactly
#   kubectl --kubeconfig "$P0C_KUBECONFIG" -n radar-immobilier-preprod
# P0C_KUBECONFIG is required and ~/.kube/config is refused. Any namespace
# other than radar-immobilier-preprod is refused (prod is never touched).
#
# Results phase keeps the v1 binding alive on the live Deployments/Services
# while a -v2 candidate (Deployment + Service per component) serves the
# qualification traffic. In-place switching cannot satisfy converged-r2
# section 2.6: p0c-switch.ts asserts the v1 HTTP base still serves
# immo-artifacts.cas.v2 while the v2 base serves immo-artifacts.v2, and
# section 2.6 requires existing connections to keep their v1 projection
# until migrated. The candidates carry an extra pod label p0c-candidate=v2
# (the component labels are preserved so the postgres/traefik NetworkPolicies
# keep matching) and the live Services select p0c-candidate=live, which the
# hook sets on the live pod templates first. See the runbook for the full
# decision record.
#
# Dry run: P0C_DRY_RUN=1 prints every kubectl command and every profile check
# without executing anything.
set -euo pipefail

PHASE="${1:-}"
STEP="${2:-}"
NS="${P0C_NAMESPACE:-radar-immobilier-preprod}"
DRY="${P0C_DRY_RUN:-0}"

MCP_DEPLOY="radar-immo-mcp"
API_DEPLOY="radar-api"
MCP_CANDIDATE="radar-immo-mcp-v2"
API_CANDIDATE="radar-api-v2"
INPUTS_REV="immo-artifacts.cas.v2"
RESULTS_REV="immo-artifacts.v2"
CANDIDATE_LABEL="v2"
LABEL_KEY="p0c-candidate"
ROLLOUT_TIMEOUT="300s"

fail() { echo "p0c-apply-hook: $*" >&2; exit 1; }

[ "$PHASE" = "inputs" ] || [ "$PHASE" = "results" ] || fail "usage: $0 <inputs|results> <prepare|open|close>"
[ "$STEP" = "prepare" ] || [ "$STEP" = "open" ] || [ "$STEP" = "close" ] || fail "usage: $0 <inputs|results> <prepare|open|close>"
[ "$NS" = "radar-immobilier-preprod" ] || fail "refusing namespace '$NS' (only radar-immobilier-preprod)"
[ -n "${P0C_KUBECONFIG:-}" ] || fail "P0C_KUBECONFIG is required (explicit preprod kubeconfig)"
KC="$P0C_KUBECONFIG"
case "$KC" in "~/"*) KC="$HOME/${KC#~/}";; esac
[ "$KC" != "$HOME/.kube/config" ] || fail "refusing default kubeconfig ~/.kube/config (pass an explicit P0C_KUBECONFIG)"
[ -r "$P0C_KUBECONFIG" ] || fail "P0C_KUBECONFIG is not readable: $P0C_KUBECONFIG"

KUBECTL="kubectl --kubeconfig \"$P0C_KUBECONFIG\" -n $NS"
k() {
  if [ "$DRY" = "1" ]; then
    # shellcheck disable=SC2086
    printf '+ %s\n' "$KUBECTL $*" >&2
    return 0
  fi
  kubectl --kubeconfig "$P0C_KUBECONFIG" -n "$NS" "$@"
}

# Clone a live Deployment manifest into a -v2 candidate: rename the object,
# add the candidate label to the selector and the pod template (the component
# labels are preserved so NetworkPolicies keep matching), and strip
# server-assigned fields that kubectl apply/create reject. Reads live state;
# prints the apply command only in dry-run mode.
apply_candidate() {
  local base="$1" candidate="$2" comp="$3"
  if [ "$DRY" = "1" ]; then
    printf '+ %s\n' "$KUBECTL get deploy/$base -o yaml \\"
    printf '+   | clone to %s (label %s=%s) | %s apply -f -\n' "$candidate" "$LABEL_KEY" "$CANDIDATE_LABEL" "$KUBECTL"
    return 0
  fi
  k get "deploy/$base" -o yaml | awk -v base="$base" -v candidate="$candidate" -v comp="$comp" -v key="$LABEL_KEY" -v label="$CANDIDATE_LABEL" '
    /^status:/ { exit }
    /^  managedFields:$/ { skip = 1; next }
    skip && /^  [A-Za-z]/ { skip = 0 }
    skip { next }
    /^[[:space:]]*(resourceVersion|uid|selfLink|creationTimestamp|generation):/ { next }
    $0 == "  name: " base { $0 = "  name: " candidate }
    { print }
    $0 == "      app.kubernetes.io/component: " comp { print "      " key ": " label }
    $0 == "        app.kubernetes.io/component: " comp { print "        " key ": " label }
  ' | kubectl --kubeconfig "$P0C_KUBECONFIG" -n "$NS" apply -f -
}

# Static candidate Service: selects the candidate pods only. Applied (not
# patched) so re-runs converge; the selector never changes.
apply_candidate_service() {
  local name="$1" comp="$2" port="$3"
  if [ "$DRY" = "1" ]; then
    printf '+ %s apply -f - <<Service/%s\n' "$KUBECTL" "$name"
    return 0
  fi
  k apply -f - <<EOF
apiVersion: v1
kind: Service
metadata:
  name: $name
  namespace: $NS
  labels:
    app.kubernetes.io/name: radar-immobilier
    app.kubernetes.io/part-of: sentropic
    app.kubernetes.io/component: $comp
spec:
  selector:
    app.kubernetes.io/name: radar-immobilier
    app.kubernetes.io/component: $comp
    $LABEL_KEY: $CANDIDATE_LABEL
  ports:
    - name: http
      port: $port
      targetPort: http
EOF
}

# Verify a served control profile over HTTP with node (no python, no curl
# dependency: the disposable container always has node). Exits nonzero on any
# mismatch so open/close fail closed.
verify_profile() {
  local base="$1" revision="$2" envelope="$3"
  if [ "$DRY" = "1" ]; then
    printf '+ verify %s/profile serves %s envelope %s\n' "$base" "$revision" "$envelope"
    return 0
  fi
  node -e '
    const [base, revision, envelope] = process.argv.slice(1);
    fetch(base + "/profile", { signal: AbortSignal.timeout(20000) }).then(async (r) => {
      if (!r.ok) throw new Error("profile HTTP " + r.status);
      const body = await r.json();
      if (body.profileRevisionId !== revision) throw new Error("profileRevisionId=" + body.profileRevisionId);
      if (body.requireExpectedCurrentReleaseId !== true) throw new Error("requireExpectedCurrentReleaseId is not true");
      if (body.resultEnvelopeVersion !== Number(envelope)) throw new Error("resultEnvelopeVersion=" + body.resultEnvelopeVersion);
      console.log("profile ok: " + base + " serves " + revision + " envelope " + envelope);
    }).catch((e) => { console.error("p0c-apply-hook profile mismatch: " + base + ": " + e.message); process.exit(1); });
  ' "$base" "$revision" "$envelope"
}

require_http_base() {
  local name="$1"
  [ -n "${!name:-}" ] || fail "$name is required for $PHASE $STEP"
  printf '%s' "${!name}"
}

inputs_prepare() {
  k set env "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" "ARTIFACTS_PROFILE_REVISION=$INPUTS_REV"
  k set env "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" ARTIFACTS_INPUTS_QUALIFIED- ARTIFACTS_RESULTS_QUALIFIED-
  k rollout status "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" --timeout="$ROLLOUT_TIMEOUT"
}

inputs_open() {
  k rollout status "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" --timeout="$ROLLOUT_TIMEOUT"
  verify_profile "$(require_http_base P0C_V1_HTTP_BASE)" "$INPUTS_REV" 1
}

inputs_close() {
  local failures=0
  k set env "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" ARTIFACTS_PROFILE_REVISION- ARTIFACTS_INPUTS_QUALIFIED- ARTIFACTS_RESULTS_QUALIFIED- || failures=$((failures + 1))
  k rollout status "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" --timeout="$ROLLOUT_TIMEOUT" || failures=$((failures + 1))
  [ "$failures" = 0 ] || fail "inputs close incomplete ($failures step(s) failed, operator action required)"
}

# Label the live pod templates so the live Services can exclude candidate
# pods (plain map selectors cannot express exclusion). The component labels
# are untouched, so postgres/traefik NetworkPolicies keep matching. Rolling
# the live Deployments here is intended: prepare stages the configuration.
label_live_templates() {
  k patch "deploy/$MCP_DEPLOY" --type strategic -p '{"spec":{"template":{"metadata":{"labels":{"p0c-candidate":"live"}}}}}'
  k patch "deploy/$API_DEPLOY" --type strategic -p '{"spec":{"template":{"metadata":{"labels":{"p0c-candidate":"live"}}}}}'
  k rollout status "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" --timeout="$ROLLOUT_TIMEOUT"
}

# Route the live Services to labeled live pods only. Atomic per Service;
# called after the labeled pods are Ready, so traffic never drops.
isolate_live_services() {
  k patch "svc/$MCP_DEPLOY" --type merge -p '{"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"mcp","p0c-candidate":"live"}}}'
  k patch "svc/$API_DEPLOY" --type merge -p '{"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"api","p0c-candidate":"live"}}}'
}

restore_live_services() {
  k patch "svc/$MCP_DEPLOY" --type merge -p '{"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"mcp"}}}'
  k patch "svc/$API_DEPLOY" --type merge -p '{"spec":{"selector":{"app.kubernetes.io/name":"radar-immobilier","app.kubernetes.io/component":"api"}}}'
}

set_candidate_env() {
  local candidate="$1"
  shift
  k set env "deploy/$candidate" "$@"
}

results_prepare() {
  label_live_templates
  isolate_live_services
  apply_candidate_service "$MCP_CANDIDATE" mcp 8848
  apply_candidate_service "$API_CANDIDATE" api 3000
  apply_candidate "$MCP_DEPLOY" "$MCP_CANDIDATE" mcp
  apply_candidate "$API_DEPLOY" "$API_CANDIDATE" api
  # Qualification attestations are forwarded ONLY when the caller passes them
  # in (never defaulted to true: an unset attestation makes the candidate
  # refuse startup via artifact_switchovers_not_qualified, fail-closed).
  local args=(ARTIFACTS_PROFILE_REVISION="$RESULTS_REV")
  [ -z "${ARTIFACTS_INPUTS_QUALIFIED:-}" ] || args+=(ARTIFACTS_INPUTS_QUALIFIED="$ARTIFACTS_INPUTS_QUALIFIED")
  [ -z "${ARTIFACTS_RESULTS_QUALIFIED:-}" ] || args+=(ARTIFACTS_RESULTS_QUALIFIED="$ARTIFACTS_RESULTS_QUALIFIED")
  set_candidate_env "$API_CANDIDATE" "${args[@]}"
  set_candidate_env "$MCP_CANDIDATE" "${args[@]}" RADAR_API_BASE_URL=http://radar-api-v2:3000
  k rollout status "deploy/$MCP_CANDIDATE" "deploy/$API_CANDIDATE" --timeout="$ROLLOUT_TIMEOUT"
}

results_open() {
  k rollout status "deploy/$MCP_CANDIDATE" "deploy/$API_CANDIDATE" --timeout="$ROLLOUT_TIMEOUT"
  verify_profile "$(require_http_base P0C_V2_HTTP_BASE)" "$RESULTS_REV" 2
  verify_profile "$(require_http_base P0C_V1_HTTP_BASE)" "$INPUTS_REV" 1
}

# Restore routing to the live bindings, remove the candidates, and ensure the
# live env is still the inputs revision. Never unsets the live revision,
# never touches host_policy, receipts or data. The p0c-candidate=live pod
# template label is intentionally kept (subset matching makes it harmless and
# removing it would force another live rollout on the failure path).
results_close() {
  local failures=0
  k delete deploy/"$MCP_CANDIDATE" deploy/"$API_CANDIDATE" svc/"$MCP_CANDIDATE" svc/"$API_CANDIDATE" --ignore-not-found || failures=$((failures + 1))
  restore_live_services || failures=$((failures + 1))
  local current
  current="$(k get "deploy/$API_DEPLOY" -o "jsonpath={.spec.template.spec.containers[*].env[?(@.name==\"ARTIFACTS_PROFILE_REVISION\")].value}")" || failures=$((failures + 1))
  if [ "${current:-}" != "$INPUTS_REV" ]; then
    k set env "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" "ARTIFACTS_PROFILE_REVISION=$INPUTS_REV" || failures=$((failures + 1))
  fi
  k rollout status "deploy/$MCP_DEPLOY" "deploy/$API_DEPLOY" --timeout="$ROLLOUT_TIMEOUT" || failures=$((failures + 1))
  verify_profile "$(require_http_base P0C_V1_HTTP_BASE)" "$INPUTS_REV" 1 || failures=$((failures + 1))
  [ "$failures" = 0 ] || fail "results close incomplete ($failures step(s) failed, operator action required)"
}

case "$PHASE $STEP" in
  "inputs prepare") inputs_prepare;;
  "inputs open") inputs_open;;
  "inputs close") inputs_close;;
  "results prepare") results_prepare;;
  "results open") results_open;;
  "results close") results_close;;
esac
