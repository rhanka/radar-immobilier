#!/usr/bin/env bash
# Render test: the preprod overlay gives Deployment radar-immo-mcp its env
# from valueFrom refs only — in particular ARTIFACTS_UPLOAD_PAGE_SECRET
# (Secret radar-artifacts-upload-page-preprod, key secret). No literal value:
# a literal would conflict with the live strategic-merge patch on
# server-side apply. Prod (base) stays untouched: no such env entry there.
# Needs kubectl (render only, no cluster).
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PASS=0 FAIL=0
ok() { PASS=$((PASS + 1)); echo "ok: $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL: $1" >&2; }

KUBECTL="${KUBECTL:-kubectl}"
command -v "$KUBECTL" >/dev/null 2>&1 || { bad "kubectl not found"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }

RENDER="$(mktemp)"
trap 'rm -f "$RENDER"' EXIT
"$KUBECTL" kustomize --load-restrictor LoadRestrictionsNone "$ROOT/deploy/overlays/preprod" >"$RENDER" 2>/dev/null \
  || { bad "preprod overlay does not render"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }
ok "preprod overlay renders"

DEPLOY="$(mktemp)"
trap 'rm -f "$RENDER" "$DEPLOY"' EXIT
node -e '
  const text = require("fs").readFileSync(process.argv[1], "utf8");
  const docs = text.split(/^---[ \t]*$/m).filter((d) => d.trim() !== "");
  const found = docs.filter((d) =>
    /^kind:[ \t]+Deployment[ \t]*$/m.test(d) &&
    /^  name:[ \t]+radar-immo-mcp[ \t]*$/m.test(d));
  if (found.length !== 1) {
    process.stderr.write("expected 1 radar-immo-mcp Deployment, got " + found.length + "\n");
    process.exit(1);
  }
  require("fs").writeFileSync(process.argv[2], found[0]);
' "$RENDER" "$DEPLOY" || { bad "exactly one radar-immo-mcp Deployment in the render"; echo "PASS=$PASS FAIL=$FAIL"; exit 1; }
ok "exactly one radar-immo-mcp Deployment in the render"

# The secret ref: same name, same key, optional, and no literal value.
node -e '
  const doc = require("fs").readFileSync(process.argv[1], "utf8");
  const lines = doc.split("\n");
  const idx = lines.findIndex((l) => l.trim() === "- name: ARTIFACTS_UPLOAD_PAGE_SECRET");
  if (idx === -1) { process.stderr.write("ARTIFACTS_UPLOAD_PAGE_SECRET entry missing\n"); process.exit(1); }
  const window = lines.slice(idx, idx + 8).join("\n");
  const checks = [
    ["secretKeyRef", /secretKeyRef:/],
    ["secret name", /name:[ \t]+radar-artifacts-upload-page-preprod/],
    ["secret key", /key:[ \t]+secret/],
    ["optional ref", /optional:[ \t]+true/],
  ];
  let failed = false;
  for (const [label, re] of checks) {
    if (!re.test(window)) { process.stderr.write("missing " + label + "\n"); failed = true; }
  }
  if (/^\s+value:/m.test(window)) { process.stderr.write("literal value present\n"); failed = true; }
  if (failed) process.exit(1);
' "$DEPLOY" && ok "MCP Deployment env carries the upload-page secret ref (no literal)" \
  || bad "MCP Deployment env carries the upload-page secret ref (no literal)"

grep -q "replicas: 1" "$DEPLOY" && ok "MCP Deployment stays at 1 replica" || bad "MCP Deployment stays at 1 replica"
grep -q "type: Recreate" "$DEPLOY" && ok "MCP Deployment strategy stays Recreate" || bad "MCP Deployment strategy stays Recreate"

# Prod untouched: the base Deployment (symlink target, no overlay) carries no
# ARTIFACTS_UPLOAD_PAGE_SECRET entry at all.
if grep -q "ARTIFACTS_UPLOAD_PAGE_SECRET" "$ROOT/deploy/k8s/immo-mcp/40-immo-mcp-http-deploy.yaml"; then
  bad "prod base Deployment untouched (no ARTIFACTS_UPLOAD_PAGE_SECRET)"
else
  ok "prod base Deployment untouched (no ARTIFACTS_UPLOAD_PAGE_SECRET)"
fi

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
